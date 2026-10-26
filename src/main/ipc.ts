/**
 * レンダラーからの IPC を受け、起動、設定、アイコン取得を main 側の関数へ渡す
 * ウィンドウ参照は setMainWindow で受け取り、このファイルはウィンドウを生成しない
 * @file
 */
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, systemPreferences } from 'electron';
import { isAdministrator } from './admin';
import { launchApp } from './launcher';
import { logger } from './logger';
import { getIconDataUrl, isValidExecutablePath, pathExists, resolveAppName } from './native';
import { getCachedData, getConfigInfo, getDefaultSettings, loadLauncherData, migrateDataDir, persistCurrentWindowSize, saveLauncherData } from './store';
import { isPortableRuntime } from './portable-runtime';
import type { AppContextMenuAction, LauncherData, LaunchAppPayload } from './types';
import type { LogLevel } from './logger';
import { applyTitleBarOverlay, clampWindowSize, getMinWindowWidthForPaneCount, getWindowSizeLimits, MIN_WINDOW_HEIGHT, resolveWindowChromeColors } from './window';
import type { PaneCount } from './types';
import { checkForUpdatesManual } from './updater';
import { runningAppsMonitor } from './running-apps';

/** メインウィンドウ参照 */
let mainWindow: BrowserWindow | null = null;

/**
 * メインウィンドウ参照を設定する
 * @param {BrowserWindow | null} win ウィンドウ
 */
export function setMainWindow(win: BrowserWindow | null): void {
	mainWindow = win;
}

/**
 * テーマ設定を nativeTheme に反映する
 * @param {'system' | 'dark' | 'light'} appearance 外観設定
 */
function applyAppearance(appearance: 'system' | 'dark' | 'light'): void {
	// OS のアプリモードに追従する
	if (appearance === 'system') {
		nativeTheme.themeSource = 'system';
		return;
	}

	nativeTheme.themeSource = appearance;
}

/**
 * 現在の外観設定を取得する
 * @returns {'system' | 'dark' | 'light'} 外観設定
 */
function getCurrentAppearance(): 'system' | 'dark' | 'light' {
	return getCachedData()?.settings.appearance ?? 'system';
}

/**
 * ウィンドウクローム色変更を UI へ通知する
 */
function syncWindowChromeColors(): void {
	// 保存済みの外観。未保存のときは system
	const appearance = getCurrentAppearance();

	// メインウィンドウが生成済みである
	if (mainWindow) {
		applyTitleBarOverlay(mainWindow, appearance);
	}

	mainWindow?.webContents.send('theme:updated');
}

/**
 * IPC ハンドラを登録する
 */
