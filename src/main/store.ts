import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { logger } from './logger';
import { clampWindowSize, getWindowSizeLimits } from './window';
import type { AppConfig, LauncherData, LauncherPane, LauncherSettings, LoadDataResult, MigrateDataDirResult, PaneCount, SaveResult } from './types';

/** 現行スキーマバージョン */
export const CURRENT_SCHEMA_VERSION = 1;

/** バックアップ保持世代数 */
const BACKUP_RETENTION_COUNT = 10;

/** デフォルト dataDir（%APPDATA%\tms-app-launcher\data） */
const DEFAULT_DATA_DIR_NAME = 'data';

/** デフォルトの launcher-data */
export function createDefaultLauncherData(): LauncherData {
	const uncategorizedId = `g-${randomUUID()}`;

	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		settings     : {
			toggleInitialState: 'expandAll',
			window            : {
				width : 480,
				height: 720,
			},
			appearance                  : 'system',
			launchBehavior              : 'stay',
			rememberWindowSizeOnLaunch  : false,
			paneCount                   : 1,
			uncategorizedPane           : 'left',
		},
		groups: [
			{
				id              : uncategorizedId,
				name            : '未分類',
				order           : 9999,
				isUncategorized : true,
			},
		],
		apps: [],
	};
}

/**
 * 設定からペイン数を解決する（dualPaneEnabled からの移行を含む）
 * @param {LauncherSettings} settings 設定
 * @returns {PaneCount} ペイン数
 */
function resolvePaneCount(settings: LauncherSettings): PaneCount {
	if (settings.paneCount === 1 || settings.paneCount === 2 || settings.paneCount === 3) {
		return settings.paneCount;
	}

	if (settings.dualPaneEnabled) {
		return 2;
	}

	return 1;
}

/**
 * 未分類グループの表示ペインを正規化する
 * @param {LauncherPane | undefined} pane ペイン
 * @param {PaneCount} paneCount ペイン数
 * @returns {LauncherPane} 正規化後ペイン
 */
function resolveUncategorizedPane(pane: LauncherPane | undefined, paneCount: PaneCount): LauncherPane {
	const validPanes: LauncherPane[] = paneCount >= 3
		? ['left', 'center', 'right']
		: ['left', 'right'];

	if (pane && validPanes.includes(pane)) {
		return pane;
	}

	return 'left';
}

/**
 * グループの所属ペインを正規化する
 * @param {LauncherPane | undefined} pane ペイン
 * @param {PaneCount} paneCount ペイン数
 * @returns {LauncherPane} 正規化後ペイン
 */
function resolveGroupPane(pane: LauncherPane | undefined, paneCount: PaneCount): LauncherPane {
	const validPanes: LauncherPane[] = paneCount >= 3
		? ['left', 'center', 'right']
		: ['left', 'right'];

	if (pane && validPanes.includes(pane)) {
		return pane;
	}

	if (pane === 'center') {
		return 'left';
	}

	return 'left';
}

/**
 * settings を正規化する（欠落フィールドを補完）
 * @param {LauncherSettings} settings 設定
 * @returns {LauncherSettings} 正規化後設定
 */
function normalizeSettings(settings: LauncherSettings): LauncherSettings {
	const defaults  = createDefaultLauncherData().settings;
	const paneCount = resolvePaneCount({ ...defaults, ...settings });

	return {
		...defaults,
		...settings,
		window: {
			...defaults.window,
			...settings.window,
		},
		rememberWindowSizeOnLaunch: settings.rememberWindowSizeOnLaunch ?? false,
		paneCount,
		uncategorizedPane         : resolveUncategorizedPane(settings.uncategorizedPane, paneCount),
		groupExpandedStates       : settings.groupExpandedStates ?? {},
	};
}

/**
 * グループ定義を正規化する
 * @param {LauncherData} data データ
 * @returns {LauncherData} 正規化後データ
 */
function normalizeLauncherData(data: LauncherData): LauncherData {
	data.settings = normalizeSettings(data.settings);

	const paneCount = data.settings.paneCount;
	const validIds  = new Set(data.groups.map((group) => group.id));

	if (data.settings.groupExpandedStates) {
		for (const groupId of Object.keys(data.settings.groupExpandedStates)) {
			if (!validIds.has(groupId)) {
				delete data.settings.groupExpandedStates[groupId];
			}
		}
	}

	for (const group of data.groups) {
		if (!group.isUncategorized) {
			group.pane = resolveGroupPane(group.pane, paneCount);
		}
	}

	return data;
}

