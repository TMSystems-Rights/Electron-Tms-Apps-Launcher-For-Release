import { app, BrowserWindow, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import {
	fetchLatestReleaseTag,
	isNewerRelease,
	normalizeVersionTag,
} from './github-release';
import { logger } from './logger';
import { resolveUpdateCheckMode } from './portable-mode';
import { isPortableRuntime } from './portable-runtime';
import {
	DEVELOPMENT_PORTAL_URL_VARIABLE_NAME,
	getOfficialPortalUrl,
	isAllowedOfficialPortalUrl,
	PORTAL_ENV_VARIABLE_NAME,
	resolvePortalEnvironment,
} from './portal-url';
import type { UpdateCheckResult, UpdateStatusPayload } from './types';

/** 起動直後の更新チェック待機時間（ms） */
const STARTUP_CHECK_DELAY_MS = 5000;

/** メインウィンドウ参照 */
let mainWindow: BrowserWindow | null = null;

/**
 * 更新エラーをユーザ向けメッセージに変換する
 * @param {string} message 生エラーメッセージ
 * @returns {string} 表示用メッセージ
 */
export function formatUpdateErrorMessage(message: string): string {
	if (message.includes('sha512 checksum mismatch')) {
		return 'アップデートファイルの検証に失敗しました。Release のファイル不整合の可能性があります。手動インストールを試してください。';
	}

	if (message.includes('Cannot parse blockmap')) {
		return 'アップデートの差分情報を取得できませんでした。再試行するか、手動インストールしてください。';
	}

	return `アップデートのダウンロードに失敗しました: ${message}`;
}

/**
 * ポータブル版の更新確認失敗メッセージ
 * @param {string} message 生エラー
 * @returns {string} 表示用メッセージ
 */
export function formatPortableUpdateErrorMessage(message: string): string {
	return `最新バージョンの確認に失敗しました: ${message}`;
}

/**
 * 公式ダウンロードページを許可リスト検証のうえ開く
 * @returns {Promise<void>}
 */
export async function openOfficialDownloadPage(): Promise<void> {
	const environment    = resolvePortalEnvironment({
		isPackaged: app.isPackaged,
		envValue  : process.env[PORTAL_ENV_VARIABLE_NAME],
	});
	const developmentUrl = process.env[DEVELOPMENT_PORTAL_URL_VARIABLE_NAME];
	const url            = getOfficialPortalUrl(environment, developmentUrl);

	if (!isAllowedOfficialPortalUrl(url, developmentUrl)) {
		logger.error('Refusing to open unapproved portal URL', { url });
		return;
	}

	await shell.openExternal(url);
}

/**
 * ポータブル版の更新案内ダイアログを表示する
 * @param {string} latestVersion 最新バージョン
 * @param {string} currentVersion 現在バージョン
 * @returns {Promise<void>}
 */
async function promptPortableUpdate(latestVersion: string, currentVersion: string): Promise<void> {
	const options = {
		type     : 'info' as const,
		title    : '新しいバージョンがあります',
		message  : `TMS-AppsLauncher v${latestVersion} が公開されています。`,
		detail   : [
			`現在のバージョンは v${currentVersion} です。`,
			'更新する場合は、公式ページからポータブル ZIP 版をダウンロードしてください。',
			'更新前に TMS-AppsLauncher を終了し、既存の data フォルダを新しいバージョンへ引き継いでください。',
		].join('\n'),
		buttons  : ['公式ダウンロードページを開く', '後で'],
		defaultId: 0,
		cancelId : 1,
		noLink   : true,
	};
	const result  = mainWindow
		? await dialog.showMessageBox(mainWindow, options)
		: await dialog.showMessageBox(options);

	if (result.response === 0) {
		await openOfficialDownloadPage();
	}
}

/**
 * GitHub Releases API でポータブル版の更新を確認する
 * @param {{ notifyUserOnError: boolean; promptIfAvailable: boolean }} options 通知方針
 * @returns {Promise<UpdateCheckResult>} 確認結果
 */
async function checkPortableUpdate(options: {
	notifyUserOnError: boolean;
	promptIfAvailable: boolean;
}): Promise<UpdateCheckResult> {
	const currentVersion = app.getVersion();

	notifyRenderer({ type: 'checking' });

	try {
		const latestTag     = await fetchLatestReleaseTag();
		const latestVersion = normalizeVersionTag(latestTag);

		if (!isNewerRelease(latestTag, currentVersion)) {
			logger.info('Portable application is up to date', {
				currentVersion,
				latestVersion,
			});
			notifyRenderer({ type: 'not-available' });

			return {
				status        : 'not-available',
				currentVersion,
				mode          : 'portable',
			};
		}

		logger.info('Portable application update available', {
			currentVersion,
			latestVersion,
		});
		notifyRenderer({
			type   : 'available',
			version: latestVersion,
			mode   : 'portable',
		});

		if (options.promptIfAvailable) {
			await promptPortableUpdate(latestVersion, currentVersion);
		}

		return {
			status        : 'available',
			version       : latestVersion,
			currentVersion,
			mode          : 'portable',
		};
	} catch (error) {
		const message   = error instanceof Error ? error.message : String(error);
		const formatted = formatPortableUpdateErrorMessage(message);

		logger.warn('Portable update check failed', { error: message });

		if (options.notifyUserOnError) {
			notifyRenderer({ type: 'error', message: formatted });
		}

		return {
			status        : 'error',
			currentVersion,
			error         : formatted,
			mode          : 'portable',
		};
	}
}

/**
 * ポータブル版の更新確認を初期化する。electron-updater は使わない。
 * @param {BrowserWindow} win メインウィンドウ
 * @returns {void}
 */
function initPortableUpdateChecker(win: BrowserWindow): void {
	mainWindow = win;

	logger.info('Portable update checker initialized (GitHub Releases API)');

	setTimeout(() => {
		void checkPortableUpdate({
			notifyUserOnError: false,
			promptIfAvailable: true,
		});
	}, STARTUP_CHECK_DELAY_MS);
}

/**
 * レンダラーへ更新状態を通知する
 * @param {UpdateStatusPayload} payload 通知内容
 * @returns {void}
 */
function notifyRenderer(payload: UpdateStatusPayload): void {
	mainWindow?.webContents.send('update:status', payload);
}

/**
 * ダウンロード完了後に再起動確認ダイアログを表示する
 * @param {string} version 新バージョン
 * @returns {Promise<void>}
 */
async function promptInstallUpdate(version: string): Promise<void> {
	if (!mainWindow) {
		return;
	}

	const result = await dialog.showMessageBox(mainWindow, {
		type      : 'info',
		title     : 'アップデートの準備完了',
		message   : `バージョン ${version} のアップデートをダウンロードしました。`,
		detail    : '今すぐ再起動してインストールしますか？',
		buttons   : ['今すぐ再起動', '後で'],
		defaultId : 0,
		cancelId  : 1,
		noLink    : true,
	});

	if (result.response === 0) {
		autoUpdater.quitAndInstall(false, true);
	}
}

/**
 * autoUpdater のイベントハンドラを登録する
 * @returns {void}
 */
function registerAutoUpdaterEvents(): void {
	autoUpdater.on('checking-for-update', () => {
		logger.info('Checking for application update');
		notifyRenderer({ type: 'checking' });
	});

	autoUpdater.on('update-available', (info) => {
		logger.info('Application update available', { version: info.version });
		notifyRenderer({ type: 'available', version: info.version });
	});

	autoUpdater.on('update-not-available', () => {
		logger.info('Application is up to date');
		notifyRenderer({ type: 'not-available' });
	});

	autoUpdater.on('download-progress', (progress) => {
		notifyRenderer({
			type   : 'download-progress',
			percent: progress.percent,
		});
	});

	autoUpdater.on('update-downloaded', (info) => {
		logger.info('Application update downloaded', { version: info.version });
		notifyRenderer({ type: 'downloaded', version: info.version });
		void promptInstallUpdate(info.version);
	});

	autoUpdater.on('error', (error) => {
		const message = error instanceof Error ? error.message : String(error);

		logger.error('Auto-update failed', { error: message });
		notifyRenderer({ type: 'error', message: formatUpdateErrorMessage(message) });
	});
}

/**
 * 配布形態に応じて更新確認を初期化する
 * @param {BrowserWindow} win メインウィンドウ
 * @returns {void}
 */
export function initUpdater(win: BrowserWindow): void {
	const mode = resolveUpdateCheckMode(app.isPackaged, isPortableRuntime());

	if (mode === 'github-release-api') {
		initPortableUpdateChecker(win);
		return;
	}

	if (mode === 'disabled') {
		logger.info('Auto-update is disabled in development mode');
		return;
	}

	initAutoUpdater(win);
}

/**
 * インストーラ版の自動更新を初期化する
 * @param {BrowserWindow} win メインウィンドウ
 * @returns {void}
 */
function initAutoUpdater(win: BrowserWindow): void {
	if (isPortableRuntime() || !app.isPackaged) {
		logger.warn('Refusing to initialize electron-updater');
		return;
	}

	mainWindow = win;

	autoUpdater.autoDownload         = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.logger               = {
		/** @param {unknown} message ログメッセージ */
		info : (message) => logger.info(String(message)),
		/** @param {unknown} message ログメッセージ */
		warn : (message) => logger.warn(String(message)),
		/** @param {unknown} message ログメッセージ */
		error: (message) => logger.error(String(message)),
		/** @param {unknown} message ログメッセージ */
		debug: (message) => logger.debug(String(message)),
	};

	registerAutoUpdaterEvents();

	setTimeout(() => {
		autoUpdater.checkForUpdates().catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);

			logger.warn('Startup update check failed', { error: message });
			notifyRenderer({ type: 'error', message: formatUpdateErrorMessage(message) });
		});
	}, STARTUP_CHECK_DELAY_MS);
}

