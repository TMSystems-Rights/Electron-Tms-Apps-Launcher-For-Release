/**
 * インストーラ版は electron-updater、ポータブル版は GitHub Release API で更新を確認する
 * 配布形態の判定は portable-mode に任せ、このファイルは確認とダウンロードの進みを通知する
 * @file
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { fetchLatestReleaseTag, isNewerRelease, normalizeVersionTag } from './github-release';
import { logger } from './logger';
import { resolveUpdateCheckMode } from './portable-mode';
import { isPortableRuntime } from './portable-runtime';
import { DEVELOPMENT_PORTAL_URL_VARIABLE_NAME, getOfficialPortalUrl, isAllowedOfficialPortalUrl, PORTAL_ENV_VARIABLE_NAME, resolvePortalEnvironment } from './portal-url';
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
	// ----------------------------------------------
	// sha512 不一致。Release の exe と latest.yml が別ビルドのときに出る
	// ----------------------------------------------
	if (message.includes('sha512 checksum mismatch')) {
		return 'アップデートファイルの検証に失敗しました。Release のファイル不整合の可能性があります。手動インストールを試してください。';
	}

	// ----------------------------------------------
	// blockmap が壊れているか欠ける
	// ----------------------------------------------
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
	// ----------------------------------------------
	// パッケージかつ env が development のときだけ開発。それ以外のパッケージは本番
	// ----------------------------------------------
	const environment    = resolvePortalEnvironment({
		// パッケージ済みなら true。開発実行は false で常に開発ポータル
		isPackaged: app.isPackaged,
		// 未設定なら本番側。development のときだけ開発ポータル
		envValue: process.env[PORTAL_ENV_VARIABLE_NAME]
	});
	// 開発 URL。未設定は undefined で、組み立て結果は本番 URL に落ちる
	const developmentUrl = process.env[DEVELOPMENT_PORTAL_URL_VARIABLE_NAME];
	// 開く候補。許可判定の前なので、まだ外部ブラウザへは出さない
	const url            = getOfficialPortalUrl(environment, developmentUrl);

	// 候補が許可リストに無い。開発 URL が不正なときなども拒否する
	if (!isAllowedOfficialPortalUrl(url, developmentUrl)) {
		logger.error('Refusing to open unapproved portal URL', {
			// 拒否した候補。空にはしないが、許可外であり得る
			url
		});
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
	// ----------------------------------------------
	// 案内ダイアログ。0 が公式ページ、1 が後で
	// ----------------------------------------------
	const options = {
		// 情報ダイアログ。警告音は出さない
		type: 'info' as const,
		// ダイアログのタイトル
		title: '新しいバージョンがあります',
		// 本文。latestVersion は v を外した最新
		message: `TMS-AppsLauncher v${latestVersion} が公開されています。`,
		// 補足。現在版と、data フォルダの引き継ぎ
		detail: [`現在のバージョンは v${currentVersion} です。`, '更新する場合は、公式ページからポータブル ZIP 版をダウンロードしてください。', '更新前に TMS-AppsLauncher を終了し、既存の data フォルダを新しいバージョンへ引き継いでください。'].join('\n'),
		// 0 が公式ページ、1 が後で。空にはしない
		buttons: ['公式ダウンロードページを開く', '後で'],
		// Enter は公式ページを開く
		defaultId: 0,
		// Esc は後で。ブラウザは開かない
		cancelId: 1,
		// ボタンをリンク描画にしない
		noLink: true
	};
	// ボタン番号。ウィンドウが無いときは親なしダイアログ。0 が開く
	const result  = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);

	// 先頭ボタン。後で選んだときは何もしない
	if (result.response === 0) {
		await openOfficialDownloadPage();
	}
}

/**
 * GitHub Releases API でポータブル版の更新を確認する
 * @param {{ notifyUserOnError: boolean; promptIfAvailable: boolean }} options 通知方針
 * @returns {Promise<UpdateCheckResult>} 確認結果
 */
