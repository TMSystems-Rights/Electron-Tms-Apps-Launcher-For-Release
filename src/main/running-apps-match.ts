/**
 * 登録アプリと起動中プロセスが同じものかを、パスと比較ルールだけで判定する
 * プロセスの列挙は行わず、渡された一覧を読むだけにする
 * @file
 */
import path from 'node:path';
import type { TaskbarAppProcess } from './types';

/** 起動中プロセスと突き合わせる、解決済みの登録アプリ */
export interface ResolvedRegisteredApp {
	/** LauncherApp.id */
	id: string;
	/** コンソールタイトルや表示名の比較に使う名前 */
	name: string;
	/** 比較用に正規化する前の実行ファイルパス */
	executablePath: string;
	/** true のとき、WindowsApps のエイリアスはファイル名だけでも一致させてよい */
	allowAliasFileNameFallback: boolean;
	/** Chromium 系のプロファイルディレクトリ。該当しない起動は未設定 */
	profileDirectory?: string;
	/** プロファイルの表示名。複数プロファイルを区別する */
	profileNames?: string[];
	/** ショートカットから読んだ AppUserModelID。無いときは未設定 */
	appUserModelId?: string;
	/** 一致に使うウィンドウタイトル。指定が無い起動は未設定 */
	windowTitle?: string;
}

/** Windows標準のスクリプト／コンソールホスト */
const SCRIPT_HOST_NAMES = new Set(['cmd.exe', 'conhost.exe', 'cscript.exe', 'mshta.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe']);

/**
 * Windows実行パスを比較用に正規化する
 * @param {string} value 実行パス
 * @returns {string} 正規化済みパス
 */
export function normalizePathForMatch(value: string): string {
	// 値が空、または文字列でない
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
	// 比較用に正規化した登録パス。空なら Alias ではない
	const normalized = normalizePathForMatch(value);
	// WindowsApps 直下。LOCALAPPDATA が空なら空
	const aliasRoot  = normalizePathForMatch(path.win32.join(localAppData, 'Microsoft', 'WindowsApps'));

	return Boolean(aliasRoot) && (normalized === aliasRoot || normalized.startsWith(`${aliasRoot}\\`));
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
	// 最初に見つかったプロファイル指定。無ければ空
	const match = String(commandLine ?? '').match(/--profile-directory(?:=|\s+)(?:"([^"]+)"|([^\s"]+))/i);

	return (match?.[1] ?? match?.[2] ?? '').trim().toLowerCase();
}

/**
 * AUMIDやウィンドウタイトルを比較用に正規化する
 * @param {string} value 文字列
 * @returns {string} 正規化済み文字列
 */
function normalizeIdentity(value: string): string {
	return String(value ?? '')
		.normalize('NFKC')
		.trim()
		.toLowerCase();
}

/**
 * batch の簡易コマンドラインを引数配列へ分割する
 * @param {string} value コマンドライン
 * @returns {string[]} 引数
 */
