import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, systemPreferences } from 'electron';
import { isAdministrator } from './admin';
import { launchApp } from './launcher';
import { logger } from './logger';
import {
	getIconDataUrl,
	isValidExecutablePath,
	pathExists,
	resolveAppName,
} from './native';
import {
	getCachedData,
	getConfigInfo,
	getDefaultSettings,
	loadLauncherData,
	migrateDataDir,
	persistCurrentWindowSize,
	saveLauncherData,
} from './store';
import type { AppContextMenuAction, LauncherData, LaunchAppPayload } from './types';
import type { LogLevel } from './logger';
import {
	applyTitleBarOverlay,
	clampWindowSize,
	getMinWindowWidthForPaneCount,
	getWindowSizeLimits,
	MIN_WINDOW_HEIGHT,
	resolveWindowChromeColors,
} from './window';
import type { PaneCount } from './types';
import { checkForUpdatesManual } from './updater';
import { runningAppsMonitor } from './running-apps';

/** メインウィンドウ参照 */
let mainWindow: BrowserWindow | null = null;

/**
 * メインウィンドウ参照を設定する
 * @param {BrowserWindow | null} win ウィンドウ
 * @returns {void}
 */
export function setMainWindow(win: BrowserWindow | null): void {
	mainWindow = win;
}

/**
 * テーマ設定を nativeTheme に反映する
 * @param {'system' | 'dark' | 'light'} appearance 外観設定
 * @returns {void}
 */