async function checkPortableUpdate(options: { notifyUserOnError: boolean; promptIfAvailable: boolean }): Promise<UpdateCheckResult> {
	// 実行中バージョン。比較の基準。空にはならない
	const currentVersion = app.getVersion();

	notifyRenderer({
		// 確認開始。バージョンはまだ無い
		type: 'checking'
	});

	try {
		// ----------------------------------------------
		// latest の tag。失敗は catch へ。空 tag は比較で新しくならない
		// ----------------------------------------------
		const latestTag     = await fetchLatestReleaseTag();
		// v を外した比較と表示用。空 tag は空文字
		const latestVersion = normalizeVersionTag(latestTag);

		// 最新が現在以下。案内ダイアログは出さない
		if (!isNewerRelease(latestTag, currentVersion)) {
			logger.info('Portable application is up to date', {
				// 比較に使った実行中バージョン
				currentVersion,
				// tag から v を外した最新。現在以下
				latestVersion
			});
			notifyRenderer({
				// 公開版は現在と同じかそれより古い
				type: 'not-available'
			});

			return {
				// 更新は無い
				status: 'not-available',
				// 実行中バージョン。空にはならない
				currentVersion,
				// ポータブル確認である印。electron-updater ではない
				mode: 'portable'
			};
		}

		// ----------------------------------------------
		// 新しい版を通知し、求められれば案内する
		// ----------------------------------------------
		logger.info('Portable application update available', {
			// 実行中バージョン
			currentVersion,
			// 現在より新しい公開版。v は外してある
			latestVersion
		});
		notifyRenderer({
			// ダウンロードはせず、新しい版があることだけ伝える
			type: 'available',
			// v を外した最新。空にはしない
			version: latestVersion,
			// ポータブル確認である印
			mode: 'portable'
		});

		// 新しさがあり、かつ案内フラグが真。両方が必要なときだけダイアログを出す
		if (options.promptIfAvailable) {
			await promptPortableUpdate(latestVersion, currentVersion);
		}

		return {
			// より新しい tag がある
			status: 'available',
			// v を外した最新版。空にはしない
			version: latestVersion,
			// 実行中バージョン
			currentVersion,
			// ポータブル確認である印
			mode: 'portable'
		};
	} catch (error) {
		// ----------------------------------------------
		// 生の失敗理由。Error でなければ文字列化。空のときもある
		// ----------------------------------------------
		const message   = error instanceof Error ? error.message : String(error);
		// 画面と戻り値に使う文。生の HTTP 文をそのまま出さない
		const formatted = formatPortableUpdateErrorMessage(message);

		logger.warn('Portable update check failed', {
			// 言い換える前の失敗理由
			error: message
		});

		// 画面通知が求められているときだけレンダラーへ出す。ログは常に残す
		if (options.notifyUserOnError) {
			notifyRenderer({
				// 確認失敗
				type: 'error',
				// ユーザ向けの失敗文
				message: formatted
			});
		}

		return {
			// 確認できなかった
			status: 'error',
			// 実行中バージョン。最新は不明
			currentVersion,
			// ユーザ向けの失敗文。生メッセージではない
			error: formatted,
			// ポータブル確認である印
			mode: 'portable'
		};
	}
}

/**
 * ポータブル版の更新確認を初期化する。electron-updater は使わない
 * @param {BrowserWindow} win メインウィンドウ
 */
function initPortableUpdateChecker(win: BrowserWindow): void {
	mainWindow = win;

	logger.info('Portable update checker initialized (GitHub Releases API)');

	// ----------------------------------------------
	// 起動直後は待ってから確認する。失敗は画面へ出さない
	// ----------------------------------------------
	setTimeout(() => {
		void checkPortableUpdate({
			// 起動時の失敗はログだけ。画面は出さない
			notifyUserOnError: false,
			// 新しければ案内ダイアログを出す
			promptIfAvailable: true
		});
	}, STARTUP_CHECK_DELAY_MS);
}

/**
 * レンダラーへ更新状態を通知する
 * @param {UpdateStatusPayload} payload 通知内容
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
	// ウィンドウが無いとダイアログを出せない。インストール確認はしない
	if (!mainWindow) {
		return;
	}

	// ----------------------------------------------
	// ボタン番号。0 が今すぐ再起動、1 が後で
	// ----------------------------------------------
	const result = await dialog.showMessageBox(mainWindow, {
		// 情報ダイアログ。警告ではない
		type: 'info',
		// ダイアログのタイトル
		title: 'アップデートの準備完了',
		// 本文。version はダウンロード済みの版
		message: `バージョン ${version} のアップデートをダウンロードしました。`,
		// 再起動するかどうかだけを聞く
		detail: '今すぐ再起動してインストールしますか？',
		// 0 が再起動、1 が後で。空にはしない
		buttons: ['今すぐ再起動', '後で'],
		// Enter は再起動
		defaultId: 0,
		// Esc は後で。インストールしない
		cancelId: 1,
		// ボタンをリンク描画にしない
		noLink: true
	});

	// 先頭ボタン。後で選んだときは何もしない
	if (result.response === 0) {
		autoUpdater.quitAndInstall(false, true);
	}
}

/**
 * autoUpdater のイベントハンドラを登録する
 */
