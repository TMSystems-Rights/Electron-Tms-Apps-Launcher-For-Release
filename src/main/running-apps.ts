import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { app, BrowserWindow } from 'electron';
import { logger } from './logger';
import { normalizeExecutablePath, readShortcut } from './native';
import {
	areSameAppIds,
	getProfileDirectory,
	isWindowsAppAliasPath,
	matchRunningAppIds,
} from './running-apps-match';
import type { ResolvedRegisteredApp } from './running-apps-match';
import type { LauncherApp, RunningAppsPayload, TaskbarAppProcess } from './types';

const POLL_INTERVAL_MS             = 3000;
const ENUMERATION_TIMEOUT_MS       = 10000;
const SHORTCUT_IDENTITY_TIMEOUT_MS = 20000;

/**
 * PowerShell列挙スクリプトのパスを取得する
 * @returns {string} スクリプト絶対パス
 */
function getEnumerationScriptPath(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, 'get-taskbar-apps.ps1')
		: path.join(app.getAppPath(), 'resources', 'get-taskbar-apps.ps1');
}

/**
 * PIDLショートカット識別スクリプトのパスを取得する
 * @returns {string} スクリプト絶対パス
 */
function getShortcutIdentityScriptPath(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, 'get-shortcut-identity.ps1')
		: path.join(app.getAppPath(), 'resources', 'get-shortcut-identity.ps1');
}

/**
 * Windows PowerShellの実行ファイルパスを取得する
 * @returns {string} powershell.exeパス
 */
function getPowerShellPath(): string {
	const windowsDir = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';

	return path.join(windowsDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * タスクバー対象プロセスを列挙する
 * @returns {Promise<TaskbarAppProcess[]>} プロセス一覧
 */
export function enumerateTaskbarProcesses(): Promise<TaskbarAppProcess[]> {
	if (process.platform !== 'win32') {
		return Promise.resolve([]);
	}

	return new Promise((resolve, reject) => {
		execFile(
			getPowerShellPath(),
			[
				'-NoLogo',
				'-NoProfile',
				'-NonInteractive',
				'-ExecutionPolicy',
				'Bypass',
				'-File',
				getEnumerationScriptPath(),
			],
			{
				encoding   : 'utf8',
				timeout    : ENUMERATION_TIMEOUT_MS,
				windowsHide: true,
			},
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}

				try {
					const parsed: unknown = JSON.parse(stdout.trim() || '[]');
					const values          = Array.isArray(parsed) ? parsed : [parsed];
					const processes       = values.filter((value): value is TaskbarAppProcess => {
						if (!value || typeof value !== 'object') {
							return false;
						}

						const candidate = value as Partial<TaskbarAppProcess>;

						return Number.isInteger(candidate.pid)
							&& typeof candidate.processName === 'string'
							&& typeof candidate.executablePath === 'string'
							&& candidate.executablePath.length > 0;
					});

					resolve(processes.map((processInfo) => ({
						...processInfo,
						commandLine   : typeof processInfo.commandLine === 'string' ? processInfo.commandLine : '',
						windowTitle   : typeof processInfo.windowTitle === 'string' ? processInfo.windowTitle : '',
						appUserModelId: typeof processInfo.appUserModelId === 'string' ? processInfo.appUserModelId : '',
					})));
				} catch (parseError) {
					reject(parseError);
				}
			},
		);
	});
}

/**
 * PIDLショートカットのShell識別子を一括取得する
 * @param {string[]} shortcutPaths ショートカットパス
 * @returns {Promise<Map<string, { targetParsingPath: string; appUserModelId: string; resolvedExecutablePath: string; displayName: string }>>} パス別Shell識別情報
 */
