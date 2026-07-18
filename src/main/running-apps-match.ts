import path from 'node:path';
import type { TaskbarAppProcess } from './types';

/** 解決済み登録アプリ */
export interface ResolvedRegisteredApp {
	id: string;
	name: string;
	executablePath: string;
	allowAliasFileNameFallback: boolean;
	profileDirectory?: string;
	profileNames?: string[];
	appUserModelId?: string;
	windowTitle?: string;
}

/** Windows標準のスクリプト／コンソールホスト */
const SCRIPT_HOST_NAMES = new Set([
	'cmd.exe',
	'conhost.exe',
	'cscript.exe',
	'mshta.exe',
	'powershell.exe',
	'pwsh.exe',
	'wscript.exe',
]);

/**
 * Windows実行パスを比較用に正規化する
 * @param {string} value 実行パス
 * @returns {string} 正規化済みパス
 */
export function normalizePathForMatch(value: string): string {
	if (!value || typeof value !== 'string') {
		return '';
	}

	return path.win32.normalize(value.trim().replace(/^"|"$/g, '')).toLowerCase();
}

/**
 * App Execution Aliasの登録パスか判定する
 * @param {string} value 登録パス
 * @param {string} localAppData LOCALAPPDATA
 * @returns {boolean} Aliasパスならtrue
 */
export function isWindowsAppAliasPath(value: string, localAppData: string): boolean {
	const normalized = normalizePathForMatch(value);
	const aliasRoot  = normalizePathForMatch(
		path.win32.join(localAppData, 'Microsoft', 'WindowsApps'),
	);

	return Boolean(aliasRoot)
		&& (normalized === aliasRoot || normalized.startsWith(`${aliasRoot}\\`));
}

/**
 * 誤検知を避けるため監視対象外とするホストか判定する
 * @param {string} executablePath 実行パス
 * @returns {boolean} 対象外ならtrue
 */
export function isExcludedScriptHost(executablePath: string): boolean {
	return SCRIPT_HOST_NAMES.has(path.win32.basename(executablePath).toLowerCase());
}

/**
 * Chromium系のプロファイル識別引数を取得する
 * @param {string} commandLine 引数またはコマンドライン
 * @returns {string} プロファイルディレクトリ
 */
export function getProfileDirectory(commandLine: string): string {
	const match = String(commandLine ?? '').match(
		/--profile-directory(?:=|\s+)(?:"([^"]+)"|([^\s"]+))/i,
	);

	return (match?.[1] ?? match?.[2] ?? '').trim().toLowerCase();
}

/**
 * AUMIDやウィンドウタイトルを比較用に正規化する
 * @param {string} value 文字列
 * @returns {string} 正規化済み文字列
 */
function normalizeIdentity(value: string): string {
	return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

/**
 * アプリ名と一般的なWindowsタイトル形式を照合する
 * @param {string} expected 登録アプリ名
 * @param {string} actual ウィンドウタイトル
 * @returns {boolean} 一致時true
 */
function matchesWindowTitle(expected: string, actual: string): boolean {
	const expectedValue = normalizeIdentity(expected);
	const actualValue   = normalizeIdentity(actual);

	if (!expectedValue || !actualValue) {
		return false;
	}

	return actualValue === expectedValue
		|| actualValue.endsWith(` - ${expectedValue}`)
		|| actualValue.startsWith(`${expectedValue} - `);
}

/**
 * Chromium系ウィンドウタイトルの独立セグメントとプロファイル表示名を照合する
 * @param {ResolvedRegisteredApp} app 登録アプリ
 * @param {TaskbarAppProcess} processInfo タスクバープロセス
 * @returns {boolean} 一致時true
 */
function matchesProfileWindowTitle(
	app: ResolvedRegisteredApp,
	processInfo: TaskbarAppProcess,
): boolean {
	if (!app.profileDirectory || !app.profileNames?.length) {
		return false;
	}

	if (normalizePathForMatch(app.executablePath)
		!== normalizePathForMatch(processInfo.executablePath)) {
		return false;
	}

	const titleSegments = normalizeIdentity(processInfo.windowTitle)
		.split(/\s+[-\u2013\u2014]\s+/u)
		.map((value) => value.trim())
		.filter(Boolean);
	const profileNames  = new Set(app.profileNames.map(normalizeIdentity).filter(Boolean));

	return titleSegments.some((segment) => profileNames.has(segment));
}

/**
 * 実行パスとプロファイル識別子が一致するか判定する
 * @param {ResolvedRegisteredApp} app 登録アプリ
 * @param {TaskbarAppProcess} processInfo タスクバープロセス
 * @returns {boolean} 一致時true
 */
function matchesExecutable(
	app: ResolvedRegisteredApp,
	processInfo: TaskbarAppProcess,
): boolean {
	const processPath = normalizePathForMatch(processInfo.executablePath);
	const appPaths    = [app.executablePath]
		.map(normalizePathForMatch)
		.filter((value) => value && !isExcludedScriptHost(value));

	if (!appPaths.includes(processPath)) {
		return false;
	}

	if (app.profileDirectory
		&& getProfileDirectory(processInfo.commandLine) !== app.profileDirectory) {
		return false;
	}

	return true;
}

/**
 * 登録アプリとタスクバープロセスを照合する
 * @param {ResolvedRegisteredApp[]} registeredApps 解決済み登録アプリ
 * @param {TaskbarAppProcess[]} processes タスクバー対象プロセス
 * @returns {string[]} 起動中アプリID
 */
export function matchRunningAppIds(
	registeredApps: ResolvedRegisteredApp[],
	processes: TaskbarAppProcess[],
): string[] {
	const result = new Set<string>();

	for (const app of registeredApps) {
		for (const processInfo of processes) {
			if (app.appUserModelId
				&& normalizeIdentity(processInfo.appUserModelId) === normalizeIdentity(app.appUserModelId)) {
				result.add(app.id);
				break;
			}

			if (matchesProfileWindowTitle(app, processInfo)) {
				result.add(app.id);
				break;
			}

			if (app.windowTitle && matchesWindowTitle(app.windowTitle, processInfo.windowTitle)) {
				result.add(app.id);
				break;
			}

			if (matchesExecutable(app, processInfo)) {
				result.add(app.id);
				break;
			}

			const normalized = normalizePathForMatch(app.executablePath);

			if (app.allowAliasFileNameFallback
				&& !app.profileDirectory
				&& path.win32.basename(normalizePathForMatch(processInfo.executablePath))
					=== path.win32.basename(normalized)) {
				result.add(app.id);
				break;
			}
		}
	}

	return [...result].sort();
}

/**
 * ID集合が同一か判定する
 * @param {string[]} left 左辺
 * @param {string[]} right 右辺
 * @returns {boolean} 同一ならtrue
 */
export function areSameAppIds(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	const sortedLeft  = [...left].sort();
	const sortedRight = [...right].sort();

	return sortedLeft.every((value, index) => value === sortedRight[index]);
}
