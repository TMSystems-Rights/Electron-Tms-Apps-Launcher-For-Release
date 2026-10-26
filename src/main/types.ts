/**
 * メインとレンダラーが共有する保存データと IPC の形を定義する
 * 実行時の値は持たず、読み書きは store と preload が行う
 * @file
 */

/** グループを置く列。left が常にあり、center は 3 ペイン、right は 2 ペイン以上 */
export type LauncherPane = 'left' | 'center' | 'right';

/** 同時に出す列の数。1 から 3 */
export type PaneCount = 1 | 2 | 3;

/** launcher-data.json の settings。画面の初期状態と保存先以外の好みを持つ */
export interface LauncherSettings {
	/** 起動直後のグループ開閉。expandAll か collapseAll */
	toggleInitialState: 'expandAll' | 'collapseAll';
	/** グループ id ごとの開閉。前回終了時の値。未保存のグループは未設定 */
	groupExpandedStates?: Record<string, boolean>;
	/** 保存するウィンドウサイズ。単位は px */
	window: {
		/** 幅。px */
		width: number;
		/** 高さ。px */
		height: number;
	};
	/** 外観。system は OS の明暗に従う */
	appearance: 'system' | 'dark' | 'light';
	/** アプリ起動後のランチャー。stay は残す、minimize は最小化、close は閉じる */
	launchBehavior: 'stay' | 'minimize' | 'close';
	/** true のとき、次回起動で window の幅と高さを使う */
	rememberWindowSizeOnLaunch: boolean;
	/** 表示列の数 */
	paneCount: PaneCount;
	/** @deprecated paneCount へ移行済み。読込時だけ参照し、保存時は書き戻さない */
	dualPaneEnabled?: boolean;
	/** 複数ペイン時に未分類グループを置く列 */
	uncategorizedPane: LauncherPane;
}

/** グループ定義。未分類グループは削除せず、所属列だけ設定側で決める */
export interface LauncherGroup {
	/** グループ識別子。空にしない */
	id: string;
	/** 画面に出す名前 */
	name: string;
	/** 同じ列の中の並び。小さいほど前 */
	order: number;
	/** true の未分類グループは、利用者が削除できない */
	isUncategorized: boolean;
	/** 複数ペイン時の所属列。未分類グループでは未設定で、settings.uncategorizedPane が優先される */
	pane?: LauncherPane;
}

/** アプリ行。起動に使うパスと、一覧での並びを持つ */
export interface LauncherApp {
	/** アプリ識別子。空にしない */
	id: string;
	/** 一覧に出す名前。製品名が取れないときはファイル名 */
	name: string;
	/** 起動するファイルの絶対パス */
	path: string;
	/** 起動引数。無いときは空文字 */
	args: string;
	/** 作業ディレクトリ。空なら起動側の既定 */
	workingDir: string;
	/** auto は実行ファイルから抽出、custom は customIconPath を使う */
	iconMode: 'auto' | 'custom';
	/** iconMode が custom のときの画像パス。auto のときは空文字 */
	customIconPath: string;
	/** 所属グループの id */
	groupId: string;
	/** グループ内の並び。小さいほど前 */
	order: number;
}

/** タスクバーに出ているウィンドウを所有するプロセス */
export interface TaskbarAppProcess {
	/** プロセス ID */
	pid: number;
	/** 実行ファイル名から拡張子を除いた名前 */
	processName: string;
	/** 実行ファイルの絶対パス。読めないプロセスは列挙結果に入れない */
	executablePath: string;
	/** プロセスのコマンドライン。読めないときは空文字 */
	commandLine: string;
	/** 可視ウィンドウのタイトル。空のウィンドウもある */
	windowTitle: string;
	/** ウィンドウまたはプロセスの AppUserModelID。無いときは空文字 */
	appUserModelId: string;
}

/** レンダラーへ通知する、起動中と判定したアプリ id の一覧 */
export interface RunningAppsPayload {
	/** LauncherApp.id。該当が無いときは空配列 */
	appIds: string[];
}

/** launcher-data.json 全体。schemaVersion は CURRENT_SCHEMA_VERSION と揃える */
export interface LauncherData {
	/** 保存形式の版。未知の版は読込側が拒否する */
	schemaVersion: number;
	/** 画面の好み */
	settings: LauncherSettings;
	/** グループ一覧。未分類を含む */
	groups: LauncherGroup[];
	/** アプリ一覧 */
	apps: LauncherApp[];
}