/**
 * メインウィンドウ参照を更新する
 * @param {BrowserWindow | null} win ウィンドウ
 * @returns {void}
 */
export function setAutoUpdaterWindow(win: BrowserWindow | null): void {
	mainWindow = win;
}

/**
 * 手動で更新を確認する
 * @returns {Promise<UpdateCheckResult>} 確認結果
 */
export function checkForUpdatesManual(): Promise<UpdateCheckResult> {
	const mode = resolveUpdateCheckMode(app.isPackaged, isPortableRuntime());

	if (mode === 'disabled') {
		return Promise.resolve({
			status        : 'not-packaged',
			currentVersion: app.getVersion(),
		});
	}

	if (mode === 'github-release-api') {
		return checkPortableUpdate({
			notifyUserOnError: true,
			promptIfAvailable: true,
		});
	}

	return new Promise((resolve) => {
		/** イベントリスナーを解除する */
		const cleanup = (): void => {
			autoUpdater.removeListener('update-not-available', onNotAvailable);
			autoUpdater.removeListener('update-available', onAvailable);
			autoUpdater.removeListener('error', onError);
		};

		/** 更新なし */
		const onNotAvailable = (): void => {
			cleanup();
			resolve({
				status        : 'not-available',
				currentVersion: app.getVersion(),
				mode          : 'installer',
			});
		};

		/** 更新あり */
		const onAvailable = (info: { version: string }): void => {
			cleanup();
			resolve({
				status        : 'available',
				version       : info.version,
				currentVersion: app.getVersion(),
				mode          : 'installer',
			});
		};

		/** 更新確認エラー */
		const onError = (error: Error): void => {
			const formatted = formatUpdateErrorMessage(error.message);

			cleanup();
			resolve({
				status        : 'error',
				currentVersion: app.getVersion(),
				error         : formatted,
				mode          : 'installer',
			});
		};

		autoUpdater.once('update-not-available', onNotAvailable);
		autoUpdater.once('update-available', onAvailable);
		autoUpdater.once('error', onError);

		autoUpdater.checkForUpdates().catch((error: unknown) => {
			const rawMessage = error instanceof Error ? error.message : String(error);
			const formatted  = formatUpdateErrorMessage(rawMessage);

			cleanup();
			notifyRenderer({ type: 'error', message: formatted });
			resolve({
				status        : 'error',
				currentVersion: app.getVersion(),
				error         : formatted,
				mode          : 'installer',
			});
		});
	});
}
