import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { logger } from './logger';
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
 * 自動更新を初期化する（パッケージ版のみ）
 * @param {BrowserWindow} win メインウィンドウ
 * @returns {void}
 */
export function initAutoUpdater(win: BrowserWindow): void {
	if (!app.isPackaged) {
		logger.info('Auto-update is disabled in development mode');
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
	if (!app.isPackaged) {
		return Promise.resolve({
			status        : 'not-packaged',
			currentVersion: app.getVersion(),
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
			});
		};

		/** 更新あり */
		const onAvailable = (info: { version: string }): void => {
			cleanup();
			resolve({
				status        : 'available',
				version       : info.version,
				currentVersion: app.getVersion(),
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
			});
		});
	});
}
