import { contextBridge, ipcRenderer, webUtils } from 'electron';

declare const document: {
	documentElement: {
		classList: {
			add: (className: string) => void;
		};
		style: {
			setProperty: (property: string, value: string) => void;
		};
	};
};

/** 初期ウィンドウクローム色引数 */
const WINDOW_CHROME_COLORS_ARG_PREFIX = '--tms-al-window-chrome-colors=';

/** 初期フォーカス状態引数 */
const WINDOW_FOCUSED_ARG_PREFIX = '--tms-al-window-focused=';

/** CSS HEX 色 */
const CSS_COLOR_HEX_PATTERN = /^#[0-9a-f]{6}$/iu;

/**
 * process.argv から指定 prefix の値を取得する
 * @param {string} prefix 引数 prefix
 * @returns {string | null} 引数値
 */
function readAdditionalArgument(prefix: string): string | null {
	const arg = process.argv.find((value) => value.startsWith(prefix));

	return arg ? arg.slice(prefix.length) : null;
}

/**
 * CSS に渡せる色か判定する
 * @param {unknown} color 色
 * @returns {color is string} 有効なら true
 */
function isValidCssColor(color: unknown): color is string {
	return typeof color === 'string' && CSS_COLOR_HEX_PATTERN.test(color);
}

/**
 * 初期ウィンドウクローム色を読み込む
 * @returns {Record<string, string> | null} 色定義
 */
function readInitialWindowChromeColors(): Record<string, string> | null {
	const encoded = readAdditionalArgument(WINDOW_CHROME_COLORS_ARG_PREFIX);

	if (!encoded) {
		return null;
	}

	try {
		const parsed = JSON.parse(decodeURIComponent(encoded)) as Record<string, unknown>;

		return {
			activeBackground  : isValidCssColor(parsed.activeBackground) ? parsed.activeBackground : '',
			activeText        : isValidCssColor(parsed.activeText) ? parsed.activeText : '',
			inactiveBackground: isValidCssColor(parsed.inactiveBackground) ? parsed.inactiveBackground : '',
			inactiveText      : isValidCssColor(parsed.inactiveText) ? parsed.inactiveText : '',
		};
	} catch {
		return null;
	}
}

/**
 * 初回 paint 前にウィンドウクローム色を CSS 変数へ反映する
 * @returns {void}
 */
function applyInitialWindowChromeStyles(): void {
	const colors = readInitialWindowChromeColors();
	const root   = document.documentElement;

	if (!colors || !root) {
		return;
	}

	const colorMap = {
		'--tms-al-titlebar-active-bg'     : colors.activeBackground,
		'--tms-al-titlebar-active-text'   : colors.activeText,
		'--tms-al-titlebar-inactive-bg'   : colors.inactiveBackground,
		'--tms-al-titlebar-inactive-text' : colors.inactiveText,
	};

	Object.entries(colorMap).forEach(([property, color]) => {
		if (isValidCssColor(color)) {
			root.style.setProperty(property, color);
		}
	});

	if (readAdditionalArgument(WINDOW_FOCUSED_ARG_PREFIX) === 'true') {
		root.classList.add('tms-al-window-focused');
	}
}

applyInitialWindowChromeStyles();

/**
 * レンダラー向け API 定義
 */
