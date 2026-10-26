/**
 * タスクバー上のプロセスを定期的に列挙し、登録アプリの id へ突き合わせる
 * 一致ルールは running-apps-match に渡し、このファイルは監視の開始と通知を持つ
 * @file
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { app, BrowserWindow } from 'electron';
import { logger } from './logger';
import { normalizeExecutablePath, readShortcut } from './native';
import { areSameAppIds, getBatchLaunchExecutable, getProfileDirectory, isWindowsAppAliasPath, matchRunningAppIds } from './running-apps-match';
import type { ResolvedRegisteredApp } from './running-apps-match';
import type { LauncherApp, RunningAppsPayload, TaskbarAppProcess } from './types';

/** 起動中プロセスを列挙する間隔。単位はミリ秒 */
const POLL_INTERVAL_MS             = 3000;
/** 列挙スクリプトの待ち時間。単位はミリ秒 */
const ENUMERATION_TIMEOUT_MS       = 10000;
/** ショートカット識別スクリプトの待ち時間。単位はミリ秒 */
const SHORTCUT_IDENTITY_TIMEOUT_MS = 20000;

/**
 * PowerShell列挙スクリプトのパスを取得する
 * @returns {string} スクリプト絶対パス
 */
function getEnumerationScriptPath(): string {
	return app.isPackaged ? path.join(process.resourcesPath, 'get-taskbar-apps.ps1') : path.join(app.getAppPath(), 'resources', 'get-taskbar-apps.ps1');
}

/**
 * PIDLショートカット識別スクリプトのパスを取得する
 * @returns {string} スクリプト絶対パス
 */
function getShortcutIdentityScriptPath(): string {
	return app.isPackaged ? path.join(process.resourcesPath, 'get-shortcut-identity.ps1') : path.join(app.getAppPath(), 'resources', 'get-shortcut-identity.ps1');
}

/**
 * Windows PowerShellの実行ファイルパスを取得する
 * @returns {string} powershell.exeパス
 */