function applyAppearance(appearance: 'system' | 'dark' | 'light'): void {
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
 * @returns {void}
 */
function syncWindowChromeColors(): void {
	const appearance = getCurrentAppearance();

	if (mainWindow) {
		applyTitleBarOverlay(mainWindow, appearance);
	}

	mainWindow?.webContents.send('theme:updated');
}

/**
 * IPC ハンドラを登録する
 * @returns {void}
 */
export function registerIpcHandlers(): void {
	ipcMain.handle('app:getVersion', () => {
		return { version: app.getVersion() };
	});

	ipcMain.handle('app:isAdministrator', () => {
		return isAdministrator();
	});

	ipcMain.handle('update:check', () => {
		return checkForUpdatesManual();
	});

	ipcMain.handle('data:load', () => {
		return loadLauncherData();
	});

	ipcMain.handle('data:save', (_event, data: LauncherData) => {
		const result = saveLauncherData(data);

		if (result.success && Array.isArray(data?.apps)) {
			void runningAppsMonitor.updateRegisteredApps(data.apps);
		}

		return result;
	});

	ipcMain.handle('data:getCached', () => {
		return getCachedData();
	});

	ipcMain.handle('native:getIcon', async (_event, filePath: string) => {
		if (!filePath || typeof filePath !== 'string') {
			return null;
		}

		return getIconDataUrl(filePath);
	});

	ipcMain.handle('native:resolveAppName', async (_event, filePath: string) => {
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

	ipcMain.handle('dialog:openExecutable', async () => {
		if (!mainWindow) {
			return null;
		}

		const result = await dialog.showOpenDialog(mainWindow, {
			title      : '実行ファイルを選択',
			properties : ['openFile'],
			filters    : [
				{ name: '実行ファイル/ショートカット', extensions: ['exe', 'lnk'] },
				{ name: 'すべてのファイル', extensions: ['*'] },
			],
		});

		if (result.canceled || result.filePaths.length === 0) {
			return null;
		}

		return result.filePaths[0];
	});

	ipcMain.handle('dialog:openImage', async () => {
		if (!mainWindow) {
			return null;
		}

		const result = await dialog.showOpenDialog(mainWindow, {
			title      : 'アイコン画像を選択',
			properties : ['openFile'],
			filters    : [
				{ name: '画像ファイル', extensions: ['png', 'webp', 'ico', 'jpg', 'jpeg'] },
				{ name: 'すべてのファイル', extensions: ['*'] },
			],
		});

		if (result.canceled || result.filePaths.length === 0) {
			return null;
		}

		return result.filePaths[0];
	});

	ipcMain.handle('dialog:openDirectory', async () => {
		if (!mainWindow) {
			return null;
		}

		const result = await dialog.showOpenDialog(mainWindow, {
			title      : 'フォルダを選択',
			properties : ['openDirectory', 'createDirectory'],
		});

		if (result.canceled || result.filePaths.length === 0) {
			return null;
		}

		return result.filePaths[0];
	});

	ipcMain.handle(
		'app:launch',
		async (_event, payload: LaunchAppPayload) => {
			if (!mainWindow) {
				return { success: false, error: 'Main window is not available' };
			}

			return launchApp(
				mainWindow,
				payload.path,
				payload.args ?? '',
				payload.workingDir ?? '',
				payload.launchBehavior ?? 'stay',
				payload.name ?? '',
				payload.runAsAdmin === true,
			);
		},
	);

	ipcMain.handle(
		'app:showContextMenu',
		async (event): Promise<AppContextMenuAction | null> => {
			const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;

			if (!win || win.isDestroyed()) {
				return null;
			}

			return new Promise((resolve) => {
				let resolved = false;

				/**
				 * メニュー選択を一度だけ返す
				 * @param {AppContextMenuAction | null} action 選択アクション
				 * @returns {void}
				 */
				const complete = (action: AppContextMenuAction | null) => {
					if (resolved) {
						return;
					}

					resolved = true;
					resolve(action);
				};

				const menu = Menu.buildFromTemplate([
					{
						label: '起動',
						click: complete.bind(null, 'launch'),
					},
					{
						label      : '管理者として実行',
						enabled    : process.platform === 'win32',
						accelerator: 'Ctrl+Shift+Enter',
						click      : complete.bind(null, 'runAsAdmin'),
					},
					{ type: 'separator' },
					{
						label: '編集',
						click: complete.bind(null, 'edit'),
					},
					{
						label: '削除',
						click: complete.bind(null, 'delete'),
					},
				]);

				menu.popup({
					window  : win,
					callback: complete.bind(null, null),
				});
			});
		},
	);

	ipcMain.handle('theme:apply', (_event, appearance: 'system' | 'dark' | 'light') => {
		applyAppearance(appearance);

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

	ipcMain.handle('config:get', () => {
		return getConfigInfo();
	});

	ipcMain.handle('config:getDefaultSettings', () => {
		return getDefaultSettings();
	});

	ipcMain.handle('config:migrateDataDir', (_event, newDir: string) => {
		if (!newDir || typeof newDir !== 'string') {
			return {
				success: false,
				error  : '保存先フォルダが指定されていません。',
			};
		}

		const result = migrateDataDir(newDir);

		if (result.success) {
			const data = getCachedData();

			if (data) {
				void runningAppsMonitor.updateRegisteredApps(data.apps);
			}
		}

		return result;
	});

	ipcMain.handle('running-apps:getCurrent', () => {
		return runningAppsMonitor.getCurrentPayload();
	});

	ipcMain.handle('window:getLimits', (_event, paneCount?: number) => {
		const count = paneCount === 2 || paneCount === 3 ? paneCount : 1;

		return getWindowSizeLimits(mainWindow, count);
	});

	ipcMain.handle('window:getSize', () => {
		if (!mainWindow) {
			return null;
		}

		const [width, height] = mainWindow.getSize();

		return { width, height };
	});

	ipcMain.handle('window:setSize', (_event, width: number, height: number) => {
		if (!mainWindow) {
			return null;
		}

		const paneCount = getCachedData()?.settings.paneCount ?? 1;
		const limits    = getWindowSizeLimits(mainWindow, paneCount);
		const size      = clampWindowSize(Number(width), Number(height), limits);
		mainWindow.setSize(size.width, size.height);

		return size;
	});

	ipcMain.handle('window:applyLayoutSettings', (_event, paneCount: number) => {
		if (!mainWindow) {
			return null;
		}

		const count    = paneCount === 2 || paneCount === 3 ? paneCount as PaneCount : 1;
		const minWidth = getMinWindowWidthForPaneCount(count);

		mainWindow.setMinimumSize(minWidth, MIN_WINDOW_HEIGHT);

		const [currentWidth, currentHeight] = mainWindow.getSize();

		if (currentWidth < minWidth) {
			const limits = getWindowSizeLimits(mainWindow, count);
			const size   = clampWindowSize(minWidth, currentHeight, limits);
			mainWindow.setSize(size.width, size.height);

			return {
				minWidth,
				width : size.width,
				height: size.height,
			};
		}

		return {
			minWidth,
			width : currentWidth,
			height: currentHeight,
		};
	});

	ipcMain.on('app:close-ready', () => {
		if (!mainWindow || mainWindow.isDestroyed()) {
			return;
		}

		persistCurrentWindowSize(mainWindow);
		mainWindow.destroy();
	});

	nativeTheme.on('updated', () => {
		const appearance = getCachedData()?.settings.appearance ?? 'system';

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

	ipcMain.on(
		'log:write',
		(_event, payload: { level: LogLevel; message: string; context?: Record<string, unknown> }) => {
			logger.fromRenderer(payload.level, payload.message, payload.context);
		},
	);

	logger.info('IPC handlers registered');
}

/**
 * ウィンドウのセキュリティ設定を適用する
 * @param {BrowserWindow} win ウィンドウ
 * @returns {void}
 */
export function attachWindowSecurityHandlers(win: BrowserWindow): void {
	win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

	win.webContents.on('will-navigate', (event, url) => {
		const currentFile = win.webContents.getURL();

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
