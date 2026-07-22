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
 * batch の簡易コマンドラインを引数配列へ分割する
 * @param {string} value コマンドライン
 * @returns {string[]} 引数
 */
function parseBatchArguments(value: string): string[] {
	const result: string[] = [];
	let   current          = '';
	let   inQuotes         = false;
	let   hasContent       = false;

	for (const ch of value.trim()) {
		if (ch === '"') {
			inQuotes   = !inQuotes;
			hasContent = true;
			continue;
		}

		if (!inQuotes && /\s/.test(ch)) {
			if (hasContent) {
				result.push(current);
				current    = '';
				hasContent = false;
			}

			continue;
		}

		current   += ch;
		hasContent = true;
	}

	if (hasContent) {
		result.push(current);
	}

	return result;
}

/**
 * batch 変数を展開する
 * @param {string} value 対象文字列
 * @param {Map<string, string>} variables 変数
 * @returns {string} 展開後文字列
 */
function expandBatchVariables(value: string, variables: Map<string, string>): string {
	return value.replace(/%([^%]+)%/g, (token, name: string) => {
		return variables.get(name.toLowerCase()) ?? token;
	});
}

/**
 * batch の start コマンド引数から起動 exe を取り出す
 * @param {string[]} args start 以降の引数
 * @returns {string} exe パス
 */
function getStartCommandExecutable(args: string[]): string {
	let index = 0;

	while (args[index]?.startsWith('/')) {
		const option = args[index].toLowerCase();

		index += 1;

		if (option === '/d' && index < args.length) {
			index += 1;
		}
	}

	if (args[index] === '') {
		index += 1;
	}

	const candidate = args[index] ?? '';

	if (path.win32.isAbsolute(candidate)
		&& path.win32.extname(candidate).toLowerCase() === '.exe') {
		return candidate;
	}

	return '';
}

/**
 * batch の代表的な `start "" "%VAR%"` 形式から起動 exe を抽出する
 * @param {string} scriptContent batch 内容
 * @returns {string} 起動 exe パス
 */
export function getBatchLaunchExecutable(scriptContent: string): string {
	const variables = new Map<string, string>();
	const lines     = String(scriptContent ?? '').split(/\r?\n/);

	for (const rawLine of lines) {
		const line = rawLine.trim().replace(/^@+/, '').trim();

		if (!line || /^rem(?:\s|$)/i.test(line) || line.startsWith('::')) {
			continue;
		}

		const setMatch = line.match(/^set\s+(?:"([^=]+)=(.*)"|([^=\s]+)=(.*))$/i);

		if (setMatch) {
			const name  = (setMatch[1] ?? setMatch[3] ?? '').trim();
			const value = (setMatch[2] ?? setMatch[4] ?? '').trim();

			if (name) {
				variables.set(name.toLowerCase(), expandBatchVariables(value, variables));
			}

			continue;
		}

		const expanded = expandBatchVariables(line, variables);
		const args     = parseBatchArguments(expanded);

		if (args[0]?.toLowerCase() !== 'start') {
			continue;
		}

		const executablePath = getStartCommandExecutable(args.slice(1));

		if (executablePath) {
			return executablePath;
		}
	}

	return '';
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

	const titleSegments  = normalizeIdentity(processInfo.windowTitle)
		.split(/\s+[-\u2013\u2014]\s+/u)
		.map((value) => value.trim())
		.filter(Boolean);
	const profileNames   = new Set(app.profileNames.map(normalizeIdentity).filter(Boolean));
	const profileSegment = titleSegments.length >= 2
		? titleSegments[titleSegments.length - 2]
		: '';

	return Boolean(profileSegment) && profileNames.has(profileSegment);
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

			if (app.windowTitle
				&& (app.executablePath || !app.appUserModelId)
				&& matchesWindowTitle(app.windowTitle, processInfo.windowTitle)) {
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
