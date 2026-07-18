import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import {
	attachWindowSecurityHandlers,
	getPreloadPath,
	getRendererIndexPath,
	registerIpcHandlers,
	setMainWindow,
} from './ipc';
import { logger } from './logger';
import { getCachedData, loadLauncherData } from './store';
import { initAutoUpdater, setAutoUpdaterWindow } from './updater';
import { getAppIconPath } from './icon';
import {
	applyTitleBarOverlay,
	clampWindowSize,
	DEFAULT_WINDOW_HEIGHT,
	DEFAULT_WINDOW_WIDTH,
	getMinWindowWidthForPaneCount,
	getWindowSizeLimits,
	MIN_WINDOW_HEIGHT,
	resolveWindowChromeColors,
	resolveTitleBarOverlay,
} from './window';
import { runningAppsMonitor } from './running-apps';

/** パッケージ版 AppUserModelID */
const PACKAGED_APP_USER_MODEL_ID = 'jp.tm-systems.tms-app-launcher';

/** 開発版 AppUserModelID */
const DEV_APP_USER_MODEL_ID = 'jp.tm-systems.tms-app-launcher.dev';

/** メインウィンドウ参照 */
let mainWindow: BrowserWindow | null = null;

/**
 * 開発時の userData 分離
 * @returns {void}
 */
function configureDevUserData(): void {
	if (!app.isPackaged) {
		app.setPath(
			'userData',
			path.join(app.getPath('appData'), 'tms-app-launcher-dev'),
		);
	}
}

/**
 * 未捕捉例外をログに記録する
 * @returns {void}
 */
function registerGlobalErrorHandlers(): void {
	process.on('uncaughtException', (error) => {
		logger.error('Uncaught exception in main process', {
			error: error.message,
			stack: error.stack,
		});
	});

	process.on('unhandledRejection', (reason) => {
		logger.error('Unhandled rejection in main process', {
			reason: reason instanceof Error ? reason.message : String(reason),
		});
	});
}

/**
 * AppUserModelID を取得する
 * @returns {string} AppUserModelID
 */
function resolveAppUserModelId(): string {
	return app.isPackaged ? PACKAGED_APP_USER_MODEL_ID : DEV_APP_USER_MODEL_ID;
}

/**
 * 現在の外観設定を取得する
 * @param {'system' | 'dark' | 'light'} fallback フォールバック値
 * @returns {'system' | 'dark' | 'light'} 外観設定
 */
function resolveCurrentAppearance(
	fallback: 'system' | 'dark' | 'light',
): 'system' | 'dark' | 'light' {
	return getCachedData()?.settings.appearance ?? fallback;
}

/**
 * preload へ渡す初期ウィンドウクローム色引数を作る
 * @param {'system' | 'dark' | 'light'} appearance 外観設定
 * @returns {string[]} preload 追加引数
 */
function createPreloadWindowChromeArgs(appearance: 'system' | 'dark' | 'light'): string[] {
	const colors = resolveWindowChromeColors(appearance);

	return [
		`--tms-al-window-chrome-colors=${encodeURIComponent(JSON.stringify(colors))}`,
		'--tms-al-window-focused=true',
	];
}

/**
 * メインウィンドウを生成する
 * @returns {BrowserWindow} ウィンドウ
 */
function createMainWindow(): BrowserWindow {
	const loadResult      = loadLauncherData();
	const settings        = loadResult.data?.settings;
	const paneCount       = settings?.paneCount ?? 1;
	const limits          = getWindowSizeLimits(undefined, paneCount);
	const minWidth        = getMinWindowWidthForPaneCount(paneCount);
	const size            = clampWindowSize(
		settings?.window.width ?? DEFAULT_WINDOW_WIDTH,
		settings?.window.height ?? DEFAULT_WINDOW_HEIGHT,
		limits,
	);
	const iconPath        = getAppIconPath();
	const appearance      = settings?.appearance ?? 'system';
	const isWin           = process.platform === 'win32';
	const titleBarOverlay = isWin ? resolveTitleBarOverlay(appearance) : undefined;

	if (iconPath) {
		logger.info('Window icon configured', { iconPath });
	}

	const win = new BrowserWindow({
		width          : size.width,
		height         : size.height,
		minWidth,
		minHeight      : MIN_WINDOW_HEIGHT,
		center         : true,
		autoHideMenuBar: true,
		show           : false,
		title          : 'TMS-AppsLauncher',
		backgroundColor: titleBarOverlay?.color,
		...(iconPath ? { icon: iconPath } : {}),
		...(isWin
			? {
				titleBarStyle: 'hidden',
				titleBarOverlay,
			}
			: {
				titleBarStyle: 'hidden',
			}),
		webPreferences : {
			preload         : getPreloadPath(),
			contextIsolation: true,
			nodeIntegration : false,
			sandbox         : true,
			additionalArguments: createPreloadWindowChromeArgs(appearance),
		},
	});

	if (iconPath) {
		win.setIcon(iconPath);
	}

	attachWindowSecurityHandlers(win);

	win.once('ready-to-show', () => {
		win.show();
		void runningAppsMonitor.refresh();
	});

	win.loadFile(getRendererIndexPath());

	win.on('close', (event) => {
		if (win.isDestroyed()) {
			return;
		}

		event.preventDefault();
		win.webContents.send('app:before-close');
	});

	win.on('closed', () => {
		mainWindow = null;
		setMainWindow(null);
		setAutoUpdaterWindow(null);
		runningAppsMonitor.setWindow(null);
	});

	win.on('focus', () => {
		applyTitleBarOverlay(win, resolveCurrentAppearance(appearance), true);
		win.webContents.send('window:focus-changed', true);
		void runningAppsMonitor.refresh();
	});

	win.on('blur', () => {
		applyTitleBarOverlay(win, resolveCurrentAppearance(appearance), false);
		win.webContents.send('window:focus-changed', false);
	});

	win.on('restore', () => {
		void runningAppsMonitor.refresh();
	});

	mainWindow = win;
	setMainWindow(win);
	runningAppsMonitor.setWindow(win);
	void runningAppsMonitor.updateRegisteredApps(loadResult.data?.apps ?? []);
	runningAppsMonitor.start();

	return win;
}

/**
 * 単一インスタンスロックを設定する
 * @returns {boolean} ロック取得成功なら true
 */
function requestSingleInstance(): boolean {
	const gotLock = app.requestSingleInstanceLock();

	if (!gotLock) {
		app.quit();
		return false;
	}

	app.on('second-instance', () => {
		if (!mainWindow) {
			mainWindow = createMainWindow();
			return;
		}

		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}

		mainWindow.focus();
	});

	return true;
}

/**
 * アプリケーションを起動する
 * @returns {void}
 */
function bootstrap(): void {
	configureDevUserData();
	app.setAppUserModelId(resolveAppUserModelId());
	registerGlobalErrorHandlers();
	logger.init();
	registerIpcHandlers();

	if (!requestSingleInstance()) {
		return;
	}

	app.whenReady().then(() => {
		const win = createMainWindow();
		initAutoUpdater(win);

		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				createMainWindow();
			}
		});
	});

	app.on('window-all-closed', () => {
		runningAppsMonitor.stop();
		app.quit();
	});
}

try {
	if (!app.isPackaged) {
		require('electron-reloader')(module);
	}
} catch {
	// 開発環境でない場合は無視
}

bootstrap();