/** app-config.json。データ保存先だけを持つ */
export interface AppConfig {
	/** 保存形式の版 */
	schemaVersion: number;
	/** launcher-data.json を置くディレクトリ。ポータブルでは userData と同じ */
	dataDir: string;
}

/** 実行ファイルのバージョン情報。取れない項目は空文字 */
export interface ProductInfo {
	/** ファイルの説明 */
	fileDescription: string;
	/** 製品名 */
	productName: string;
}

/** 保存操作の成否。失敗時も例外にせず error を返す */
export interface SaveResult {
	/** 書き込みできたとき true */
	success: boolean;
	/** 失敗理由。成功時は未設定 */
	error?: string;
}

/** アプリ起動の成否。失敗時も例外にせず error を返す */
export interface LaunchResult {
	/** 起動処理を開始できたとき true。起動先プロセスの生存までは見ない */
	success: boolean;
	/** 失敗理由。成功時は未設定 */
	error?: string;
}

/** レンダラーから渡す起動要求 */
export interface LaunchAppPayload {
	/** 起動するファイルの絶対パス */
	path: string;
	/** コンソールタイトルに使う名前。未指定時はファイル名 */
	name?: string;
	/** 起動引数。未指定時は空 */
	args?: string;
	/** 作業ディレクトリ。未指定時は起動側の既定 */
	workingDir?: string;
	/** 起動後のランチャーの扱い。未指定時は設定値 */
	launchBehavior?: 'stay' | 'minimize' | 'close';
	/** true のとき管理者として起動する。未指定時は通常権限 */
	runAsAdmin?: boolean;
}

/** アプリ行の右クリックで選ばれた操作 */
export type AppContextMenuAction = 'launch' | 'runAsAdmin' | 'edit' | 'delete';

/** launcher-data.json の読込結果。壊れているときはバックアップからの復元を示す */
export interface LoadDataResult {
	/** 画面に渡せるデータを得られたとき true */
	success: boolean;
	/** 正規化済みのデータ。失敗時は未設定 */
	data?: LauncherData;
	/** true のとき、本体ではなくバックアップから復元した */
	recoveredFromBackup?: boolean;
	/** 失敗理由。成功時は未設定 */
	error?: string;
}

/** 画面フッターへ出すバージョン */
export interface AppVersionInfo {
	/** package.json の version。先頭の v は付けない */
	version: string;
}

/** 設定画面が参照する、現在と既定の保存先 */
export interface ConfigInfo {
	/** 現在の dataDir */
	dataDir: string;
	/** リセットで戻す dataDir */
	defaultDataDir: string;
	/** ポータブル実行のとき true。このとき dataDir は変更できない */
	isPortable: boolean;
}

/** dataDir の移行結果 */
export interface MigrateDataDirResult {
	/** 移行できたとき true */
	success: boolean;
	/** 移行後の dataDir。失敗時は未設定 */
	dataDir?: string;
	/** 失敗理由。成功時は未設定 */
	error?: string;
}

/** ペイン数に応じたウィンドウサイズの下限と上限。単位は px */
export interface WindowSizeLimits {
	/** これより狭くしない幅 */
	minWidth: number;
	/** これより低くしない高さ */
	minHeight: number;
	/** 作業領域に収まる最大幅 */
	maxWidth: number;
	/** 作業領域に収まる最大高さ */
	maxHeight: number;
}

/** 現在のウィンドウサイズ。単位は px */
export interface WindowSize {
	/** 外枠の幅 */
	width: number;
	/** 外枠の高さ */
	height: number;
}

/** 更新確認が使う配布物。installer は electron-updater、portable は GitHub Release API */
export type UpdateDistributionMode = 'installer' | 'portable';

/** 手動の更新確認結果 */
export interface UpdateCheckResult {
	/** not-packaged は開発版、available は更新あり、not-available は最新、error は確認失敗 */
	status: 'not-packaged' | 'available' | 'not-available' | 'error';
	/** 見つかった新しい版。無いときは未設定 */
	version?: string;
	/** 今動いている版 */
	currentVersion?: string;
	/** status が error のときの理由 */
	error?: string;
	/** どの配布物として確認したか。未確認のときは未設定 */
	mode?: UpdateDistributionMode;
}

/** レンダラーへ順に通知する更新の進み具合 */
export type UpdateStatusPayload = { type: 'checking' } | { type: 'available'; version: string; mode?: UpdateDistributionMode } | { type: 'not-available' } | { type: 'download-progress'; percent: number } | { type: 'downloaded'; version: string } | { type: 'error'; message: string };
