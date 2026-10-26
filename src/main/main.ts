/**
 * Electron の起動順を組み立て、単一インスタンスとメインウィンドウを維持する
 * ポータブル判定と userData はウィンドウ生成より前に決め、終了時の保存は store へ委譲する
 * @file
 */
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { attachWindowSecurityHandlers, getPreloadPath, getRendererIndexPath, registerIpcHandlers, setMainWindow } from './ipc';
import { logger } from './logger';
import { PORTABLE_APP_USER_MODEL_ID } from './portable-mode';
import { applyPortableRuntimeIfNeeded, getPortableExeDir, isPortableRuntime } from './portable-runtime';
import { getCachedData, loadLauncherData } from './store';
import { initUpdater, setAutoUpdaterWindow } from './updater';
import { getAppIconPath } from './icon';
import { applyTitleBarOverlay, clampWindowSize, DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH, getMinWindowWidthForPaneCount, getWindowSizeLimits, MIN_WINDOW_HEIGHT, resolveWindowChromeColors, resolveTitleBarOverlay } from './window';
import { runningAppsMonitor } from './running-apps';

/** パッケージ版 AppUserModelID */
const PACKAGED_APP_USER_MODEL_ID = 'jp.tm-systems.tms-app-launcher';

/** 開発版 AppUserModelID */
const DEV_APP_USER_MODEL_ID = 'jp.tm-systems.tms-app-launcher.dev';

/** メインウィンドウ参照 */
let mainWindow: BrowserWindow | null = null;

/**
 * 開発時の userData 分離
 */
function configureDevUserData(): void {
	// ----------------------------------------------
	// ポータブルは exe 隣の data を維持する。開発用パスへ移さない
	// ----------------------------------------------
	if (isPortableRuntime()) {
		return;
	}

	// ----------------------------------------------
	// 未パッケージだけ userData を開発用ディレクトリにする。パッケージ版は既定のまま
	// ----------------------------------------------
	if (!app.isPackaged) {
		app.setPath('userData', path.join(app.getPath('appData'), 'tms-app-launcher-dev'));
	}
}

/**
 * 未捕捉例外をログに記録する
 */
function registerGlobalErrorHandlers(): void {
	process.on('uncaughtException', (error) => {
		logger.error('Uncaught exception in main process', {
			// 例外メッセージ。空のときもある
			error: error.message,
			// スタック。未設定のときは undefined を JSON に含む
			stack: error.stack
		});
	});

	process.on('unhandledRejection', (reason) => {
		logger.error('Unhandled rejection in main process', {
			// Error でなければ文字列化。理由が空のときもある
			reason: reason instanceof Error ? reason.message : String(reason)
		});
	});
}

/**
 * AppUserModelID を取得する
 * @returns {string} AppUserModelID
 */
function resolveAppUserModelId(): string {
	// ポータブルは専用 ID。パッケージ版 ID とタスクバーを分けない
	if (isPortableRuntime()) {
		return PORTABLE_APP_USER_MODEL_ID;
	}

	return app.isPackaged ? PACKAGED_APP_USER_MODEL_ID : DEV_APP_USER_MODEL_ID;
}

/**
 * 現在の外観設定を取得する
 * @param {'system' | 'dark' | 'light'} fallback フォールバック値
 * @returns {'system' | 'dark' | 'light'} 外観設定
 */
function resolveCurrentAppearance(fallback: 'system' | 'dark' | 'light'): 'system' | 'dark' | 'light' {
	return getCachedData()?.settings.appearance ?? fallback;
}

/**
 * preload へ渡す初期ウィンドウクローム色引数を作る
 * @param {'system' | 'dark' | 'light'} appearance 外観設定
 * @returns {string[]} preload 追加引数
 */
function createPreloadWindowChromeArgs(appearance: 'system' | 'dark' | 'light'): string[] {
	// 外観から決めた #RRGGBB。取得失敗時はフォールバック色
	const colors = resolveWindowChromeColors(appearance);

	return [`--tms-al-window-chrome-colors=${encodeURIComponent(JSON.stringify(colors))}`, '--tms-al-window-focused=true'];
}

/**
 * メインウィンドウを生成する
 * @returns {BrowserWindow} ウィンドウ
 */