/**
 * app-config.json のパス（固定位置）
 * @returns {string} 絶対パス
 */
export function getAppConfigPath(): string {
	return path.join(app.getPath('userData'), 'app-config.json');
}

/**
 * 既定 dataDir パス
 * @returns {string} 絶対パス
 */
export function getDefaultDataDir(): string {
	return path.join(app.getPath('userData'), DEFAULT_DATA_DIR_NAME);
}

/**
 * app-config.json を読み込む（存在しなければ作成）
 * @returns {AppConfig} 設定
 */
export function loadAppConfig(): AppConfig {
	const configPath = getAppConfigPath();

	if (!fs.existsSync(configPath)) {
		const defaultConfig: AppConfig = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			dataDir      : getDefaultDataDir(),
		};

		saveAppConfig(defaultConfig);
		return defaultConfig;
	}

	const raw    = fs.readFileSync(configPath, 'utf8');
	const parsed = JSON.parse(raw) as AppConfig;

	if (!parsed.dataDir) {
		parsed.dataDir = getDefaultDataDir();
	}

	return parsed;
}

/**
 * app-config.json をアトミック保存する
 * @param {AppConfig} config 設定
 * @returns {void}
 */
export function saveAppConfig(config: AppConfig): void {
	const configPath = getAppConfigPath();
	const configDir  = path.dirname(configPath);

	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true });
	}

	writeJsonAtomic(configPath, config);
}

/**
 * dataDir 内の launcher-data.json パス
 * @param {string} dataDir データディレクトリ
 * @returns {string} 絶対パス
 */
export function getLauncherDataPath(dataDir: string): string {
	return path.join(dataDir, 'launcher-data.json');
}

/**
 * バックアップディレクトリパス
 * @param {string} dataDir データディレクトリ
 * @returns {string} 絶対パス
 */
function getBackupDir(dataDir: string): string {
	return path.join(dataDir, 'backups');
}

/**
 * JSON をアトミック書き込みする
 * @param {string} filePath 保存先
 * @param {unknown} data 保存データ
 * @returns {void}
 */
function writeJsonAtomic(filePath: string, data: unknown): void {
	const dir      = path.dirname(filePath);
	const tempPath = `${filePath}.${process.pid}.tmp`;

	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const content = `${JSON.stringify(data, null, 2)}\n`;
	const fd      = fs.openSync(tempPath, 'w');

	try {
		fs.writeSync(fd, content, 0, 'utf8');
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}

	fs.renameSync(tempPath, filePath);
}

/**
 * バックアップを作成する
 * @param {string} dataPath launcher-data.json パス
 * @returns {void}
 */
function createBackup(dataPath: string): void {
	if (!fs.existsSync(dataPath)) {
		return;
	}

	const dataDir   = path.dirname(dataPath);
	const backupDir = getBackupDir(dataDir);

	if (!fs.existsSync(backupDir)) {
		fs.mkdirSync(backupDir, { recursive: true });
	}

	const now   = new Date();
	const stamp = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, '0'),
		String(now.getDate()).padStart(2, '0'),
	].join('') + '-' + [
		String(now.getHours()).padStart(2, '0'),
		String(now.getMinutes()).padStart(2, '0'),
		String(now.getSeconds()).padStart(2, '0'),
	].join('');

	const backupPath = path.join(backupDir, `launcher-data.${stamp}.json`);
	fs.copyFileSync(dataPath, backupPath);
	purgeOldBackups(backupDir);
}

/**
 * 古いバックアップを削除する
 * @param {string} backupDir バックアップディレクトリ
 * @returns {void}
 */
function purgeOldBackups(backupDir: string): void {
	const files = fs.readdirSync(backupDir)
		.filter((f) => f.startsWith('launcher-data.') && f.endsWith('.json'))
		.map((f) => ({
			name: f,
			path: path.join(backupDir, f),
			mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
		}))
		.sort((a, b) => b.mtime - a.mtime);

	for (const file of files.slice(BACKUP_RETENTION_COUNT)) {
		fs.unlinkSync(file.path);
	}
}