export function registerIpcHandlers(): void {
	// ----------------------------------------------
	// バージョンと更新確認
	// ----------------------------------------------
	ipcMain.handle('app:getVersion', () => {
		return { version: app.getVersion() };
	});

	ipcMain.handle('app:isAdministrator', () => {
		return isAdministrator();
	});

	ipcMain.handle('update:check', () => {
		return checkForUpdatesManual();
	});

	// ----------------------------------------------
	// ランチャーデータの読み書き
	// ----------------------------------------------
	ipcMain.handle('data:load', () => {
		return loadLauncherData();
	});

	ipcMain.handle('data:save', (_event, data: LauncherData) => {
		// 保存の成否。失敗時は success が false
		const result = saveLauncherData(data);

		// 保存に成功し、かつアプリ一覧が配列である。どちらか欠けると監視対象は更新しない
		if (result.success && Array.isArray(data?.apps)) {
			void runningAppsMonitor.updateRegisteredApps(data.apps);
		}

		return result;
	});

	ipcMain.handle('data:getCached', () => {
		return getCachedData();
	});

	// ----------------------------------------------
	// パスとアイコンの問い合わせ
	// ----------------------------------------------
	ipcMain.handle('native:getIcon', async (_event, filePath: string) => {
		// パスが空、または文字列でない
		if (!filePath || typeof filePath !== 'string') {
			return null;
		}

		return getIconDataUrl(filePath);
	});

	ipcMain.handle('native:resolveAppName', async (_event, filePath: string) => {
		// パスが空、または文字列でない
		if (!filePath || typeof filePath !== 'string') {
			return '';
		}

		return resolveAppName(filePath);
	});

	ipcMain.handle('native:pathExists', (_event, filePath: string) => {
		return pathExists(filePath);
	});

	ipcMain.handle('native:isValidExecutablePath', (_event, filePath: string) => {
		return isValidExecutablePath(filePath);
	});

	// ----------------------------------------------
	// ファイル選択ダイアログ
	// ----------------------------------------------
	ipcMain.handle('dialog:openExecutable', async () => {
		// 親ウィンドウが無く、ダイアログを出せない
		if (!mainWindow) {
			return null;
		}

		// ユーザーが選んだパス。キャンセル時は canceled が true
		const result = await dialog.showOpenDialog(mainWindow, {
			// ダイアログタイトル
			title: '実行ファイルを選択',
			// ファイルのみ選べる。フォルダは選べない
			properties: ['openFile'],
			// 初期表示する拡張子。最後は全ファイル
			filters: [
				{ name: '実行ファイル/ショートカット', extensions: ['exe', 'lnk'] },
				{ name: 'すべてのファイル', extensions: ['*'] }
			]
		});

		// キャンセルされた、または選択パスが 0 件である
		if (result.canceled || result.filePaths.length === 0) {
			return null;
		}

		return result.filePaths[0];
	});

	ipcMain.handle('dialog:openImage', async () => {
		// 親ウィンドウが無く、ダイアログを出せない
		if (!mainWindow) {
			return null;
		}

		// ユーザーが選んだ画像パス。キャンセル時は canceled が true
		const result = await dialog.showOpenDialog(mainWindow, {
			// ダイアログタイトル
			title: 'アイコン画像を選択',
			// ファイルのみ選べる
			properties: ['openFile'],
			// 初期表示する画像拡張子。最後は全ファイル
			filters: [
				{ name: '画像ファイル', extensions: ['png', 'webp', 'ico', 'jpg', 'jpeg'] },
				{ name: 'すべてのファイル', extensions: ['*'] }
			]
		});

		// キャンセルされた、または選択パスが 0 件である
		if (result.canceled || result.filePaths.length === 0) {
			return null;
		}

		return result.filePaths[0];
	});

	ipcMain.handle('dialog:openDirectory', async () => {
		// 親ウィンドウが無く、ダイアログを出せない
		if (!mainWindow) {
			return null;
		}

		// ユーザーが選んだフォルダ。キャンセル時は canceled が true
		const result = await dialog.showOpenDialog(mainWindow, {
			// ダイアログタイトル
			title: 'フォルダを選択',
			// フォルダ選択。無ければ作成できる
			properties: ['openDirectory', 'createDirectory']
		});

		// キャンセルされた、または選択パスが 0 件である
		if (result.canceled || result.filePaths.length === 0) {
			return null;
		}

		return result.filePaths[0];
	});

	// ----------------------------------------------
	// アプリ起動と行メニュー
	// ----------------------------------------------
	ipcMain.handle('app:launch', async (_event, payload: LaunchAppPayload) => {
		// 起動元ウィンドウが無い
		if (!mainWindow) {
			return { success: false, error: 'Main window is not available' };
		}

		return launchApp(mainWindow, payload.path, payload.args ?? '', payload.workingDir ?? '', payload.launchBehavior ?? 'stay', payload.name ?? '', payload.runAsAdmin === true);
	});

	ipcMain.handle('app:showContextMenu', async (event): Promise<AppContextMenuAction | null> => {
		// メニューを出すウィンドウ。送信元が取れなければメインウィンドウ
		const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;

		// ウィンドウが無い、または破棄済みである
		if (!win || win.isDestroyed()) {
			return null;
		}

		return new Promise((resolve) => {
			// 選択結果を二重に返さない印。未確定は false
			let resolved = false;

			/**
			 * メニュー選択を一度だけ返す
			 * @param {AppContextMenuAction | null} action 選択アクション
			 */
			const complete = (action: AppContextMenuAction | null) => {
				// すでに結果を返している
				if (resolved) {
					return;
				}

				resolved = true;
				resolve(action);
			};

			// 行に対する操作メニュー
			const menu = Menu.buildFromTemplate([
				{
					// 通常起動
					label: '起動',
					// 起動を選んだことを一度だけ返す
					click: complete.bind(null, 'launch')
				},
				{
					// 管理者権限での起動
					label: '管理者として実行',
					// Windows 以外では選べない
					enabled: process.platform === 'win32',
					// キーボードでの管理者起動
					accelerator: 'Ctrl+Shift+Enter',
					// 管理者起動を選んだことを一度だけ返す
					click: complete.bind(null, 'runAsAdmin')
				},
				{ type: 'separator' },
				{
					// 登録内容の編集
					label: '編集',
					// 編集を選んだことを一度だけ返す
					click: complete.bind(null, 'edit')
				},
				{
					// 登録の削除
					label: '削除',
					// 削除を選んだことを一度だけ返す
					click: complete.bind(null, 'delete')
				}
			]);

			menu.popup({
				// メニューを付けるウィンドウ
				window: win,
				// 項目を選ばず閉じたときは未選択
				callback: complete.bind(null, null)
			});
		});
	});

	// ----------------------------------------------
	// テーマ
	// ----------------------------------------------
	ipcMain.handle('theme:apply', (_event, appearance: 'system' | 'dark' | 'light') => {
		applyAppearance(appearance);

		// メインウィンドウがあるときだけタイトルバー色を合わせる
		if (mainWindow) {
			applyTitleBarOverlay(mainWindow, appearance);
		}

		return nativeTheme.shouldUseDarkColors;
	});

	ipcMain.handle('theme:shouldUseDarkColors', () => {
		return nativeTheme.shouldUseDarkColors;
	});

	ipcMain.handle('theme:getWindowChromeColors', () => {
		return resolveWindowChromeColors(getCurrentAppearance());
	});

	// ----------------------------------------------
	// 保存先と起動中アプリ
	// ----------------------------------------------
	ipcMain.handle('config:get', () => {
		return getConfigInfo();
	});

	ipcMain.handle('config:getDefaultSettings', () => {
		return getDefaultSettings();
	});

	ipcMain.handle('config:migrateDataDir', (_event, newDir: string) => {
		// ポータブル実行では保存先を固定している
		if (isPortableRuntime()) {
			return {
				// 移行しない
				success: false,
				// 利用者へ示す拒否理由
				error: 'ポータブル版ではデータ保存先を変更できません。'
			};
		}

		// 保存先が空、または文字列でない
		if (!newDir || typeof newDir !== 'string') {
			return {
				// 移行しない
				success: false,
				// 利用者へ示す入力不足
				error: '保存先フォルダが指定されていません。'
			};
		}

		// 移行の成否。失敗時は success が false
		const result = migrateDataDir(newDir);

		// 移行に成功した
		if (result.success) {
			// 移行後のキャッシュ。未読込なら null
			const data = getCachedData();

			// キャッシュが存在する
			if (data) {
				void runningAppsMonitor.updateRegisteredApps(data.apps);
			}
		}

		return result;
	});

	ipcMain.handle('running-apps:getCurrent', () => {
		return runningAppsMonitor.getCurrentPayload();
	});

	// ----------------------------------------------
	// ウィンドウサイズ
	// ----------------------------------------------
	ipcMain.handle('window:getLimits', (_event, paneCount?: number) => {
		// 2 または 3 以外は 1 ペインとして下限を決める
		const count = paneCount === 2 || paneCount === 3 ? paneCount : 1;

		return getWindowSizeLimits(mainWindow, count);
	});

	ipcMain.handle('window:getSize', () => {
		// ウィンドウが未生成である
		if (!mainWindow) {
			return null;
		}

		// 現在の幅と高さ。単位は px
		const [width, height] = mainWindow.getSize();

		return { width, height };
	});

	ipcMain.handle('window:setSize', (_event, width: number, height: number) => {
		// ウィンドウが未生成である
		if (!mainWindow) {
			return null;
		}

		// 保存済みペイン数。未保存は 1
		const paneCount = getCachedData()?.settings.paneCount ?? 1;
		// 作業領域に収まる幅と高さの範囲。単位は px
		const limits    = getWindowSizeLimits(mainWindow, paneCount);
		// 下限と上限へ丸めたサイズ。単位は px
		const size      = clampWindowSize(Number(width), Number(height), limits);
		mainWindow.setSize(size.width, size.height);

		return size;
	});

	ipcMain.handle('window:applyLayoutSettings', (_event, paneCount: number) => {
		// ウィンドウが未生成である
		if (!mainWindow) {
			return null;
		}

		// 2 または 3 以外は 1 ペイン。型は PaneCount
		const count    = paneCount === 2 || paneCount === 3 ? (paneCount as PaneCount) : 1;
		// そのペイン数で狭くしない幅。単位は px
		const minWidth = getMinWindowWidthForPaneCount(count);

		mainWindow.setMinimumSize(minWidth, MIN_WINDOW_HEIGHT);

		// 適用前の幅と高さ。単位は px
		const [currentWidth, currentHeight] = mainWindow.getSize();

		// 現在幅が新しい下限を下回っている
		if (currentWidth < minWidth) {
			// 作業領域まで含めたサイズ範囲。単位は px
			const limits = getWindowSizeLimits(mainWindow, count);
			// 下限幅へ広げ、高さも範囲内へ丸めたサイズ。単位は px
			const size   = clampWindowSize(minWidth, currentHeight, limits);
			mainWindow.setSize(size.width, size.height);

			return {
				// 適用した最小幅。単位は px
				minWidth,
				// 丸め後の幅。単位は px
				width: size.width,
				// 丸め後の高さ。単位は px
				height: size.height
			};
		}

		return {
			// 適用した最小幅。単位は px
			minWidth,
			// 変更していない幅。単位は px
			width: currentWidth,
			// 変更していない高さ。単位は px
			height: currentHeight
		};
	});

	// ----------------------------------------------
	// 終了と OS の色変更
	// ----------------------------------------------
	ipcMain.on('app:close-ready', () => {
		// ウィンドウが無い、または破棄済みである
		if (!mainWindow || mainWindow.isDestroyed()) {
			return;
		}

		persistCurrentWindowSize(mainWindow);
		mainWindow.destroy();
	});

	nativeTheme.on('updated', () => {
		// 保存済みの外観。未保存は system
		const appearance = getCachedData()?.settings.appearance ?? 'system';

		// OS 追従中であり、かつウィンドウが存在する
		if (appearance === 'system' && mainWindow) {
			applyTitleBarOverlay(mainWindow, 'system');
		}

		mainWindow?.webContents.send('theme:updated');
	});

	systemPreferences.on('accent-color-changed', () => {
		syncWindowChromeColors();
	});

	systemPreferences.on('color-changed', () => {
		syncWindowChromeColors();
	});

	// ----------------------------------------------
	// レンダラーからのログ
	// ----------------------------------------------
	ipcMain.on('log:write', (_event, payload: { level: LogLevel; message: string; context?: Record<string, unknown> }) => {
		logger.fromRenderer(payload.level, payload.message, payload.context);
	});

	logger.info('IPC handlers registered');
}

/**
 * ウィンドウのセキュリティ設定を適用する
 * @param {BrowserWindow} win ウィンドウ
 */
export function attachWindowSecurityHandlers(win: BrowserWindow): void {
	// ----------------------------------------------
	// 新しいウィンドウを開かせない
	// ----------------------------------------------
	win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

	// ----------------------------------------------
	// file 以外への遷移を止める
	// ----------------------------------------------
	win.webContents.on('will-navigate', (event, url) => {
		// 今開いているページ URL。遷移先との比較に使う
		const currentFile = win.webContents.getURL();

		// 現在のページと異なり、かつ file:// 以外への遷移である
		if (url !== currentFile && !url.startsWith('file://')) {
			event.preventDefault();
		}
	});
}

/**
 * preload スクリプトの絶対パス
 * @returns {string} preload パス
 */
export function getPreloadPath(): string {
	return path.join(__dirname, '..', 'preload', 'preload.js');
}

/**
 * renderer/index.html の絶対パス
 * @returns {string} HTML パス
 */
export function getRendererIndexPath(): string {
	return path.join(__dirname, '..', 'renderer', 'index.html');
}