function getShortcutIdentities(shortcutPaths: string[]): Promise<Map<string, {
	targetParsingPath: string;
	appUserModelId: string;
	resolvedExecutablePath: string;
	displayName: string;
}>> {
	if (shortcutPaths.length === 0) {
		return Promise.resolve(new Map());
	}

	return new Promise((resolve) => {
		execFile(
			getPowerShellPath(),
			[
				'-NoLogo',
				'-NoProfile',
				'-NonInteractive',
				'-ExecutionPolicy',
				'Bypass',
				'-File',
				getShortcutIdentityScriptPath(),
				'-ShortcutPathsBase64',
				Buffer.from(JSON.stringify(shortcutPaths), 'utf8').toString('base64'),
			],
			{
				encoding   : 'utf8',
				maxBuffer  : 10 * 1024 * 1024,
				timeout    : SHORTCUT_IDENTITY_TIMEOUT_MS,
				windowsHide: true,
			},
			(error, stdout) => {
				if (error) {
					logger.warn('Shortcut identity extraction failed', {
						count: shortcutPaths.length,
						error: error.message,
					});
					resolve(new Map());
					return;
				}

				try {
					const parsed: unknown       = JSON.parse(stdout.trim() || '[]');
					const values                = Array.isArray(parsed) ? parsed : [parsed];
					const identities            = new Map<string, {
						targetParsingPath: string;
						appUserModelId: string;
						resolvedExecutablePath: string;
						displayName: string;
					}>();
					const failedPaths: string[] = [];

					for (const value of values) {
						if (!value || typeof value !== 'object') {
							continue;
						}

						const identity = value as {
							shortcutPath?: unknown;
						targetParsingPath?: unknown;
						appUserModelId?: unknown;
						resolvedExecutablePath?: unknown;
						displayName?: unknown;
							error?: unknown;
						};

						if (typeof identity.shortcutPath !== 'string') {
							continue;
						}

						if (typeof identity.error === 'string' && identity.error) {
							failedPaths.push(identity.shortcutPath);
						}

						identities.set(normalizeExecutablePath(identity.shortcutPath).toLowerCase(), {
							targetParsingPath: typeof identity.targetParsingPath === 'string'
								? identity.targetParsingPath
								: '',
							appUserModelId: typeof identity.appUserModelId === 'string'
								? identity.appUserModelId
								: '',
							resolvedExecutablePath: typeof identity.resolvedExecutablePath === 'string'
								? identity.resolvedExecutablePath
								: '',
							displayName: typeof identity.displayName === 'string'
								? identity.displayName
								: '',
						});
					}

					if (failedPaths.length > 0) {
						logger.warn('Some shortcut identities could not be resolved', {
							count: failedPaths.length,
							paths: failedPaths,
						});
					}

					resolve(identities);
				} catch {
					resolve(new Map());
				}
			},
		);
	});
}

/**
 * Shell既知フォルダー形式の実行パスを物理パスへ変換する
 * @param {string} targetParsingPath Shell識別子
 * @returns {string} 実行パス。AUMIDの場合は空文字
 */
function resolveParsingPathExecutable(targetParsingPath: string): string {
	const value = targetParsingPath.trim();

	if (path.win32.isAbsolute(value) && path.extname(value).toLowerCase() === '.exe') {
		return value;
	}

	const knownFolders: Record<string, string> = {
		'{6d809377-6af0-444b-8957-a3773f02200e}': process.env.ProgramW6432
			?? process.env.ProgramFiles
			?? 'C:\\Program Files',
		'{7c5a40ef-a0fb-4bfc-874a-c0f2e0b9fa8e}': process.env['ProgramFiles(x86)']
			?? 'C:\\Program Files (x86)',
	};
	const separatorIndex                       = value.indexOf('\\');

	if (separatorIndex < 0) {
		return '';
	}

	const root      = value.slice(0, separatorIndex).toLowerCase();
	const remainder = value.slice(separatorIndex + 1);
	const base      = knownFolders[root];

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
	const scriptExtensions = /\.(?:bat|cmd|ps1|vbs|js)$/i;

	if (scriptExtensions.test(target)) {
		return target;
	}

	const quoted = args.match(/"([a-z]:\\[^"\r\n]+\.(?:bat|cmd|ps1|vbs|js))"/i);

	if (quoted?.[1]) {
		return quoted[1];
	}

	const unquoted = args.match(/([a-z]:\\[^\r\n]+?\.(?:bat|cmd|ps1|vbs|js))(?:\s|$)/i);

	return unquoted?.[1]?.trim() ?? '';
}