/**
 * 最新の有効なバックアップから復旧を試みる
 * @param {string} dataDir データディレクトリ
 * @returns {LauncherData | null} 復旧データ
 */
function recoverFromBackup(dataDir: string): LauncherData | null {
	const backupDir = getBackupDir(dataDir);

	if (!fs.existsSync(backupDir)) {
		return null;
	}

	const files = fs.readdirSync(backupDir)
		.filter((f) => f.startsWith('launcher-data.') && f.endsWith('.json'))
		.map((f) => ({
			path : path.join(backupDir, f),
			mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
		}))
		.sort((a, b) => b.mtime - a.mtime);

	for (const file of files) {
		try {
			const raw  = fs.readFileSync(file.path, 'utf8');
			const data = JSON.parse(raw) as LauncherData;

			if (data.schemaVersion && data.settings && Array.isArray(data.groups) && Array.isArray(data.apps)) {
				logger.warn('Recovered launcher-data from backup', { backup: file.path });
				return data;
			}
		} catch {
			// 次のバックアップを試行
		}
	}

	return null;
}

/** インメモリ上の最新データ */
let cachedData: LauncherData | null = null;
let cachedDataDir: string | null    = null;

/**
 * launcher-data.json を読み込む
 * @returns {LoadDataResult} 読込結果
 */