function registerAutoUpdaterEvents(): void {
	autoUpdater.on('checking-for-update', () => {
		logger.info('Checking for application update');
		notifyRenderer({
			// 確認を始めた印。バージョンはまだ無い
			type: 'checking'
		});
	});

	autoUpdater.on('update-available', (info) => {
		logger.info('Application update available', {
			// 配布物のバージョン。空のときは空文字のまま通知する
			version: info.version
		});
		notifyRenderer({
			// ダウンロードを始める印
			type: 'available',
			// これから取る版
			version: info.version
		});
	});

	autoUpdater.on('update-not-available', () => {
		logger.info('Application is up to date');
		notifyRenderer({
			// 公開版は現在以下
			type: 'not-available'
		});
	});

	autoUpdater.on('download-progress', (progress) => {
		notifyRenderer({
			// ダウンロード中。percent は 0 から 100
			type: 'download-progress',
			// 進捗。単位はパーセント。未取得時は 0 になり得る
			percent: progress.percent
		});
	});

	autoUpdater.on('update-downloaded', (info) => {
		logger.info('Application update downloaded', {
			// ダウンロード済みの版
			version: info.version
		});
		notifyRenderer({
			// ファイルは揃い、再起動待ち
			type: 'downloaded',
			// インストールする版
			version: info.version
		});
		void promptInstallUpdate(info.version);
	});

	autoUpdater.on('error', (error) => {
		// 生の失敗理由。Error でなければ文字列化。空のときもある
		const message = error instanceof Error ? error.message : String(error);

		logger.error('Auto-update failed', {
			// 言い換える前の失敗理由
			error: message
		});
		notifyRenderer({
			// ダウンロードまたは確認の失敗
			type: 'error',
			// sha512 や blockmap をユーザ向けに言い換えた文
			message: formatUpdateErrorMessage(message)
		});
	});
}

/**
 * 配布形態に応じて更新確認を初期化する
 * @param {BrowserWindow} win メインウィンドウ
 */
export function initUpdater(win: BrowserWindow): void {
	// ----------------------------------------------
	// ポータブルは API、未パッケージは無効、インストーラは electron-updater
	// ----------------------------------------------
	const mode = resolveUpdateCheckMode(app.isPackaged, isPortableRuntime());

	// ----------------------------------------------
	// ポータブル。electron-updater は初期化しない
	// ----------------------------------------------
	if (mode === 'github-release-api') {
		initPortableUpdateChecker(win);
		return;
	}

	// ----------------------------------------------
	// 開発実行。確認もダウンロードもしない
	// ----------------------------------------------
	if (mode === 'disabled') {
		logger.info('Auto-update is disabled in development mode');
		return;
	}

	initAutoUpdater(win);
}

/**
 * インストーラ版の自動更新を初期化する
 * @param {BrowserWindow} win メインウィンドウ
 */