/**
 * ChromiumのLocal Stateからプロファイル表示名を取得する
 * @param {string} executablePath ブラウザ実行パス
 * @param {string} profileDirectory プロファイルディレクトリ
 * @param {string} localAppData LOCALAPPDATA
 * @returns {string[]} ウィンドウタイトル照合に使う表示名
 */
function getChromiumProfileNames(
	executablePath: string,
	profileDirectory: string,
	localAppData: string,
): string[] {
	if (!profileDirectory || !localAppData) {
		return [];
	}

	const localStateRelativePaths: Record<string, string[]> = {
		'chrome.exe': ['Google', 'Chrome', 'User Data', 'Local State'],
		'msedge.exe': ['Microsoft', 'Edge', 'User Data', 'Local State'],
	};
	const relativePath                                      = localStateRelativePaths[path.win32.basename(executablePath).toLowerCase()];

	if (!relativePath) {
		return [];
	}

	try {
		const localStatePath = path.win32.join(localAppData, ...relativePath);
		const parsed         = JSON.parse(fs.readFileSync(localStatePath, 'utf8')) as {
			profile?: {
				info_cache?: Record<string, {
					name?: unknown;
					shortcut_name?: unknown;
				}>;
			};
		};
		const infoCache      = parsed.profile?.info_cache ?? {};
		const profileKey     = Object.keys(infoCache).find(
			(key) => key.toLowerCase() === profileDirectory.toLowerCase(),
		);
		const profile        = profileKey ? infoCache[profileKey] : undefined;
		const names          = [profile?.name, profile?.shortcut_name]
			.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
			.map((value) => value.trim());

		return [...new Map(names.map((value) => [value.normalize('NFKC').toLowerCase(), value])).values()];
	} catch {
		return [];
	}
}

/** 起動中アプリ監視サービス */
class RunningAppsMonitor {
	private window: BrowserWindow | null = null;
	private registeredApps: ResolvedRegisteredApp[] = [];
	private currentAppIds: string[] = [];
	private interval: NodeJS.Timeout | null = null;
	private inFlight = false;
	private consecutiveFailures = 0;
	private updateGeneration = 0;
	private lastDiagnosticSignature = '';