function createMainWindow(): BrowserWindow {
	// ----------------------------------------------
	// 読込結果。data が null なら未保存で、幅と外観は既定に落ちる
	// ----------------------------------------------
	const loadResult      = loadLauncherData();
	// data 内の settings。data が無いときは undefined で各項目は既定
	const settings        = loadResult.data?.settings;
	// ペイン数。未設定は 1。単位は個
	const paneCount       = settings?.paneCount ?? 1;
	// 作業領域に収まる最小最大。単位は px。ウィンドウ未生成なのでプライマリ
	const limits          = getWindowSizeLimits(undefined, paneCount);
	// ペイン数から決めた最小幅。単位は px
	const minWidth        = getMinWindowWidthForPaneCount(paneCount);
	// 保存幅高を制限内へ丸めた値。未設定の幅高は 480 と 720。単位は px
	const size            = clampWindowSize(settings?.window.width ?? DEFAULT_WINDOW_WIDTH, settings?.window.height ?? DEFAULT_WINDOW_HEIGHT, limits);
	// ico の絶対パス。見つからないときは undefined で OS 既定アイコン
	const iconPath        = getAppIconPath();
	// 外観。未設定は system
	const appearance      = settings?.appearance ?? 'system';
	// win32 のときだけ titleBarOverlay を渡す
	const isWin           = process.platform === 'win32';
	// Windows の色と高さ。非 Windows は undefined で BrowserWindow 既定
	const titleBarOverlay = isWin ? resolveTitleBarOverlay(appearance) : undefined;

	// ico が見つかったときだけ記録する。undefined のときは既定アイコン
	if (iconPath) {
		logger.info('Window icon configured', {
			// 採用した ico の絶対パス。候補の先頭で存在したもの
			iconPath
		});
	}

	// ----------------------------------------------
	// ready-to-show まで表示しないウィンドウを作る
	// ----------------------------------------------
	const win = new BrowserWindow({
		// 保存値を制限内へ丸めた幅。単位は px
		width: size.width,
		// 同じ高さ。単位は px
		height: size.height,
		// ペイン数由来の最小幅。単位は px
		minWidth,
		// 最小高さ。単位は px。固定 480
		minHeight: MIN_WINDOW_HEIGHT,
		// 画面中央。座標は保存しない
		center: true,
		// メニューバーを隠す
		autoHideMenuBar: true,
		// ready-to-show まで出さない
		show: false,
		// タスクバーに出るタイトル
		title: 'TMS-AppsLauncher',
		// オーバーレイ色。非 Windows や色未設定では undefined で既定
		backgroundColor: titleBarOverlay?.color,
		// ico があるときだけ icon を渡す。無いときは空オブジェクト
		...(iconPath
			? {
				// 見つかった ico。候補が無いときはこのオブジェクト自体を渡さない
				icon: iconPath
			}
			: {}),
		// win32 のときだけオーバーレイ色を渡す。それ以外はタイトルを隠すだけ
		...(isWin
			? {
				// ネイティブのタイトル文字列を隠し、オーバーレイで描く
				titleBarStyle: 'hidden',
				// 背景、文字色、高さ。非 Windows では渡さない
				titleBarOverlay
			}
			: {
				// 非 Windows もタイトルバーは隠す。オーバーレイ用の色は渡さない
				titleBarStyle: 'hidden'
			}),
		// sandbox 付き preload。レンダラーから Node は触らせない
		webPreferences: {
			// preload スクリプトのパス。サンドボックス内で実行される
			preload: getPreloadPath(),
			// ページの JS から Electron の内部を隔離する
			contextIsolation: true,
			// レンダラーで require できないようにする
			nodeIntegration: false,
			// レンダラーを OS サンドボックスで動かす
			sandbox: true,
			// 初回 paint 前の色とフォーカス。空にはしない
			additionalArguments: createPreloadWindowChromeArgs(appearance)
		}
	});

	// 同じ ico をウィンドウアイコンにも設定する。無いときは既定のまま
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
		// 破棄済みなら閉じるのを止めない
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

	// ----------------------------------------------
	// 参照を公開し、起動中アプリの監視を始める
	// ----------------------------------------------
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
	// 取れなければ false。他プロセスが既に起動している
	const gotLock = app.requestSingleInstanceLock();

	// ロック失敗。このプロセスは終了し、先に起動した側が前面化する
	if (!gotLock) {
		app.quit();
		return false;
	}

	// ----------------------------------------------
	// 第二インスタンスは新しいプロセスを残さず、既存ウィンドウを前面化する
	// ----------------------------------------------
	app.on('second-instance', () => {
		// ウィンドウが無い、または破棄済み。作り直して終わる
		if (!mainWindow) {
			mainWindow = createMainWindow();
			return;
		}

		// 最小化中だけ戻す。通常表示ではフォーカスのみ
		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}

		mainWindow.focus();
	});

	return true;
}

/**
 * アプリケーションを起動する
 */
function bootstrap(): void {
	// ----------------------------------------------
	// userData を決め、ログを始める
	// ----------------------------------------------
	applyPortableRuntimeIfNeeded();
	configureDevUserData();
	app.setAppUserModelId(resolveAppUserModelId());
	registerGlobalErrorHandlers();
	logger.init();

	// ポータブル適用済みのときだけ保存先を記録する。通常起動は出さない
	if (isPortableRuntime()) {
		logger.info('Portable mode enabled', {
			// ポータブル exe のディレクトリ。適用済みなので null にはならない
			exeDir: getPortableExeDir(),
			// 切替後の userData。exe 隣の data
			userData: app.getPath('userData'),
			// 平坦配置なので userData と同じパス
			dataDir: app.getPath('userData')
		});
	}
	registerIpcHandlers();

	// ----------------------------------------------
	// ロックを取れなければここで終わる。ウィンドウは作らない
	// ----------------------------------------------
	if (!requestSingleInstance()) {
		return;
	}

	// ----------------------------------------------
	// 準備完了後にウィンドウと更新確認を始める
	// ----------------------------------------------
	app.whenReady().then(() => {
		// 表示するメインウィンドウ。更新確認がこの参照を使う
		const win = createMainWindow();
		initUpdater(win);

		app.on('activate', () => {
			// ウィンドウが 0 のときだけ作り直す。残っていれば何もしない
			if (BrowserWindow.getAllWindows().length === 0) {
				createMainWindow();
			}
		});
	});

	// ----------------------------------------------
	// 最後のウィンドウが閉じたら監視を止めて終了する
	// ----------------------------------------------
	app.on('window-all-closed', () => {
		runningAppsMonitor.stop();
		app.quit();
	});
}

try {
	// 未パッケージのときだけホットリロード。パッケージ版は require しない
	if (!app.isPackaged) {
		require('electron-reloader')(module);
	}
} catch {
	// 開発環境でない場合は無視
}

bootstrap();