function getPowerShellPath(): string {
	// SystemRoot、WINDIR、どちらも無ければ C:\Windows
	const windowsDir = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';

	return path.join(windowsDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * タスクバー対象プロセスを列挙する
 * @returns {Promise<TaskbarAppProcess[]>} プロセス一覧
 */
export function enumerateTaskbarProcesses(): Promise<TaskbarAppProcess[]> {
	// Windows 以外ではタスクバーを列挙しない
	if (process.platform !== 'win32') {
		return Promise.resolve([]);
	}

	return new Promise((resolve, reject) => {
		execFile(
			getPowerShellPath(),
			['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', getEnumerationScriptPath()],
			{
				// 標準出力の文字コード
				encoding: 'utf8',
				// 列挙の待ち時間。単位はミリ秒
				timeout: ENUMERATION_TIMEOUT_MS,
				// コンソールウィンドウを出さない
				windowsHide: true
			},
			(error, stdout) => {
				// プロセス起動またはタイムアウトに失敗した
				if (error) {
					reject(error);
					return;
				}

				try {
					// JSON の根。空出力は空配列として扱う
					const parsed: unknown = JSON.parse(stdout.trim() || '[]');
					// 配列でなければ 1 件の配列にそろえる
					const values          = Array.isArray(parsed) ? parsed : [parsed];
					// pid と実行パスを持つ要素だけ
					const processes       = values.filter((value): value is TaskbarAppProcess => {
						// null、またはオブジェクトでない
						if (!value || typeof value !== 'object') {
							return false;
						}

						// 必須フィールドの有無を見る途中形
						const candidate = value as Partial<TaskbarAppProcess>;

						return Number.isInteger(candidate.pid) && typeof candidate.processName === 'string' && typeof candidate.executablePath === 'string' && candidate.executablePath.length > 0;
					});

					resolve(
						processes.map((processInfo) => ({
							...processInfo,
							// コマンドライン。文字列でなければ空
							commandLine: typeof processInfo.commandLine === 'string' ? processInfo.commandLine : '',
							// ウィンドウタイトル。文字列でなければ空
							windowTitle: typeof processInfo.windowTitle === 'string' ? processInfo.windowTitle : '',
							// AppUserModelID。文字列でなければ空
							appUserModelId: typeof processInfo.appUserModelId === 'string' ? processInfo.appUserModelId : ''
						}))
					);
				} catch (parseError) {
					reject(parseError);
				}
			}
		);
	});
}

/**
 * PIDLショートカットのShell識別子を一括取得する
 * @param {string[]} shortcutPaths ショートカットパス
 * @returns {Promise<Map<string, { targetParsingPath: string; appUserModelId: string; resolvedExecutablePath: string; displayName: string }>>} パス別Shell識別情報
 */
function getShortcutIdentities(shortcutPaths: string[]): Promise<
	Map<
		string,
		{
			targetParsingPath: string;
			appUserModelId: string;
			resolvedExecutablePath: string;
			displayName: string;
		}
	>
> {
	// 識別するショートカットが無い
	if (shortcutPaths.length === 0) {
		return Promise.resolve(new Map());
	}

	return new Promise((resolve) => {
		execFile(
			getPowerShellPath(),
			['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', getShortcutIdentityScriptPath(), '-ShortcutPathsBase64', Buffer.from(JSON.stringify(shortcutPaths), 'utf8').toString('base64')],
			{
				// 標準出力の文字コード
				encoding: 'utf8',
				// 標準出力の上限。単位はバイト
				maxBuffer: 10 * 1024 * 1024,
				// 識別の待ち時間。単位はミリ秒
				timeout: SHORTCUT_IDENTITY_TIMEOUT_MS,
				// コンソールウィンドウを出さない
				windowsHide: true
			},
			(error, stdout) => {
				// プロセス起動またはタイムアウトに失敗した
				if (error) {
					logger.warn('Shortcut identity extraction failed', {
						// 渡したショートカットの件数
						count: shortcutPaths.length,
						// 失敗理由
						error: error.message
					});
					resolve(new Map());
					return;
				}

				try {
					// JSON の根。空出力は空配列として扱う
					const parsed: unknown       = JSON.parse(stdout.trim() || '[]');
					// 配列でなければ 1 件の配列にそろえる
					const values                = Array.isArray(parsed) ? parsed : [parsed];
					// 小文字パスをキーにした識別結果。失敗行も含む
					const identities            = new Map<
						string,
						{
							targetParsingPath: string;
							appUserModelId: string;
							resolvedExecutablePath: string;
							displayName: string;
						}
					>();
					// エラー文字列があったショートカット。無ければ空
					const failedPaths: string[] = [];

					for (const value of values) {
						// null、またはオブジェクトでない
						if (!value || typeof value !== 'object') {
							continue;
						}

						// スクリプトが返した 1 件。欠落フィールドは unknown
						const identity = value as {
							shortcutPath?: unknown;
							targetParsingPath?: unknown;
							appUserModelId?: unknown;
							resolvedExecutablePath?: unknown;
							displayName?: unknown;
							error?: unknown;
						};

						// どのショートカットか分からない
						if (typeof identity.shortcutPath !== 'string') {
							continue;
						}

						// エラー文字列があり、かつ空でない
						if (typeof identity.error === 'string' && identity.error) {
							failedPaths.push(identity.shortcutPath);
						}

						identities.set(normalizeExecutablePath(identity.shortcutPath).toLowerCase(), {
							// Shell の解析パス。無ければ空
							targetParsingPath: typeof identity.targetParsingPath === 'string' ? identity.targetParsingPath : '',
							// AppUserModelID。無ければ空
							appUserModelId: typeof identity.appUserModelId === 'string' ? identity.appUserModelId : '',
							// 解決した exe。無ければ空
							resolvedExecutablePath: typeof identity.resolvedExecutablePath === 'string' ? identity.resolvedExecutablePath : '',
							// 表示名。無ければ空
							displayName: typeof identity.displayName === 'string' ? identity.displayName : ''
						});
					}

					// 解決できなかったショートカットがある
					if (failedPaths.length > 0) {
						logger.warn('Some shortcut identities could not be resolved', {
							// 失敗件数
							count: failedPaths.length,
							// 失敗したショートカット
							paths: failedPaths
						});
					}

					resolve(identities);
				} catch {
					resolve(new Map());
				}
			}
		);
	});
}

/**
 * Shell既知フォルダー形式の実行パスを物理パスへ変換する
 * @param {string} targetParsingPath Shell識別子
 * @returns {string} 実行パス。AUMIDの場合は空文字
 */
function resolveParsingPathExecutable(targetParsingPath: string): string {
	// 前後空白を除いた Shell 識別子。空なら変換しない
	const value = targetParsingPath.trim();

	// すでに絶対パスの exe である
	if (path.win32.isAbsolute(value) && path.extname(value).toLowerCase() === '.exe') {
		return value;
	}

	// 既知フォルダー GUID から物理フォルダへの対応。環境変数が無いときは標準パス
	const knownFolders: Record<string, string> = {
		// Program Files
		'{6d809377-6af0-444b-8957-a3773f02200e}': process.env.ProgramW6432 ?? process.env.ProgramFiles ?? 'C:\\Program Files',
		// Program Files (x86)
		'{7c5a40ef-a0fb-4bfc-874a-c0f2e0b9fa8e}': process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
	};
	// GUID と相対パスの区切り。無ければ -1
	const separatorIndex                       = value.indexOf('\\');

	// フォルダ GUID だけで、相対パスが無い
	if (separatorIndex < 0) {
		return '';
	}

	// 小文字の GUID
	const root      = value.slice(0, separatorIndex).toLowerCase();
	// GUID より後ろの相対パス
	const remainder = value.slice(separatorIndex + 1);
	// 既知フォルダーの物理パス。未知の GUID は undefined
	const base      = knownFolders[root];

	// 既知フォルダーでない、または相対パスが exe でない
	if (!base || path.extname(remainder).toLowerCase() !== '.exe') {
		return '';
	}

	return path.win32.join(base, remainder);
}

/**
 * ショートカット引数から起動対象スクリプトを抽出する
 * @param {string} target ショートカットターゲット
 * @param {string} args ショートカット引数
 * @returns {string} スクリプトパス
 */
function getScriptPath(target: string, args: string): string {
	// bat / cmd / ps1 / vbs / js を見る正規表現
	const scriptExtensions = /\.(?:bat|cmd|ps1|vbs|js)$/i;

	// ターゲット自身がスクリプトである
	if (scriptExtensions.test(target)) {
		return target;
	}

	// 引数内のクォートされた絶対パス。無ければ null
	const quoted = args.match(/"([a-z]:\\[^"\r\n]+\.(?:bat|cmd|ps1|vbs|js))"/i);

	// クォートされたスクリプトパスがある
	if (quoted?.[1]) {
		return quoted[1];
	}

	// クォートされていない絶対パス。無ければ null
	const unquoted = args.match(/([a-z]:\\[^\r\n]+?\.(?:bat|cmd|ps1|vbs|js))(?:\s|$)/i);

	return unquoted?.[1]?.trim() ?? '';
}

/**
 * batch から代表的な起動 exe を抽出する
 * @param {string} scriptPath batch パス
 * @returns {string} 起動 exe パス
 */
function getScriptLaunchExecutable(scriptPath: string): string {
	// 拡張子。小文字
	const extension = path.extname(scriptPath).toLowerCase();

	// バッチ以外は起動 exe を読まない
	if (extension !== '.bat' && extension !== '.cmd') {
		return '';
	}

	try {
		// ファイル内の start から得た exe。ファイルが無ければ空
		const executablePath = getBatchLaunchExecutable(fs.readFileSync(scriptPath, 'utf8'));

		return executablePath && fs.existsSync(executablePath) ? executablePath : '';
	} catch {
		return '';
	}
}

/**
 * ChromiumのLocal Stateからプロファイル表示名を取得する
 * @param {string} executablePath ブラウザ実行パス
 * @param {string} profileDirectory プロファイルディレクトリ
 * @param {string} localAppData LOCALAPPDATA
 * @returns {string[]} ウィンドウタイトル照合に使う表示名
 */
function getChromiumProfileNames(executablePath: string, profileDirectory: string, localAppData: string): string[] {
	// プロファイル名も LOCALAPPDATA も無い
	if (!profileDirectory || !localAppData) {
		return [];
	}

	// ブラウザごとの Local State 相対パス。対象外の exe は未定義
	const localStateRelativePaths: Record<string, string[]> = {
		// Chrome の Local State
		'chrome.exe': ['Google', 'Chrome', 'User Data', 'Local State'],
		// Edge の Local State
		'msedge.exe': ['Microsoft', 'Edge', 'User Data', 'Local State']
	};
	// この exe の相対パス。Chrome / Edge 以外は undefined
	const relativePath                                      = localStateRelativePaths[path.win32.basename(executablePath).toLowerCase()];

	// Chrome でも Edge でもない
	if (!relativePath) {
		return [];
	}

	try {
		// Local State の絶対パス
		const localStatePath = path.win32.join(localAppData, ...relativePath);
		// Local State の JSON。読めなければ catch で空配列
		const parsed         = JSON.parse(fs.readFileSync(localStatePath, 'utf8')) as {
			profile?: {
				info_cache?: Record<
					string,
					{
						name?: unknown;
						shortcut_name?: unknown;
					}
				>;
			};
		};
		// プロファイル辞書。欠落時は空オブジェクト
		const infoCache      = parsed.profile?.info_cache ?? {};
		// 大文字小文字を無視して一致したキー。無ければ undefined
		const profileKey     = Object.keys(infoCache).find((key) => key.toLowerCase() === profileDirectory.toLowerCase());
		// 一致したプロファイル。無ければ undefined
		const profile        = profileKey ? infoCache[profileKey] : undefined;
		// 表示名とショートカット名。空文字は除く
		const names          = [profile?.name, profile?.shortcut_name].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim());

		return [...new Map(names.map((value) => [value.normalize('NFKC').toLowerCase(), value])).values()];
	} catch {
		return [];
	}
}