const launcherApi = {
	/**
	 * アプリバージョンを取得する
	 * @returns {Promise<{ version: string }>} バージョン情報
	 */
	getVersion: () => ipcRenderer.invoke('app:getVersion'),

	/**
	 * 管理者権限で実行中か取得する
	 * @returns {Promise<boolean>} 管理者権限なら true
	 */
	isAdministrator: () => ipcRenderer.invoke('app:isAdministrator'),

	/**
	 * データを読み込む
	 * @returns {Promise<import('../main/types').LoadDataResult>} 読込結果
	 */
	loadData: () => ipcRenderer.invoke('data:load'),

	/**
	 * データを保存する
	 * @param {import('../main/types').LauncherData} data 保存データ
	 * @returns {Promise<import('../main/types').SaveResult>} 保存結果
	 */
	saveData: (data: import('../main/types').LauncherData) => ipcRenderer.invoke('data:save', data),

	/**
	 * キャッシュ済みデータを取得する
	 * @returns {Promise<import('../main/types').LauncherData | null>} データ
	 */
	getCachedData: () => ipcRenderer.invoke('data:getCached'),

	/**
	 * アイコン Data URL を取得する
	 * @param {string} filePath ファイルパス
	 * @returns {Promise<string | null>} Data URL
	 */
	getIcon: (filePath: string) => ipcRenderer.invoke('native:getIcon', filePath),

	/**
	 * アプリ名を自動解決する
	 * @param {string} filePath ファイルパス
	 * @returns {Promise<string>} アプリ名
	 */
	resolveAppName: (filePath: string) => ipcRenderer.invoke('native:resolveAppName', filePath),

	/**
	 * パスが存在するか判定する
	 * @param {string} filePath ファイルパス
	 * @returns {Promise<boolean>} 存在すれば true
	 */
	pathExists: (filePath: string) => ipcRenderer.invoke('native:pathExists', filePath),

	/**
	 * 実行可能パスか判定する
	 * @param {string} filePath ファイルパス
	 * @returns {Promise<boolean>} 有効なら true
	 */
	isValidExecutablePath: (filePath: string) => ipcRenderer.invoke('native:isValidExecutablePath', filePath),

	/**
	 * 実行ファイル選択ダイアログを開く
	 * @returns {Promise<string | null>} 選択パス
	 */
	openExecutableDialog: () => ipcRenderer.invoke('dialog:openExecutable'),

	/**
	 * 画像選択ダイアログを開く
	 * @returns {Promise<string | null>} 選択パス
	 */
	openImageDialog: () => ipcRenderer.invoke('dialog:openImage'),

	/**
	 * フォルダ選択ダイアログを開く
	 * @returns {Promise<string | null>} 選択パス
	 */
	openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),

	/**
	 * ドロップされた File オブジェクトからファイルパスを取得する
	 * @param {File} file ドロップされたファイル
	 * @returns {string} ファイルパス
	 */
	getPathForFile: (file: File) => webUtils.getPathForFile(file),

	/**
	 * app-config 情報を取得する
	 * @returns {Promise<import('../main/types').ConfigInfo>} 設定情報
	 */
	getConfig: () => ipcRenderer.invoke('config:get'),

	/**
	 * 既定 settings を取得する
	 * @returns {Promise<import('../main/types').LauncherSettings>} 既定 settings
	 */
	getDefaultSettings: () => ipcRenderer.invoke('config:getDefaultSettings'),

	/**
	 * dataDir を移行する
	 * @param {string} newDir 新しい dataDir
	 * @returns {Promise<import('../main/types').MigrateDataDirResult>} 移行結果
	 */
	migrateDataDir: (newDir: string) => ipcRenderer.invoke('config:migrateDataDir', newDir),

	/**
	 * ウィンドウサイズ制限を取得する
	 * @returns {Promise<import('../main/types').WindowSizeLimits>} 制限値
	 */
	getWindowLimits: (paneCount?: number) => ipcRenderer.invoke('window:getLimits', paneCount),

	/**
	 * ペイン数設定に合わせてウィンドウ制約を適用する
	 * @param {number} paneCount ペイン数
	 * @returns {Promise<{ minWidth: number; width: number; height: number } | null>} 反映後サイズ
	 */
	applyLayoutSettings: (paneCount: number) => ipcRenderer.invoke('window:applyLayoutSettings', paneCount),

	/**
	 * 現在のウィンドウサイズを取得する
	 * @returns {Promise<import('../main/types').WindowSize | null>} サイズ
	 */
	getWindowSize: () => ipcRenderer.invoke('window:getSize'),

	/**
	 * ウィンドウサイズを変更する
	 * @param {number} width 幅
	 * @param {number} height 高さ
	 * @returns {Promise<{ width: number; height: number } | null>} 反映後サイズ
	 */
	setWindowSize: (width: number, height: number) => ipcRenderer.invoke('window:setSize', width, height),

	/**
	 * アプリを起動する
	 * @param {object} payload 起動パラメータ
	 * @returns {Promise<import('../main/types').LaunchResult>} 起動結果
	 */
	launchApp: (payload: import('../main/types').LaunchAppPayload) => ipcRenderer.invoke(
		'app:launch',
		payload,
	),

	/**
	 * アプリ右クリックメニューを表示する
	 * @returns {Promise<import('../main/types').AppContextMenuAction | null>} 選択結果
	 */
	showAppContextMenu: () => ipcRenderer.invoke('app:showContextMenu'),

	/**
	 * 現在の起動中アプリIDを取得する
	 * @returns {Promise<import('../main/types').RunningAppsPayload>} 起動中ID
	 */
	getRunningApps: () => ipcRenderer.invoke('running-apps:getCurrent'),

	/**
	 * 起動中アプリ変更イベントを購読する
	 * @param {(payload: import('../main/types').RunningAppsPayload) => void} callback コールバック
	 * @returns {() => void} 購読解除関数
	 */
	onRunningAppsChanged: (
		callback: (payload: import('../main/types').RunningAppsPayload) => void,
	) => {
		/** 起動中アプリ変更通知リスナー */
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: import('../main/types').RunningAppsPayload,
		) => callback(payload);
		ipcRenderer.on('running-apps:changed', listener);

		return () => {
			ipcRenderer.removeListener('running-apps:changed', listener);
		};
	},

	/**
	 * テーマを適用する
	 * @param {'system' | 'dark' | 'light'} appearance 外観
	 * @returns {Promise<boolean>} ダークカラー使用時 true
	 */
	applyTheme: (appearance: 'system' | 'dark' | 'light') => ipcRenderer.invoke('theme:apply', appearance),

	/**
	 * 現在ダークカラーか取得する
	 * @returns {Promise<boolean>} ダークなら true
	 */
	shouldUseDarkColors: () => ipcRenderer.invoke('theme:shouldUseDarkColors'),

	/**
	 * ウィンドウヘッダ用のシステム色を取得する
	 * @returns {Promise<import('../main/window').WindowChromeColors>} クローム色
	 */
	getWindowChromeColors: () => ipcRenderer.invoke('theme:getWindowChromeColors'),

	/**
	 * ログをメインプロセスへ送信する
	 * @param {'ERROR' | 'WARN' | 'INFO' | 'DEBUG'} level ログレベル
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 * @returns {void}
	 */
	writeLog: (
		level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG',
		message: string,
		context?: Record<string, unknown>,
	) => {
		ipcRenderer.send('log:write', { level, message, context });
	},

	/**
	 * テーマ変更イベントを購読する
	 * @param {() => void} callback コールバック
	 * @returns {() => void} 購読解除関数
	 */
	onThemeChanged: (callback: () => void) => {
		/** テーマ更新時に呼び出すリスナー */
		const listener = () => callback();
		ipcRenderer.on('theme:updated', listener);

		return () => {
			ipcRenderer.removeListener('theme:updated', listener);
		};
	},

	/**
	 * ウィンドウフォーカス変更イベントを購読する
	 * @param {(focused: boolean) => void} callback コールバック
	 * @returns {() => void} 購読解除関数
	 */
	onWindowFocusChanged: (callback: (focused: boolean) => void) => {
		/** フォーカス更新時に呼び出すリスナー */
		const listener = (_event: Electron.IpcRendererEvent, focused: boolean) => callback(focused);
		ipcRenderer.on('window:focus-changed', listener);

		return () => {
			ipcRenderer.removeListener('window:focus-changed', listener);
		};
	},

	/**
	 * 更新を手動確認する
	 * @returns {Promise<import('../main/types').UpdateCheckResult>} 確認結果
	 */
	checkForUpdates: () => ipcRenderer.invoke('update:check'),

	/**
	 * 更新状態イベントを購読する
	 * @param {(payload: import('../main/types').UpdateStatusPayload) => void} callback コールバック
	 * @returns {() => void} 購読解除関数
	 */
	onUpdateStatus: (callback: (payload: import('../main/types').UpdateStatusPayload) => void) => {
		/** 更新状態通知リスナー */
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: import('../main/types').UpdateStatusPayload,
		) => callback(payload);
		ipcRenderer.on('update:status', listener);

		return () => {
			ipcRenderer.removeListener('update:status', listener);
		};
	},

	/**
	 * 終了前イベントを購読する
	 * @param {() => void | Promise<void>} callback コールバック
	 * @returns {() => void} 購読解除関数
	 */
	onBeforeClose: (callback: () => void | Promise<void>) => {
		/** 終了前通知リスナー */
		const listener = () => {
			void callback();
		};
		ipcRenderer.on('app:before-close', listener);

		return () => {
			ipcRenderer.removeListener('app:before-close', listener);
		};
	},

	/**
	 * 終了前処理完了をメインプロセスへ通知する
	 * @returns {void}
	 */
	notifyCloseReady: () => {
		ipcRenderer.send('app:close-ready');
	},
};

contextBridge.exposeInMainWorld('launcherApi', launcherApi);

export type LauncherApi = typeof launcherApi;
