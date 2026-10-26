/**
 * launcher-data.json と app-config.json の読み書き、バックアップ、保存先の移行を行う
 * 画面状態は持たず、正規化済みのデータと成否を返す
 * @file
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { logger } from './logger';
import { resolveDefaultDataDir } from './portable-mode';
import { isPortableRuntime } from './portable-runtime';
import { clampWindowSize, getWindowSizeLimits } from './window';
import type { AppConfig, ConfigInfo, LauncherData, LauncherPane, LauncherSettings, LoadDataResult, MigrateDataDirResult, PaneCount, SaveResult } from './types';

/** 現行スキーマバージョン */
export const CURRENT_SCHEMA_VERSION = 1;

/** バックアップ保持世代数 */
const BACKUP_RETENTION_COUNT = 10;

/** デフォルトの launcher-data */
export function createDefaultLauncherData(): LauncherData {
	// 未分類グループの ID。保存のたびに新規にはしない
	const uncategorizedId = `g-${randomUUID()}`;

	return {
		// この初期データのスキーマ
		schemaVersion: CURRENT_SCHEMA_VERSION,
		// 画面と起動の初期設定
		settings: {
			// 起動時にグループをすべて開く
			toggleInitialState: 'expandAll',
			// 初期ウィンドウサイズ。単位は px
			window: {
				// 初期幅。単位は px
				width: 480,
				// 初期高さ。単位は px
				height: 720
			},
			// OS のアプリモードに追従する
			appearance: 'system',
			// 起動後もランチャーを閉じない
			launchBehavior: 'stay',
			// 終了時のウィンドウサイズを次回に使わない
			rememberWindowSizeOnLaunch: false,
			// 初期ペイン数
			paneCount: 1,
			// 未分類グループを置くペイン
			uncategorizedPane: 'left'
		},
		// 初期グループ。未分類だけ
		groups: [
			{
				// 未分類グループの ID
				id: uncategorizedId,
				// 表示名
				name: '未分類',
				// 並び順。大きいほど後ろ
				order: 9999,
				// 削除できない未分類グループである
				isUncategorized: true
			}
		],
		// 登録アプリ。初期は空
		apps: []
	};
}

/**
 * 設定からペイン数を解決する（dualPaneEnabled からの移行を含む）
 * @param {LauncherSettings} settings 設定
 * @returns {PaneCount} ペイン数
 */
function resolvePaneCount(settings: LauncherSettings): PaneCount {
	// 1、2、3 のいずれかのペイン数が保存されている
	if (settings.paneCount === 1 || settings.paneCount === 2 || settings.paneCount === 3) {
		return settings.paneCount;
	}

	// 旧形式の 2 ペイン指定が残っている
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
	// そのペイン数で選べる位置。3 未満に中央は無い
	const validPanes: LauncherPane[] = paneCount >= 3 ? ['left', 'center', 'right'] : ['left', 'right'];

	// 保存値がそのペイン数で有効である
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
	// そのペイン数で選べる位置。3 未満に中央は無い
	const validPanes: LauncherPane[] = paneCount >= 3 ? ['left', 'center', 'right'] : ['left', 'right'];

	// 保存値がそのペイン数で有効である
	if (pane && validPanes.includes(pane)) {
		return pane;
	}

	// 中央指定が、中央の無いペイン数に残っている
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
	// 欠落フィールドを埋める既定値
	const defaults  = createDefaultLauncherData().settings;
	// 旧形式を含めて決めたペイン数
	const paneCount = resolvePaneCount({ ...defaults, ...settings });

	return {
		...defaults,
		...settings,
		// 幅と高さ。欠落側は既定値
		window: {
			...defaults.window,
			...settings.window
		},
		// サイズ記憶の指定。未設定は記憶しない
		rememberWindowSizeOnLaunch: settings.rememberWindowSizeOnLaunch ?? false,
		// 旧形式を含めて決めたペイン数
		paneCount,
		// 未分類グループのペイン。無効値は左
		uncategorizedPane: resolveUncategorizedPane(settings.uncategorizedPane, paneCount),
		// グループごとの展開状態。未設定は空
		groupExpandedStates: settings.groupExpandedStates ?? {}
	};
}