export function loadLauncherData(): LoadDataResult {
	try {
		const appConfig = loadAppConfig();
		const dataDir   = appConfig.dataDir;
		const dataPath  = getLauncherDataPath(dataDir);

		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}

		if (!fs.existsSync(dataPath)) {
			const defaultData = createDefaultLauncherData();
			saveLauncherData(defaultData);
			cachedData    = defaultData;
			cachedDataDir = dataDir;
			return { success: true, data: defaultData };
		}

		try {
			const raw  = fs.readFileSync(dataPath, 'utf8');
			const data = JSON.parse(raw) as LauncherData;

			normalizeLauncherData(data);

			cachedData    = data;
			cachedDataDir = dataDir;
			return { success: true, data };
		} catch (parseError) {
			logger.error('Failed to parse launcher-data.json', {
				error: parseError instanceof Error ? parseError.message : String(parseError),
			});

			const recovered = recoverFromBackup(dataDir);

			if (recovered) {
				normalizeLauncherData(recovered);
				saveLauncherData(recovered);
				cachedData    = recovered;
				cachedDataDir = dataDir;
				return { success: true, data: recovered, recoveredFromBackup: true };
			}

			const defaultData = createDefaultLauncherData();
			saveLauncherData(defaultData);
			cachedData    = defaultData;
			cachedDataDir = dataDir;
			return {
				success: true,
				data   : defaultData,
				error  : 'Data file was corrupted. Reset to default.',
			};
		}
	} catch (error) {
		logger.error('Failed to load launcher data', {
			error: error instanceof Error ? error.message : String(error),
		});

		return {
			success: false,
			error  : error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * launcher-data.json を保存する
 * @param {LauncherData} data 保存データ
 * @returns {SaveResult} 保存結果
 */
export function saveLauncherData(data: LauncherData): SaveResult {
	try {
		const appConfig = loadAppConfig();
		const dataDir   = appConfig.dataDir;
		const dataPath  = getLauncherDataPath(dataDir);

		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}

		createBackup(dataPath);
		writeJsonAtomic(dataPath, data);

		cachedData    = data;
		cachedDataDir = dataDir;

		return { success: true };
	} catch (error) {
		logger.error('Failed to save launcher data', {
			error: error instanceof Error ? error.message : String(error),
		});

		return {
			success: false,
			error  : error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * キャッシュ済みデータを取得する
 * @returns {LauncherData | null} データ
 */
export function getCachedData(): LauncherData | null {
	return cachedData;
}

/**
 * 既定 settings を取得する
 * @returns {LauncherSettings} 既定 settings
 */
export function getDefaultSettings(): LauncherSettings {
	return createDefaultLauncherData().settings;
}

/**
 * app-config 参照情報を取得する
 * @returns {{ dataDir: string; defaultDataDir: string }} 設定情報
 */
export function getConfigInfo(): { dataDir: string; defaultDataDir: string } {
	const config = loadAppConfig();

	return {
		dataDir       : config.dataDir,
		defaultDataDir: getDefaultDataDir(),
	};
}

/**
 * dataDir を移行する
 * @param {string} newDir 新しい dataDir
 * @returns {MigrateDataDirResult} 移行結果
 */
export function migrateDataDir(newDir: string): MigrateDataDirResult {
	const normalized = path.resolve(newDir.trim());

	if (!normalized) {
		return {
			success: false,
			error  : '保存先フォルダが指定されていません。',
		};
	}

	const currentConfig = loadAppConfig();
	const oldDir        = path.resolve(currentConfig.dataDir);

	if (normalized === oldDir) {
		return {
			success: true,
			dataDir: normalized,
		};
	}

	let configUpdated     = false;
	const previousDataDir = currentConfig.dataDir;

	try {
		if (!fs.existsSync(normalized)) {
			fs.mkdirSync(normalized, { recursive: true });
		}

		const testFile = path.join(normalized, `.write-test-${process.pid}`);

		fs.writeFileSync(testFile, 'ok', 'utf8');
		fs.unlinkSync(testFile);

		const oldDataPath  = getLauncherDataPath(oldDir);
		const newDataPath  = getLauncherDataPath(normalized);
		const oldBackupDir = getBackupDir(oldDir);
		const newBackupDir = getBackupDir(normalized);

		if (fs.existsSync(newDataPath)) {
			// 既存データがある場合は上書きせず、参照先の切り替えのみ行う
		} else if (fs.existsSync(oldDataPath)) {
			fs.copyFileSync(oldDataPath, newDataPath);
		} else if (cachedData) {
			writeJsonAtomic(newDataPath, cachedData);
		} else {
			writeJsonAtomic(newDataPath, createDefaultLauncherData());
		}

		if (fs.existsSync(newBackupDir)) {
			// 既存バックアップがある場合は上書きしない
		} else if (fs.existsSync(oldBackupDir)) {
			if (!fs.existsSync(newBackupDir)) {
				fs.mkdirSync(newBackupDir, { recursive: true });
			}

			for (const file of fs.readdirSync(oldBackupDir)) {
				const sourcePath = path.join(oldBackupDir, file);

				if (fs.statSync(sourcePath).isFile()) {
					fs.copyFileSync(sourcePath, path.join(newBackupDir, file));
				}
			}
		}

		currentConfig.dataDir = normalized;
		saveAppConfig(currentConfig);
		configUpdated = true;

		cachedDataDir = normalized;

		const loadResult = loadLauncherData();

		if (loadResult.data) {
			cachedData = loadResult.data;
		}

		logger.info('Migrated dataDir', { from: oldDir, to: normalized });

		return {
			success: true,
			dataDir: normalized,
		};
	} catch (error) {
		if (configUpdated) {
			try {
				currentConfig.dataDir = previousDataDir;
				saveAppConfig(currentConfig);
				cachedDataDir = previousDataDir;
			} catch (rollbackError) {
				logger.error('Failed to rollback dataDir config', {
					error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
				});
			}
		}

		const message = error instanceof Error ? error.message : String(error);

		logger.error('Failed to migrate dataDir', {
			error : message,
			newDir: normalized,
		});

		return {
			success: false,
			error  : message,
		};
	}
}

/**
 * キャッシュ済み dataDir を取得する
 * @returns {string | null} dataDir
 */
export function getCachedDataDir(): string | null {
	return cachedDataDir;
}

/**
 * 終了時に現在のウィンドウサイズを保存する
 * @param {BrowserWindow} win ウィンドウ
 * @returns {void}
 */
export function persistCurrentWindowSize(win: BrowserWindow): void {
	const data = getCachedData();

	if (!data?.settings.rememberWindowSizeOnLaunch) {
		return;
	}

	const paneCount             = data?.settings.paneCount ?? 1;
	const limits                = getWindowSizeLimits(win, paneCount);
	const [rawWidth, rawHeight] = win.getSize();
	const size                  = clampWindowSize(rawWidth, rawHeight, limits);

	if (data.settings.window.width === size.width && data.settings.window.height === size.height) {
		return;
	}

	data.settings.window.width  = size.width;
	data.settings.window.height = size.height;
	saveLauncherData(data);
}