function parseBatchArguments(value: string): string[] {
	// 分割結果。空入力のときは空配列
	const result: string[] = [];
	// 組み立て中の 1 引数。クォート中は空白も含む
	let current            = '';
	// ダブルクォートの内側なら true。初期は外側
	let inQuotes           = false;
	// 空クォートも含め、出力すべき内容があるか。未着手は false
	let hasContent         = false;

	for (const ch of value.trim()) {
		// クォートの開始または終了である
		if (ch === '"') {
			inQuotes   = !inQuotes;
			hasContent = true;
			continue;
		}

		// クォートの外であり、かつ空白である。どちらか欠けると区切らない
		if (!inQuotes && /\s/.test(ch)) {
			// 空白の前に引数の中身がある
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

	// 末尾に未出力の引数がある
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
	// start のオプションを読み飛ばす位置。先頭は 0
	let index = 0;

	while (args[index]?.startsWith('/')) {
		// 小文字にしたスイッチ。/d のときだけ次も消費する
		const option = args[index].toLowerCase();

		index += 1;

		// 作業ディレクトリ指定であり、かつ次の引数が残っている
		if (option === '/d' && index < args.length) {
			index += 1;
		}
	}

	// start の空タイトルを飛ばす
	if (args[index] === '') {
		index += 1;
	}

	// タイトルの次にある起動対象。無ければ空
	const candidate = args[index] ?? '';

	// 絶対パスであり、かつ拡張子が exe である
	if (path.win32.isAbsolute(candidate) && path.win32.extname(candidate).toLowerCase() === '.exe') {
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
	// set で集めた変数。キーは小文字。未定義の参照は元のトークンのまま
	const variables = new Map<string, string>();
	// 改行で分けた行。空スクリプトは空配列
	const lines     = String(scriptContent ?? '').split(/\r?\n/);

	for (const rawLine of lines) {
		// 先頭の @ と空白を除いた行。空行は無視する
		const line = rawLine.trim().replace(/^@+/, '').trim();

		// 空行、rem、または :: コメントである
		if (!line || /^rem(?:\s|$)/i.test(line) || line.startsWith('::')) {
			continue;
		}

		// set 文の名前と値。マッチしなければ null
		const setMatch = line.match(/^set\s+(?:"([^=]+)=(.*)"|([^=\s]+)=(.*))$/i);

		// 変数代入である
		if (setMatch) {
			// 代入先。クォート有無でキャプチャ位置が変わる。空なら捨てる
			const name  = (setMatch[1] ?? setMatch[3] ?? '').trim();
			// 代入値。まだ %VAR% を含むことがある
			const value = (setMatch[2] ?? setMatch[4] ?? '').trim();

			// 変数名がある
			if (name) {
				variables.set(name.toLowerCase(), expandBatchVariables(value, variables));
			}

			continue;
		}

		// 既知の変数を展開した行
		const expanded = expandBatchVariables(line, variables);
		// 展開後の引数。空行なら空配列
		const args     = parseBatchArguments(expanded);

		// start コマンドでない
		if (args[0]?.toLowerCase() !== 'start') {
			continue;
		}

		// start のうしろから取り出した exe。無ければ空
		const executablePath = getStartCommandExecutable(args.slice(1));

		// exe の絶対パスを取り出せた
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
	// 比較用の登録名。空なら一致させない
	const expectedValue = normalizeIdentity(expected);
	// 比較用のウィンドウタイトル。空なら一致させない
	const actualValue   = normalizeIdentity(actual);

	// 登録名が空、またはタイトルが空である
	if (!expectedValue || !actualValue) {
		return false;
	}

	return actualValue === expectedValue || actualValue.endsWith(` - ${expectedValue}`) || actualValue.startsWith(`${expectedValue} - `);
}

/**
 * Chromium系ウィンドウタイトルの独立セグメントとプロファイル表示名を照合する
 * @param {ResolvedRegisteredApp} app 登録アプリ
 * @param {TaskbarAppProcess} processInfo タスクバープロセス
 * @returns {boolean} 一致時true
 */
function matchesProfileWindowTitle(app: ResolvedRegisteredApp, processInfo: TaskbarAppProcess): boolean {
	// プロファイルディレクトリが無い、または表示名が空である
	if (!app.profileDirectory || !app.profileNames?.length) {
		return false;
	}

	// 実行ファイルのパスが違う
	if (normalizePathForMatch(app.executablePath) !== normalizePathForMatch(processInfo.executablePath)) {
		return false;
	}

	// ダッシュで分けたタイトル断片。空断片は除く
	const titleSegments  = normalizeIdentity(processInfo.windowTitle)
		.split(/\s+[-\u2013\u2014]\s+/u)
		.map((value) => value.trim())
		.filter(Boolean);
	// 比較用のプロファイル表示名。空名は除く
	const profileNames   = new Set(app.profileNames.map(normalizeIdentity).filter(Boolean));
	// 末尾の一つ前。タイトルが 2 断片未満なら空
	const profileSegment = titleSegments.length >= 2 ? titleSegments[titleSegments.length - 2] : '';

	return Boolean(profileSegment) && profileNames.has(profileSegment);
}

/**
 * 実行パスとプロファイル識別子が一致するか判定する
 * @param {ResolvedRegisteredApp} app 登録アプリ
 * @param {TaskbarAppProcess} processInfo タスクバープロセス
 * @returns {boolean} 一致時true
 */
function matchesExecutable(app: ResolvedRegisteredApp, processInfo: TaskbarAppProcess): boolean {
	// 比較用のプロセスパス。空なら一致しない
	const processPath = normalizePathForMatch(processInfo.executablePath);
	// スクリプトホストを除いた登録パス。空なら比較対象が無い
	const appPaths    = [app.executablePath].map(normalizePathForMatch).filter((value) => value && !isExcludedScriptHost(value));

	// 登録パスにプロセスパスが含まれない
	if (!appPaths.includes(processPath)) {
		return false;
	}

	// プロファイル指定があり、かつコマンドラインのプロファイルと違う
	if (app.profileDirectory && getProfileDirectory(processInfo.commandLine) !== app.profileDirectory) {
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
export function matchRunningAppIds(registeredApps: ResolvedRegisteredApp[], processes: TaskbarAppProcess[]): string[] {
	// 一致した登録アプリ ID。重複は Set が除く
	const result = new Set<string>();

	for (const app of registeredApps) {
		for (const processInfo of processes) {
			// AUMID があり、かつプロセス側と同じである
			if (app.appUserModelId && normalizeIdentity(processInfo.appUserModelId) === normalizeIdentity(app.appUserModelId)) {
				result.add(app.id);
				break;
			}

			// プロファイル表示名がウィンドウタイトルと一致した
			if (matchesProfileWindowTitle(app, processInfo)) {
				result.add(app.id);
				break;
			}

			// タイトル指定があり、実行パスがあるか AUMID が無く、かつタイトルが一致する
			if (app.windowTitle && (app.executablePath || !app.appUserModelId) && matchesWindowTitle(app.windowTitle, processInfo.windowTitle)) {
				result.add(app.id);
				break;
			}

			// 実行パスとプロファイルが一致した
			if (matchesExecutable(app, processInfo)) {
				result.add(app.id);
				break;
			}

			// 比較用の登録パス。空ならファイル名比較をしない
			const normalized = normalizePathForMatch(app.executablePath);

			// エイリアスのファイル名比較が許され、プロファイルが無く、かつファイル名が同じである
			if (app.allowAliasFileNameFallback && !app.profileDirectory && path.win32.basename(normalizePathForMatch(processInfo.executablePath)) === path.win32.basename(normalized)) {
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
	// 件数が違う
	if (left.length !== right.length) {
		return false;
	}

	// 比較用に並べた左辺
	const sortedLeft  = [...left].sort();
	// 比較用に並べた右辺
	const sortedRight = [...right].sort();

	return sortedLeft.every((value, index) => value === sortedRight[index]);
}