/**
 * グループ定義を正規化する
 * @param {LauncherData} data データ
 * @returns {LauncherData} 正規化後データ
 */
function normalizeLauncherData(data: LauncherData): LauncherData {
	// ----------------------------------------------
	// 設定、展開状態、グループのペインをそろえる
	// ----------------------------------------------
	data.settings = normalizeSettings(data.settings);

	// 正規化後のペイン数
	const paneCount = data.settings.paneCount;
	// 残っているグループ ID。展開状態の掃除に使う
	const validIds  = new Set(data.groups.map((group) => group.id));

	// グループの展開状態が保存されている
	if (data.settings.groupExpandedStates) {
		for (const groupId of Object.keys(data.settings.groupExpandedStates)) {
			// 対応するグループが消えている
			if (!validIds.has(groupId)) {
				delete data.settings.groupExpandedStates[groupId];
			}
		}
	}

	for (const group of data.groups) {
		// 未分類以外はペイン数に合わせて所属を直す
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
	return resolveDefaultDataDir(app.getPath('userData'), isPortableRuntime());
}

/**
 * app-config.json を読み込む（存在しなければ作成）
 * @returns {AppConfig} 設定
 */
export function loadAppConfig(): AppConfig {
	// ポータブル実行では dataDir を userData に固定する
	if (isPortableRuntime()) {
		return loadPortableAppConfig();
	}

	// app-config.json の絶対パス
	const configPath = getAppConfigPath();

	// 設定ファイルがまだ無い
	if (!fs.existsSync(configPath)) {
		// 初回に書く既定の保存先
		const defaultConfig: AppConfig = {
			// 現行スキーマ
			schemaVersion: CURRENT_SCHEMA_VERSION,
			// 既定のデータディレクトリ
			dataDir: getDefaultDataDir()
		};

		saveAppConfig(defaultConfig);
		return defaultConfig;
	}

	// ファイルの生テキスト
	const raw    = fs.readFileSync(configPath, 'utf8');
	// 解析した設定。dataDir が欠けることがある
	const parsed = JSON.parse(raw) as AppConfig;

	// 保存先が空である
	if (!parsed.dataDir) {
		parsed.dataDir = getDefaultDataDir();
	}

	return parsed;
}

/**
 * ポータブル版の app-config を読み込む。dataDir は常に userData へ固定する
 * @returns {AppConfig} 設定
 */
function loadPortableAppConfig(): AppConfig {
	// ポータブル版で使う dataDir。常に userData
	const portableDataDir   = getDefaultDataDir();
	// 書き戻す設定。dataDir は固定
	const config: AppConfig = {
		// 現行スキーマ
		schemaVersion: CURRENT_SCHEMA_VERSION,
		// ポータブル版のデータディレクトリ
		dataDir: portableDataDir
	};
	// app-config.json の絶対パス
	const configPath        = getAppConfigPath();

	// 設定ファイルがまだ無い
	if (!fs.existsSync(configPath)) {
		saveAppConfig(config);
		return config;
	}

	try {
		// 既存ファイルの設定。壊れていれば catch へ落ちる
		const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig;

		// 保存先があり、かつポータブルの dataDir と違う
		if (parsed.dataDir && path.resolve(parsed.dataDir) !== path.resolve(portableDataDir)) {
			logger.warn('Ignoring non-portable dataDir in portable mode', {
				// 無視した保存先
				ignored: parsed.dataDir,
				// 実際に使う保存先
				dataDir: portableDataDir
			});
			saveAppConfig(config);
		}
	} catch (error) {
		logger.warn('Failed to parse portable app-config.json', {
			// 解析失敗の理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
		});
		saveAppConfig(config);
	}

	return config;
}

/**
 * app-config.json をアトミック保存する
 * @param {AppConfig} config 設定
 */
export function saveAppConfig(config: AppConfig): void {
	// app-config.json の絶対パス
	const configPath = getAppConfigPath();
	// 設定ファイルの親ディレクトリ
	const configDir  = path.dirname(configPath);

	// 親ディレクトリがまだ無い
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
 */
function writeJsonAtomic(filePath: string, data: unknown): void {
	// 保存先の親ディレクトリ
	const dir      = path.dirname(filePath);
	// 置換前に書く一時ファイル。プロセス ID で衝突を避ける
	const tempPath = `${filePath}.${process.pid}.tmp`;

	// 親ディレクトリがまだ無い
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	// 末尾改行付きの JSON
	const content = `${JSON.stringify(data, null, 2)}\n`;
	// 一時ファイルのファイル記述子
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
 */
function createBackup(dataPath: string): void {
	// まだ保存ファイルが無い
	if (!fs.existsSync(dataPath)) {
		return;
	}

	// launcher-data.json の親ディレクトリ
	const dataDir   = path.dirname(dataPath);
	// 世代バックアップのディレクトリ
	const backupDir = getBackupDir(dataDir);

	// バックアップ先がまだ無い
	if (!fs.existsSync(backupDir)) {
		fs.mkdirSync(backupDir, { recursive: true });
	}

	// ファイル名に使う現在時刻
	const now   = new Date();
	// 年月日時分秒。月日と時分秒は 2 桁
	const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('') + '-' + [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('');

	// 今回のバックアップファイル
	const backupPath = path.join(backupDir, `launcher-data.${stamp}.json`);
	fs.copyFileSync(dataPath, backupPath);
	purgeOldBackups(backupDir);
}

/**
 * 古いバックアップを削除する
 * @param {string} backupDir バックアップディレクトリ
 */
function purgeOldBackups(backupDir: string): void {
	// 新しい順に並べたバックアップファイル
	const files = fs
		.readdirSync(backupDir)
		.filter((f) => f.startsWith('launcher-data.') && f.endsWith('.json'))
		.map((f) => ({
			// ファイル名
			name: f,
			// バックアップの絶対パス
			path: path.join(backupDir, f),
			// 更新時刻。単位はミリ秒。新しい順の並べ替えに使う
			mtime: fs.statSync(path.join(backupDir, f)).mtimeMs
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
	// バックアップディレクトリ。無ければ復旧しない
	const backupDir = getBackupDir(dataDir);

	// バックアップが一度も無い
	if (!fs.existsSync(backupDir)) {
		return null;
	}

	// 新しい順に並べたバックアップファイル
	const files = fs
		.readdirSync(backupDir)
		.filter((f) => f.startsWith('launcher-data.') && f.endsWith('.json'))
		.map((f) => ({
			// バックアップの絶対パス
			path: path.join(backupDir, f),
			// 更新時刻。単位はミリ秒。新しい順の並べ替えに使う
			mtime: fs.statSync(path.join(backupDir, f)).mtimeMs
		}))
		.sort((a, b) => b.mtime - a.mtime);

	for (const file of files) {
		try {
			// ファイルの生テキスト
			const raw  = fs.readFileSync(file.path, 'utf8');
			// 解析したランチャーデータ。必須項目が欠けることがある
			const data = JSON.parse(raw) as LauncherData;

			// スキーマ、設定、グループ、アプリが揃っている
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
/** キャッシュが対応する dataDir。未読込は null */
let cachedDataDir: string | null    = null;

/**
 * launcher-data.json を読み込む
 * @returns {LoadDataResult} 読込結果
 */
export function loadLauncherData(): LoadDataResult {
	try {
		// ----------------------------------------------
		// 保存先が無ければ初期データを作る
		// ----------------------------------------------
		// 保存先を含む app-config
		const appConfig = loadAppConfig();
		// launcher-data.json を置くディレクトリ
		const dataDir   = appConfig.dataDir;
		// launcher-data.json の絶対パス
		const dataPath  = getLauncherDataPath(dataDir);

		// データディレクトリがまだ無い
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}

		// データファイルがまだ無い
		if (!fs.existsSync(dataPath)) {
			// 空のランチャーデータ
			const defaultData = createDefaultLauncherData();
			saveLauncherData(defaultData);
			cachedData    = defaultData;
			cachedDataDir = dataDir;
			return { success: true, data: defaultData };
		}

		try {
			// ファイルの生テキスト
			const raw  = fs.readFileSync(dataPath, 'utf8');
			// 解析したランチャーデータ。壊れていれば catch へ落ちる
			const data = JSON.parse(raw) as LauncherData;

			normalizeLauncherData(data);

			cachedData    = data;
			cachedDataDir = dataDir;
			return { success: true, data };
		} catch (parseError) {
			logger.error('Failed to parse launcher-data.json', {
				// 解析失敗の理由。Error 以外は文字列化する
				error: parseError instanceof Error ? parseError.message : String(parseError)
			});

			// 新しいバックアップから復旧したデータ。無ければ null
			const recovered = recoverFromBackup(dataDir);

			// 読めるバックアップがあった
			if (recovered) {
				normalizeLauncherData(recovered);
				saveLauncherData(recovered);
				cachedData    = recovered;
				cachedDataDir = dataDir;
				return { success: true, data: recovered, recoveredFromBackup: true };
			}

			// バックアップも無いときの初期データ
			const defaultData = createDefaultLauncherData();
			saveLauncherData(defaultData);
			cachedData    = defaultData;
			cachedDataDir = dataDir;
			return {
				// 初期データで読み込み自体は成功
				success: true,
				// 作り直した初期データ
				data: defaultData,
				// 壊れていたため初期化した説明
				error: 'Data file was corrupted. Reset to default.'
			};
		}
	} catch (error) {
		logger.error('Failed to load launcher data', {
			// 読込失敗の理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
		});

		return {
			// 呼び出し側は失敗として扱う
			success: false,
			// 読込失敗の理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
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
		// 保存先を含む app-config
		const appConfig = loadAppConfig();
		// launcher-data.json を置くディレクトリ
		const dataDir   = appConfig.dataDir;
		// launcher-data.json の絶対パス
		const dataPath  = getLauncherDataPath(dataDir);

		// データディレクトリがまだ無い
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
			// 保存失敗の理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
		});

		return {
			// 呼び出し側は失敗として扱う
			success: false,
			// 保存失敗の理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
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
export function getConfigInfo(): ConfigInfo {
	// 現在の app-config
	const config = loadAppConfig();

	return {
		// 今参照している dataDir
		dataDir: config.dataDir,
		// インストール形態ごとの既定 dataDir
		defaultDataDir: getDefaultDataDir(),
		// ポータブル実行なら true
		isPortable: isPortableRuntime()
	};
}

/**
 * dataDir を移行する
 * @param {string} newDir 新しい dataDir
 * @returns {MigrateDataDirResult} 移行結果
 */
export function migrateDataDir(newDir: string): MigrateDataDirResult {
	// ----------------------------------------------
	// 移行できる保存先か確かめる
	// ----------------------------------------------
	// ポータブル実行では保存先を固定している
	if (isPortableRuntime()) {
		return {
			// 移行しない
			success: false,
			// 利用者へ示す拒否理由
			error: 'ポータブル版ではデータ保存先を変更できません。'
		};
	}

	// 絶対パスへ正規化した移行先。空白だけなら空になり得る
	const normalized = path.resolve(newDir.trim());

	// 移行先が空である
	if (!normalized) {
		return {
			// 移行しない
			success: false,
			// 利用者へ示す入力不足
			error: '保存先フォルダが指定されていません。'
		};
	}

	// 現在の app-config
	const currentConfig = loadAppConfig();
	// 絶対パスへ正規化した現在の dataDir
	const oldDir        = path.resolve(currentConfig.dataDir);

	// 移行先が現在と同じである
	if (normalized === oldDir) {
		return {
			// コピーは不要で成功
			success: true,
			// そのまま使う dataDir
			dataDir: normalized
		};
	}

	// app-config を新しい dataDir へ書き終えたか。失敗時の戻しに使う。未書き込みは false
	let configUpdated     = false;
	// 戻し用の元 dataDir。正規化前の保存値
	const previousDataDir = currentConfig.dataDir;

	try {
		// 移行先ディレクトリがまだ無い
		if (!fs.existsSync(normalized)) {
			fs.mkdirSync(normalized, { recursive: true });
		}

		// 書き込み可否を確かめる一時ファイル。確認後に消す
		const testFile = path.join(normalized, `.write-test-${process.pid}`);

		fs.writeFileSync(testFile, 'ok', 'utf8');
		fs.unlinkSync(testFile);

		// ----------------------------------------------
		// データとバックアップをコピーする
		// ----------------------------------------------
		// 移行元の launcher-data.json
		const oldDataPath  = getLauncherDataPath(oldDir);
		// 移行先の launcher-data.json
		const newDataPath  = getLauncherDataPath(normalized);
		// 移行元のバックアップディレクトリ
		const oldBackupDir = getBackupDir(oldDir);
		// 移行先のバックアップディレクトリ
		const newBackupDir = getBackupDir(normalized);

		// 移行先に launcher-data.json が既にある
		if (fs.existsSync(newDataPath)) {
			// 既存データがある場合は上書きせず、参照先の切り替えのみ行う
			// 移行先に無く、移行元にはある
		} else if (fs.existsSync(oldDataPath)) {
			fs.copyFileSync(oldDataPath, newDataPath);
			// ファイルが無く、メモリ上のキャッシュがある
		} else if (cachedData) {
			writeJsonAtomic(newDataPath, cachedData);
		} else {
			writeJsonAtomic(newDataPath, createDefaultLauncherData());
		}

		// 移行先にバックアップディレクトリが既にある
		if (fs.existsSync(newBackupDir)) {
			// 既存バックアップがある場合は上書きしない
			// 移行先に無く、移行元にはある
		} else if (fs.existsSync(oldBackupDir)) {
			// コピー先ディレクトリがまだ無い
			if (!fs.existsSync(newBackupDir)) {
				fs.mkdirSync(newBackupDir, { recursive: true });
			}

			for (const file of fs.readdirSync(oldBackupDir)) {
				// コピー元の絶対パス
				const sourcePath = path.join(oldBackupDir, file);

				// ディレクトリではなくファイルである
				if (fs.statSync(sourcePath).isFile()) {
					fs.copyFileSync(sourcePath, path.join(newBackupDir, file));
				}
			}
		}

		currentConfig.dataDir = normalized;
		saveAppConfig(currentConfig);
		configUpdated = true;

		cachedDataDir = normalized;

		// 移行後に読み直したデータ。失敗時は data が無い
		const loadResult = loadLauncherData();

		// 読み直したデータがある
		if (loadResult.data) {
			cachedData = loadResult.data;
		}

		logger.info('Migrated dataDir', { from: oldDir, to: normalized });

		return {
			// 参照先の切り替えまで成功
			success: true,
			// 新しい dataDir
			dataDir: normalized
		};
	} catch (error) {
		// app-config を書き換えたあとで失敗した
		if (configUpdated) {
			try {
				currentConfig.dataDir = previousDataDir;
				saveAppConfig(currentConfig);
				cachedDataDir = previousDataDir;
			} catch (rollbackError) {
				logger.error('Failed to rollback dataDir config', {
					// 設定を戻せなかった理由。Error 以外は文字列化する
					error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
				});
			}
		}

		// ログと戻り値に載せる失敗理由。Error 以外は文字列化する
		const message = error instanceof Error ? error.message : String(error);

		logger.error('Failed to migrate dataDir', {
			// 移行失敗の理由
			error: message,
			// 指定された移行先
			newDir: normalized
		});

		return {
			// 呼び出し側は失敗として扱う
			success: false,
			// 移行失敗の理由
			error: message
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
 */
export function persistCurrentWindowSize(win: BrowserWindow): void {
	// キャッシュ済みデータ。未読込、またはサイズ記憶がオフなら保存しない
	const data = getCachedData();

	// サイズを覚えない設定である
	if (!data?.settings.rememberWindowSizeOnLaunch) {
		return;
	}

	// 保存済みペイン数。未設定は 1
	const paneCount             = data?.settings.paneCount ?? 1;
	// 作業領域に収まる幅と高さの範囲。単位は px
	const limits                = getWindowSizeLimits(win, paneCount);
	// 終了時点の幅と高さ。単位は px
	const [rawWidth, rawHeight] = win.getSize();
	// 下限と上限へ丸めたサイズ。単位は px
	const size                  = clampWindowSize(rawWidth, rawHeight, limits);

	// 幅も高さも保存済みと同じである
	if (data.settings.window.width === size.width && data.settings.window.height === size.height) {
		return;
	}

	data.settings.window.width  = size.width;
	data.settings.window.height = size.height;
	saveLauncherData(data);
}