/** 起動中アプリ監視サービス */
class RunningAppsMonitor {
	/** 通知先ウィンドウ。未設定は null */
	private window: BrowserWindow | null = null;
	/** 照合に使う解決済み登録アプリ。未反映は空 */
	private registeredApps: ResolvedRegisteredApp[] = [];
	/** 直近に通知した起動中アプリ ID。未検出は空 */
	private currentAppIds: string[] = [];
	/** 定期更新のタイマー。停止中は null */
	private interval: NodeJS.Timeout | null = null;
	/** 列挙が進行中なら true。重なりを防ぐ */
	private inFlight = false;
	/** 連続失敗回数。成功で 0 に戻す */
	private consecutiveFailures = 0;
	/** 登録更新の世代。古い完了を捨てる */
	private updateGeneration = 0;
	/** 前回ログした診断内容。同じなら再出力しない。未出力は空 */
	private lastDiagnosticSignature = '';

	/**
	 * 通知先ウィンドウを設定する
	 * @param {BrowserWindow | null} window 通知先
	 */
	setWindow(window: BrowserWindow | null): void {
		this.window = window;
	}

	/**
	 * 登録アプリを解決して監視対象へ反映する
	 * @param {LauncherApp[]} apps 登録アプリ
	 * @returns {Promise<void>}
	 */
	async updateRegisteredApps(apps: LauncherApp[]): Promise<void> {
		// ----------------------------------------------
		// ショートカットを読み、監視対象へ解決する
		// ----------------------------------------------
		// この更新の世代。完了時に古くなっていれば捨てる
		const generation     = ++this.updateGeneration;
		// 解決開始時刻。ミリ秒
		const startedAt      = Date.now();
		// LOCALAPPDATA。未設定は空でエイリアス判定をしない
		const localAppData   = process.env.LOCALAPPDATA ?? '';
		// 小文字パスから読んだショートカット。未読込のキーは無い
		const shortcutByPath = new Map<string, Awaited<ReturnType<typeof readShortcut>>>();

		await Promise.all(
			apps.map(async (launcherApp) => {
				// 正規化した登録パス。空なら拡張子も空
				const registeredPath = normalizeExecutablePath(launcherApp.path);

				// ショートカットである
				if (path.extname(registeredPath).toLowerCase() === '.lnk') {
					shortcutByPath.set(registeredPath.toLowerCase(), await readShortcut(registeredPath, { failureLogMode: 'once' }));
				}
			})
		);

		// ターゲットが exe でないショートカット。Shell 識別が必要
		const unresolvedShortcutPaths = [...shortcutByPath.entries()].filter(([, shortcut]) => path.extname(shortcut?.target ?? '').toLowerCase() !== '.exe').map(([shortcutPath]) => shortcutPath);
		// パスごとの Shell 識別。失敗時は空の Map
		const shortcutIdentities      = await getShortcutIdentities(unresolvedShortcutPaths);
		// 監視対象。exe / lnk 以外は null
		const resolved                = apps.map((launcherApp): ResolvedRegisteredApp | null => {
			// 正規化した登録パス
			const registeredPath = normalizeExecutablePath(launcherApp.path);
			// 拡張子。小文字
			const extension      = path.extname(registeredPath).toLowerCase();

			// 実行ファイルを直接登録している
			if (extension === '.exe') {
				// Chromium のプロファイルディレクトリ。引数に無ければ空
				const profileDirectory = getProfileDirectory(launcherApp.args);

				return {
					// ランチャー上の ID
					id: launcherApp.id,
					// 表示名
					name: launcherApp.name,
					// 比較に使う実行ファイル
					executablePath: registeredPath,
					// WindowsApps のエイリアスならファイル名だけでも一致させてよい
					allowAliasFileNameFallback: isWindowsAppAliasPath(registeredPath, localAppData),
					// プロファイルディレクトリ。無ければ空
					profileDirectory,
					// タイトル照合用の表示名。対象外ブラウザは空
					profileNames: getChromiumProfileNames(registeredPath, profileDirectory, localAppData)
				};
			}

			// exe でもショートカットでもない
			if (extension !== '.lnk') {
				return null;
			}

			// 先に読んだショートカット。未読込は null
			const shortcut = shortcutByPath.get(registeredPath.toLowerCase()) ?? null;
			// リンク先。未解決は空
			const target   = shortcut?.target ?? '';

			// リンク先が exe である
			if (path.extname(target).toLowerCase() === '.exe') {
				// ショートカット引数。未設定は空
				const shortcutArgs     = shortcut?.args ?? '';
				// 引数に含まれるスクリプト。無ければ空
				const scriptPath       = getScriptPath(target, shortcutArgs);
				// バッチが起動する exe。読めなければ空
				const scriptExecutable = getScriptLaunchExecutable(scriptPath);
				// バッチの exe を優先し、無ければリンク先
				const executablePath   = scriptExecutable || target;
				// 引数内のプロファイル。無ければ空
				const profileDirectory = getProfileDirectory(shortcutArgs);

				return {
					// ランチャー上の ID
					id: launcherApp.id,
					// 表示名
					name: launcherApp.name,
					// 比較に使う実行ファイル
					executablePath,
					// WindowsApps のエイリアスならファイル名だけでも一致させてよい
					allowAliasFileNameFallback: isWindowsAppAliasPath(executablePath, localAppData),
					// プロファイルディレクトリ。無ければ空
					profileDirectory,
					// タイトル照合用の表示名。対象外ブラウザは空
					profileNames: getChromiumProfileNames(executablePath, profileDirectory, localAppData),
					// ショートカットの AUMID。無ければ未設定
					appUserModelId: shortcut?.appUserModelId || undefined,
					// スクリプト経由なら登録名、AUMID があればファイル名。どちらも無ければ未設定
					windowTitle: scriptPath ? launcherApp.name : shortcut?.appUserModelId ? path.basename(registeredPath, path.extname(registeredPath)) : undefined
				};
			}

			// Shell 識別。未取得の項目は空
			const identity          = shortcutIdentities.get(registeredPath.toLowerCase()) ?? {
				// 解析パス。未取得は空
				targetParsingPath: '',
				// AppUserModelID。未取得は空
				appUserModelId: '',
				// 解決した exe。未取得は空
				resolvedExecutablePath: '',
				// 表示名。未取得は空
				displayName: ''
			};
			// Shell の解析パス。空なら AUMID だけの可能性がある
			const targetParsingPath = identity.targetParsingPath;
			// 解決済み exe。無ければ既知フォルダーから組み立てる。それでも無ければ空
			const parsedExecutable  = identity.resolvedExecutablePath || resolveParsingPathExecutable(targetParsingPath);

			// 物理 exe に落とせる
			if (parsedExecutable) {
				return {
					// ランチャー上の ID
					id: launcherApp.id,
					// 表示名
					name: launcherApp.name,
					// 比較に使う実行ファイル
					executablePath: parsedExecutable,
					// WindowsApps のエイリアスならファイル名だけでも一致させてよい
					allowAliasFileNameFallback: isWindowsAppAliasPath(parsedExecutable, localAppData),
					// Shell が返した AUMID。無ければ未設定
					appUserModelId: identity.appUserModelId || undefined,
					// Shell の表示名。無ければ登録名
					windowTitle: identity.displayName || launcherApp.name
				};
			}

			// 解析パスも無い
			if (!targetParsingPath) {
				return null;
			}

			return {
				// ランチャー上の ID
				id: launcherApp.id,
				// 表示名
				name: launcherApp.name,
				// exe パスは不明
				executablePath: '',
				// パスが空なのでファイル名比較はしない
				allowAliasFileNameFallback: false,
				// AUMID。無ければ解析パスを識別子にする
				appUserModelId: identity.appUserModelId || targetParsingPath,
				// Shell の表示名。無ければ登録名
				windowTitle: identity.displayName || launcherApp.name
			};
		});

		// 新しい登録更新が始まっており、かつこの結果は古い
		if (generation !== this.updateGeneration) {
			return;
		}

		this.registeredApps = resolved.filter((value): value is ResolvedRegisteredApp => value !== null);
		logger.info('Running app registrations resolved', {
			// 解決にかかった時間。単位はミリ秒
			durationMs: Date.now() - startedAt,
			// Shell 識別へ渡したショートカット件数
			shortcutIdentityCount: unresolvedShortcutPaths.length,
			// 解決後の監視対象
			apps: this.registeredApps.map((registeredApp) => ({
				// ランチャー上の ID
				id: registeredApp.id,
				// 表示名
				name: registeredApp.name,
				// 比較に使う実行ファイル。不明なら空
				executablePath: registeredApp.executablePath,
				// プロファイルディレクトリ。無ければ空
				profileDirectory: registeredApp.profileDirectory ?? '',
				// プロファイル表示名。無ければ空
				profileNames: registeredApp.profileNames ?? [],
				// AUMID。無ければ空
				appUserModelId: registeredApp.appUserModelId ?? '',
				// 照合タイトル。無ければ空
				windowTitle: registeredApp.windowTitle ?? '',
				// ファイル名だけでも一致させてよいか
				allowAliasFileNameFallback: registeredApp.allowAliasFileNameFallback
			}))
		});
		void this.refresh();
	}

