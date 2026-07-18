/** 表示ペイン */
export type LauncherPane = 'left' | 'center' | 'right';

/** ペイン数 */
export type PaneCount = 1 | 2 | 3;

/** アプリ設定（launcher-data.json の settings） */
export interface LauncherSettings {
	toggleInitialState: 'expandAll' | 'collapseAll';
	/** グループごとの開閉状態（前回終了時点） */
	groupExpandedStates?: Record<string, boolean>;
	window: {
		width: number;
		height: number;
	};
	appearance: 'system' | 'dark' | 'light';
	launchBehavior: 'stay' | 'minimize' | 'close';
	/** 次回起動時に保存済みウィンドウサイズを使用する */
	rememberWindowSizeOnLaunch: boolean;
	/** 表示ペイン数 */
	paneCount: PaneCount;
	/** @deprecated paneCount へ移行済み。読込時のみ参照 */
	dualPaneEnabled?: boolean;
	/** 未分類グループの表示ペイン（複数ペイン時） */
	uncategorizedPane: LauncherPane;
}

/** グループ定義 */
export interface LauncherGroup {
	id: string;
	name: string;
	order: number;
	isUncategorized: boolean;
	/** 複数ペイン時の所属ペイン（未分類グループは settings で制御） */
	pane?: LauncherPane;
}

/** アプリ行定義 */
export interface LauncherApp {
	id: string;
	name: string;
	path: string;
	args: string;
	workingDir: string;
	iconMode: 'auto' | 'custom';
	customIconPath: string;
	groupId: string;
	order: number;
}

/** タスクバー対象ウィンドウを所有するプロセス */
export interface TaskbarAppProcess {
	pid: number;
	processName: string;
	executablePath: string;
	commandLine: string;
	windowTitle: string;
	appUserModelId: string;
}

/** Rendererへ通知する起動中アプリID */
export interface RunningAppsPayload {
	appIds: string[];
}

/** launcher-data.json 全体 */
export interface LauncherData {
	schemaVersion: number;
	settings: LauncherSettings;
	groups: LauncherGroup[];
	apps: LauncherApp[];
}

/** app-config.json */
export interface AppConfig {
	schemaVersion: number;
	dataDir: string;
}

/** 製品名取得結果 */
export interface ProductInfo {
	fileDescription: string;
	productName: string;
}

/** 保存操作結果 */
export interface SaveResult {
	success: boolean;
	error?: string;
}

/** アプリ起動結果 */
export interface LaunchResult {
	success: boolean;
	error?: string;
}

/** アプリ起動リクエスト */
export interface LaunchAppPayload {
	path: string;
	name?: string;
	args?: string;
	workingDir?: string;
	launchBehavior?: 'stay' | 'minimize' | 'close';
	runAsAdmin?: boolean;
}

/** アプリ右クリックメニューの選択結果 */
export type AppContextMenuAction =
	| 'launch'
	| 'runAsAdmin'
	| 'edit'
	| 'delete';

/** データ読込結果 */
export interface LoadDataResult {
	success: boolean;
	data?: LauncherData;
	recoveredFromBackup?: boolean;
	error?: string;
}

/** アプリバージョン情報 */
export interface AppVersionInfo {
	version: string;
}

/** app-config 参照情報 */
export interface ConfigInfo {
	dataDir: string;
	defaultDataDir: string;
}

/** dataDir 移行結果 */
export interface MigrateDataDirResult {
	success: boolean;
	dataDir?: string;
	error?: string;
}

/** ウィンドウサイズ制限 */
export interface WindowSizeLimits {
	minWidth: number;
	minHeight: number;
	maxWidth: number;
	maxHeight: number;
}

/** ウィンドウサイズ */
export interface WindowSize {
	width: number;
	height: number;
}

/** 手動更新確認結果 */
export interface UpdateCheckResult {
	status: 'not-packaged' | 'available' | 'not-available' | 'error';
	version?: string;
	currentVersion?: string;
	error?: string;
}

/** レンダラーへ通知する更新状態 */
export type UpdateStatusPayload =
	| { type: 'checking' }
	| { type: 'available'; version: string }
	| { type: 'not-available' }
	| { type: 'download-progress'; percent: number }
	| { type: 'downloaded'; version: string }
	| { type: 'error'; message: string };