	/**
	 * 通知先ウィンドウを設定する
	 * @param {BrowserWindow | null} window 通知先
	 * @returns {void}
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
		const generation     = ++this.updateGeneration;
		const startedAt      = Date.now();
		const localAppData   = process.env.LOCALAPPDATA ?? '';
		const shortcutByPath = new Map<string, Awaited<ReturnType<typeof readShortcut>>>();

		await Promise.all(apps.map(async (launcherApp) => {
			const registeredPath = normalizeExecutablePath(launcherApp.path);

			if (path.extname(registeredPath).toLowerCase() === '.lnk') {
				shortcutByPath.set(
					registeredPath.toLowerCase(),
					await readShortcut(registeredPath, { failureLogMode: 'once' }),
				);
			}
		}));

		const unresolvedShortcutPaths = [...shortcutByPath.entries()]
			.filter(([, shortcut]) => path.extname(shortcut?.target ?? '').toLowerCase() !== '.exe')
			.map(([shortcutPath]) => shortcutPath);
		const shortcutIdentities      = await getShortcutIdentities(unresolvedShortcutPaths);
		const resolved                = apps.map((
			launcherApp,
		): ResolvedRegisteredApp | null => {
			const registeredPath = normalizeExecutablePath(launcherApp.path);
			const extension      = path.extname(registeredPath).toLowerCase();

			if (extension === '.exe') {
				const profileDirectory = getProfileDirectory(launcherApp.args);

				return {
					id                        : launcherApp.id,
					name                      : launcherApp.name,
					executablePath            : registeredPath,
					allowAliasFileNameFallback: isWindowsAppAliasPath(registeredPath, localAppData),
					profileDirectory,
					profileNames              : getChromiumProfileNames(
						registeredPath,
						profileDirectory,
						localAppData,
					),
				};
			}

			if (extension !== '.lnk') {
				return null;
			}

			const shortcut = shortcutByPath.get(registeredPath.toLowerCase()) ?? null;
			const target   = shortcut?.target ?? '';

			if (path.extname(target).toLowerCase() === '.exe') {
				const shortcutArgs     = shortcut?.args ?? '';
				const scriptPath       = getScriptPath(target, shortcutArgs);
				const profileDirectory = getProfileDirectory(shortcutArgs);

				return {
					id                        : launcherApp.id,
					name                      : launcherApp.name,
					executablePath            : target,
					allowAliasFileNameFallback: isWindowsAppAliasPath(target, localAppData),
					profileDirectory,
					profileNames              : getChromiumProfileNames(
						target,
						profileDirectory,
						localAppData,
					),
					appUserModelId            : shortcut?.appUserModelId || undefined,
					windowTitle               : scriptPath
						? launcherApp.name
						: (shortcut?.appUserModelId
							? path.basename(registeredPath, path.extname(registeredPath))
							: undefined),
				};
			}

			const identity          = shortcutIdentities.get(registeredPath.toLowerCase()) ?? {
				targetParsingPath     : '',
				appUserModelId        : '',
				resolvedExecutablePath: '',
				displayName           : '',
			};
			const targetParsingPath = identity.targetParsingPath;
			const parsedExecutable  = identity.resolvedExecutablePath
				|| resolveParsingPathExecutable(targetParsingPath);

			if (parsedExecutable) {
				return {
					id                        : launcherApp.id,
					name                      : launcherApp.name,
					executablePath            : parsedExecutable,
					allowAliasFileNameFallback: isWindowsAppAliasPath(parsedExecutable, localAppData),
					appUserModelId            : identity.appUserModelId || undefined,
					windowTitle               : identity.displayName || launcherApp.name,
				};
			}

			if (!targetParsingPath) {
				return null;
			}

			return {
				id                        : launcherApp.id,
				name                      : launcherApp.name,
				executablePath            : '',
				allowAliasFileNameFallback: false,
				appUserModelId            : identity.appUserModelId || targetParsingPath,
				windowTitle               : identity.displayName || launcherApp.name,
			};
		});

		if (generation !== this.updateGeneration) {
			return;
		}

		this.registeredApps = resolved.filter(
			(value): value is ResolvedRegisteredApp => value !== null,
		);
		logger.info('Running app registrations resolved', {
			durationMs: Date.now() - startedAt,
			shortcutIdentityCount: unresolvedShortcutPaths.length,
			apps: this.registeredApps.map((registeredApp) => ({
				id                        : registeredApp.id,
				name                      : registeredApp.name,
				executablePath            : registeredApp.executablePath,
				profileDirectory          : registeredApp.profileDirectory ?? '',
				profileNames              : registeredApp.profileNames ?? [],
				appUserModelId            : registeredApp.appUserModelId ?? '',
				windowTitle               : registeredApp.windowTitle ?? '',
				allowAliasFileNameFallback: registeredApp.allowAliasFileNameFallback,
			})),
		});
		void this.refresh();
	}

	/** 監視を開始する */
	start(): void {
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
		if (this.inFlight || process.platform !== 'win32') {
			return;
		}

		this.inFlight = true;

		try {
			const processes = await enumerateTaskbarProcesses();
			const nextIds   = matchRunningAppIds(this.registeredApps, processes);

			this.logDiagnosticSnapshot(processes, nextIds);

			if (this.consecutiveFailures > 0) {
				logger.info('Running app monitor recovered', {
					failures: this.consecutiveFailures,
				});
			}

			this.consecutiveFailures = 0;
			this.publishIfChanged(nextIds);
		} catch (error) {
			this.consecutiveFailures += 1;
			const failure             = error as Error & {
				code?: string | number;
				killed?: boolean;
				signal?: string;
			};

			if (this.consecutiveFailures === 1 || this.consecutiveFailures % 10 === 0) {
				logger.warn('Running app monitor failed', {
					consecutiveFailures: this.consecutiveFailures,
					error              : error instanceof Error ? error.message : String(error),
					code               : failure.code ?? '',
					killed             : failure.killed ?? false,
					signal             : failure.signal ?? '',
				});
			}

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
	 * @returns {void}
	 */
	private logDiagnosticSnapshot(
		processes: TaskbarAppProcess[],
		matchedAppIds: string[],
	): void {
		const executableNames                       = new Set(
			this.registeredApps
				.map((registeredApp) => path.win32.basename(registeredApp.executablePath).toLowerCase())
				.filter(Boolean),
		);
		const appUserModelIds                       = new Set(
			this.registeredApps
				.map((registeredApp) => registeredApp.appUserModelId?.toLowerCase() ?? '')
				.filter(Boolean),
		);
		const windowTitles                          = this.registeredApps
			.map((registeredApp) => registeredApp.windowTitle?.normalize('NFKC').toLowerCase() ?? '')
			.filter(Boolean);
		const candidateWindows: TaskbarAppProcess[] = [];
		const otherWindows: TaskbarAppProcess[]     = [];

		for (const processInfo of processes) {
			const executableName = path.win32.basename(processInfo.executablePath).toLowerCase();
			const appUserModelId = processInfo.appUserModelId.toLowerCase();
			const windowTitle    = processInfo.windowTitle.normalize('NFKC').toLowerCase();
			const isCandidate    = executableNames.has(executableName)
				|| appUserModelIds.has(appUserModelId)
				|| windowTitles.some((title) => windowTitle.includes(title));

			(isCandidate ? candidateWindows : otherWindows).push(processInfo);
		}

		const windows               = candidateWindows.map((processInfo) => ({
			pid             : processInfo.pid,
			processName     : processInfo.processName,
			executablePath  : processInfo.executablePath,
			profileDirectory: getProfileDirectory(processInfo.commandLine),
			windowTitle     : processInfo.windowTitle,
			appUserModelId  : processInfo.appUserModelId,
		}));
		const otherWindowIdentities = otherWindows.map((processInfo) => ({
			pid           : processInfo.pid,
			processName   : processInfo.processName,
			executablePath: processInfo.executablePath,
			appUserModelId: processInfo.appUserModelId,
		}));
		const signature             = JSON.stringify({ windows, otherWindowIdentities, matchedAppIds });

		if (signature === this.lastDiagnosticSignature) {
			return;
		}

		this.lastDiagnosticSignature = signature;
		logger.info('Running app diagnostic snapshot', {
			windows,
			otherWindowIdentities,
			matchedAppIds,
		});
	}

	/**
	 * 変化時だけRendererへ通知する
	 * @param {string[]} nextIds 次のID集合
	 * @returns {void}
	 */
	private publishIfChanged(nextIds: string[]): void {
		if (areSameAppIds(this.currentAppIds, nextIds)) {
			return;
		}

		this.currentAppIds = [...nextIds].sort();

		if (this.window && !this.window.isDestroyed()) {
			this.window.webContents.send('running-apps:changed', this.getCurrentPayload());
		}
	}
}

export const runningAppsMonitor = new RunningAppsMonitor();