	/** 監視を開始する */
	start(): void {
		// すでに監視中、または Windows 以外である
		if (this.interval || process.platform !== 'win32') {
			return;
		}

		this.interval = setInterval(() => {
			void this.refresh();
		}, POLL_INTERVAL_MS);
		void this.refresh();
	}

	/** 監視を停止する */
	stop(): void {
		// タイマーが動いている
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	/**
	 * 現在の起動中状態を取得する
	 * @returns {RunningAppsPayload} 起動中ID
	 */
	getCurrentPayload(): RunningAppsPayload {
		return { appIds: [...this.currentAppIds] };
	}

	/** 即時更新する */
	async refresh(): Promise<void> {
		// ----------------------------------------------
		// 列挙して、変化があれば通知する
		// ----------------------------------------------
		// 列挙が進行中、または Windows 以外である
		if (this.inFlight || process.platform !== 'win32') {
			return;
		}

		this.inFlight = true;

		try {
			// 今回見えたタスクバー対象。失敗時は catch へ落ちる
			const processes = await enumerateTaskbarProcesses();
			// 登録アプリと一致した ID
			const nextIds   = matchRunningAppIds(this.registeredApps, processes);

			this.logDiagnosticSnapshot(processes, nextIds);

			// 直前まで失敗が続いていた
			if (this.consecutiveFailures > 0) {
				logger.info('Running app monitor recovered', {
					// 回復前の連続失敗回数
					failures: this.consecutiveFailures
				});
			}

			this.consecutiveFailures = 0;
			this.publishIfChanged(nextIds);
		} catch (error) {
			this.consecutiveFailures += 1;
			// 終了コードとシグナルを読むための失敗オブジェクト
			const failure             = error as Error & {
				code?: string | number;
				killed?: boolean;
				signal?: string;
			};

			// 初回、または 10 回ごとの失敗である
			if (this.consecutiveFailures === 1 || this.consecutiveFailures % 10 === 0) {
				logger.warn('Running app monitor failed', {
					// ここまでの連続失敗回数
					consecutiveFailures: this.consecutiveFailures,
					// 失敗理由。Error 以外は文字列化する
					error: error instanceof Error ? error.message : String(error),
					// プロセスの終了コード。無ければ空
					code: failure.code ?? '',
					// タイムアウトなどで殺されたか。不明なら false
					killed: failure.killed ?? false,
					// 終了シグナル。無ければ空
					signal: failure.signal ?? ''
				});
			}

			// 3 回以上続いたので起動中表示を空にする
			if (this.consecutiveFailures >= 3) {
				this.publishIfChanged([]);
			}
		} finally {
			this.inFlight = false;
		}
	}

	/**
	 * 関連候補の実測識別情報を変化時だけログへ出力する
	 * @param {TaskbarAppProcess[]} processes タスクバー対象プロセス
	 * @param {string[]} matchedAppIds 一致した登録アプリID
	 */
	private logDiagnosticSnapshot(processes: TaskbarAppProcess[], matchedAppIds: string[]): void {
		// 登録アプリの実行ファイル名。空名は除く
		const executableNames                       = new Set(this.registeredApps.map((registeredApp) => path.win32.basename(registeredApp.executablePath).toLowerCase()).filter(Boolean));
		// 登録アプリの AUMID。未設定は除く
		const appUserModelIds                       = new Set(this.registeredApps.map((registeredApp) => registeredApp.appUserModelId?.toLowerCase() ?? '').filter(Boolean));
		// 登録アプリの照合タイトル。未設定は除く
		const windowTitles                          = this.registeredApps.map((registeredApp) => registeredApp.windowTitle?.normalize('NFKC').toLowerCase() ?? '').filter(Boolean);
		// 登録アプリと関係がありそうなウィンドウ。無ければ空
		const candidateWindows: TaskbarAppProcess[] = [];
		// それ以外のウィンドウ。無ければ空
		const otherWindows: TaskbarAppProcess[]     = [];

		for (const processInfo of processes) {
			// 比較用の実行ファイル名。小文字
			const executableName = path.win32.basename(processInfo.executablePath).toLowerCase();
			// 比較用の AUMID。小文字
			const appUserModelId = processInfo.appUserModelId.toLowerCase();
			// 比較用のウィンドウタイトル
			const windowTitle    = processInfo.windowTitle.normalize('NFKC').toLowerCase();
			// ファイル名、AUMID、タイトルのどれかが登録と重なる
			const isCandidate    = executableNames.has(executableName) || appUserModelIds.has(appUserModelId) || windowTitles.some((title) => windowTitle.includes(title));

			(isCandidate ? candidateWindows : otherWindows).push(processInfo);
		}

		// 候補ウィンドウのログ用フィールド
		const windows               = candidateWindows.map((processInfo) => ({
			// プロセス ID
			pid: processInfo.pid,
			// プロセス名
			processName: processInfo.processName,
			// 実行ファイル
			executablePath: processInfo.executablePath,
			// コマンドラインのプロファイル。無ければ空
			profileDirectory: getProfileDirectory(processInfo.commandLine),
			// ウィンドウタイトル
			windowTitle: processInfo.windowTitle,
			// AppUserModelID
			appUserModelId: processInfo.appUserModelId
		}));
		// 候補以外の識別情報。件数を抑えるため項目を減らす
		const otherWindowIdentities = otherWindows.map((processInfo) => ({
			// プロセス ID
			pid: processInfo.pid,
			// プロセス名
			processName: processInfo.processName,
			// 実行ファイル
			executablePath: processInfo.executablePath,
			// AppUserModelID
			appUserModelId: processInfo.appUserModelId
		}));
		// 前回と比べる診断内容。同じならログしない
		const signature             = JSON.stringify({ windows, otherWindowIdentities, matchedAppIds });

		// 前回ログした内容と同一である
		if (signature === this.lastDiagnosticSignature) {
			return;
		}

		this.lastDiagnosticSignature = signature;
		logger.info('Running app diagnostic snapshot', {
			// 登録アプリに近いウィンドウ
			windows,
			// それ以外のウィンドウ
			otherWindowIdentities,
			// 今回一致した登録アプリ ID
			matchedAppIds
		});
	}

	/**
	 * 変化時だけRendererへ通知する
	 * @param {string[]} nextIds 次のID集合
	 */
	private publishIfChanged(nextIds: string[]): void {
		// 前回通知した ID と同じである
		if (areSameAppIds(this.currentAppIds, nextIds)) {
			return;
		}

		this.currentAppIds = [...nextIds].sort();

		// 通知先があり、かつ破棄されていない
		if (this.window && !this.window.isDestroyed()) {
			this.window.webContents.send('running-apps:changed', this.getCurrentPayload());
		}
	}
}

/** 起動中アプリ監視の唯一のインスタンス */
export const runningAppsMonitor = new RunningAppsMonitor();