function initAutoUpdater(win: BrowserWindow): void {
	// ポータブルか、未パッケージか。どちらかで electron-updater を拒否する。両方は要らない
	if (isPortableRuntime() || !app.isPackaged) {
		logger.warn('Refusing to initialize electron-updater');
		return;
	}

	// ----------------------------------------------
	// ダウンロードと終了時インストールを有効にし、ログを接続する
	// ----------------------------------------------
	mainWindow = win;

	autoUpdater.autoDownload         = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.logger               = {
		/** @param {unknown} message ログメッセージ */
		info: (message) => logger.info(String(message)),
		/** @param {unknown} message ログメッセージ */
		warn: (message) => logger.warn(String(message)),
		/** @param {unknown} message ログメッセージ */
		error: (message) => logger.error(String(message)),
		/** @param {unknown} message ログメッセージ */
		debug: (message) => logger.debug(String(message))
	};

	registerAutoUpdaterEvents();

	// ----------------------------------------------
	// 起動直後は待ってから確認する。失敗は画面へ出す
	// ----------------------------------------------
	setTimeout(() => {
		autoUpdater.checkForUpdates().catch((error: unknown) => {
			// Error でなければ文字列化。空メッセージのときもある
			const message = error instanceof Error ? error.message : String(error);

			logger.warn('Startup update check failed', {
				// 生の失敗理由。画面には言い換えた文を出す
				error: message
			});
			notifyRenderer({
				// 起動時チェックの失敗
				type: 'error',
				// sha512 や blockmap をユーザ向けに言い換えた文
				message: formatUpdateErrorMessage(message)
			});
		});
	}, STARTUP_CHECK_DELAY_MS);
}

/**
 * メインウィンドウ参照を更新する
 * @param {BrowserWindow | null} win ウィンドウ
 */
export function setAutoUpdaterWindow(win: BrowserWindow | null): void {
	mainWindow = win;
}

/**
 * 手動で更新を確認する
 * @returns {Promise<UpdateCheckResult>} 確認結果
 */
export function checkForUpdatesManual(): Promise<UpdateCheckResult> {
	// ポータブルは API、未パッケージは無効、インストーラは electron-updater
	const mode = resolveUpdateCheckMode(app.isPackaged, isPortableRuntime());

	// 開発実行は確認しない。現在バージョンだけ返す
	if (mode === 'disabled') {
		return Promise.resolve({
			// パッケージされていないので確認自体をしない
			status: 'not-packaged',
			// 実行中の app バージョン。空にはならない
			currentVersion: app.getVersion()
		});
	}

	// ポータブルは API 確認。失敗も画面へ出す
	if (mode === 'github-release-api') {
		return checkPortableUpdate({
			// 手動確認の失敗はレンダラーへ通知する
			notifyUserOnError: true,
			// 新しければ案内ダイアログも出す
			promptIfAvailable: true
		});
	}

	// ----------------------------------------------
	// インストーラ版は一度だけのイベントで結果を返す
	// ----------------------------------------------
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
				// 公開版は現在と同じかそれより古い
				status: 'not-available',
				// 実行中の app バージョン。空にはならない
				currentVersion: app.getVersion(),
				// インストーラ版の確認である印
				mode: 'installer'
			});
		};

		/** 更新あり */
		const onAvailable = (info: { version: string }): void => {
			cleanup();
			resolve({
				// より新しい配布物がある。ダウンロードはイベント側が進める
				status: 'available',
				// 配布物のバージョン。空のときは空文字
				version: info.version,
				// 実行中の app バージョン
				currentVersion: app.getVersion(),
				// インストーラ版の確認である印
				mode: 'installer'
			});
		};

		/** 更新確認エラー */
		const onError = (error: Error): void => {
			// ユーザ向けに言い換えた文。空にはしない
			const formatted = formatUpdateErrorMessage(error.message);

			cleanup();
			resolve({
				// 確認またはダウンロード開始前の失敗
				status: 'error',
				// 実行中バージョン。最新は不明
				currentVersion: app.getVersion(),
				// ユーザ向けの失敗文
				error: formatted,
				// インストーラ版の確認である印
				mode: 'installer'
			});
		};

		autoUpdater.once('update-not-available', onNotAvailable);
		autoUpdater.once('update-available', onAvailable);
		autoUpdater.once('error', onError);

		autoUpdater.checkForUpdates().catch((error: unknown) => {
			// Error でなければ文字列化。空メッセージのときもある
			const rawMessage = error instanceof Error ? error.message : String(error);
			// 画面と戻り値に使う文
			const formatted  = formatUpdateErrorMessage(rawMessage);

			cleanup();
			notifyRenderer({
				// 手動確認の呼び出し自体が失敗した
				type: 'error',
				// ユーザ向けの失敗文
				message: formatted
			});
			resolve({
				// 確認を開始できなかった
				status: 'error',
				// 実行中バージョン
				currentVersion: app.getVersion(),
				// ユーザ向けの失敗文
				error: formatted,
				// インストーラ版の確認である印
				mode: 'installer'
			});
		});
	});
}
