import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import { logger } from './logger';
import { isValidExecutablePath, normalizeExecutablePath, pathExists, readShortcut } from './native';
import type { LaunchResult } from './types';

/** execFile / spawn 単体では直接起動できない拡張子 */
const SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1', '.vbs', '.js']);

/** コンソール（黒い画面）を伴うインタプリタの実行ファイル名 */
const CONSOLE_INTERPRETERS = new Set([
	'cmd.exe',
	'powershell.exe',
	'pwsh.exe',
	'wscript.exe',
	'cscript.exe',
]);

/**
 * ショートカット起動用 VBS スクリプトのパス
 * @returns {string} VBS パス
 */
function getLaunchShortcutScriptPath(): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, 'launch-shortcut.vbs');
	}

	return path.join(app.getAppPath(), 'resources', 'launch-shortcut.vbs');
}

/**
 * 起動後のランチャー挙動を適用する
 * @param {BrowserWindow} win メインウィンドウ
 * @param {'stay' | 'minimize' | 'close'} behavior 挙動
 * @returns {void}
 */
function applyLaunchBehavior(
	win: BrowserWindow,
	behavior: 'stay' | 'minimize' | 'close',
): void {
	if (behavior === 'minimize') {
		win.minimize();
		return;
	}

	if (behavior === 'close') {
		win.close();
	}
}

/**
 * ランチャーとは別プロセスとして起動する（ランチャー終了時に連鎖終了しない）
 * @param {string} command 実行ファイル
 * @param {string[]} argList 引数
 * @param {string} [cwd] 作業ディレクトリ
 * @param {boolean} [windowsHide=false] ウィンドウ非表示
 * @returns {Promise<void>}
 */
function spawnDetached(
	command: string,
	argList: string[],
	cwd?: string,
	windowsHide = false,
	verbatim = false,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, argList, {
			cwd                     : cwd || undefined,
			detached                : true,
			stdio                   : 'ignore',
			windowsHide,
			windowsVerbatimArguments: verbatim,
		});

		child.once('error', reject);
		child.unref();
		resolve();
	});
}

/**
 * 短時間で終了するヘルパープロセスを起動し、終了コードと出力を確認する
 * @param {string} command 実行ファイル
 * @param {string[]} argList 引数
 * @param {string} [cwd] 作業ディレクトリ
 * @param {boolean} [windowsHide=false] ウィンドウ非表示
 * @returns {Promise<void>}
 */
function spawnAndWait(
	command: string,
	argList: string[],
	cwd?: string,
	windowsHide = false,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		const child                  = spawn(command, argList, {
			cwd   : cwd || undefined,
			stdio : ['ignore', 'pipe', 'pipe'],
			windowsHide,
		});

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', (chunk: string) => {
			stdoutChunks.push(chunk);
		});

		child.stderr.on('data', (chunk: string) => {
			stderrChunks.push(chunk);
		});

		child.once('error', reject);
		child.once('close', (code) => {
			const stdoutText = stdoutChunks.join('').trim();
			const stderrText = stderrChunks.join('').trim();
			const detail     = stderrText || stdoutText;

			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(
				`${command} exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
			));
		});
	});
}

/**
 * PowerShell -EncodedCommand 用に UTF-16LE Base64 化する
 * @param {string} script PowerShell スクリプト
 * @returns {string} Base64 文字列
 */
function encodePowerShellCommand(script: string): string {
	return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Windows コマンドライン引数として安全にダブルクォートする
 * @param {string} value 引数値
 * @returns {string} クォート済み引数
 */
function quoteWindowsArgument(value: string): string {
	if (!value) {
		return '""';
	}

	return `"${value
		.replace(/(\\*)"/g, '$1$1\\"')
		.replace(/(\\+)$/g, '$1$1')}"`;
}

/**
 * 管理者権限で Start-Process するための PowerShell を起動する
 * @param {string} filePath 起動対象
 * @param {string} argumentLine 引数文字列
 * @param {string} workingDir 作業ディレクトリ
 * @returns {Promise<void>}
 */
async function startProcessElevated(
	filePath: string,
	argumentLine: string,
	workingDir: string,
): Promise<void> {
	const payload = Buffer.from(JSON.stringify({
		filePath    : filePath,
		argumentLine: argumentLine,
		workingDir  : workingDir,
	}), 'utf8').toString('base64');
	const script  = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$params = @{
	FilePath = [string]$payload.filePath
	Verb = 'RunAs'
}
$argumentLine = [string]$payload.argumentLine
if (-not [string]::IsNullOrWhiteSpace($argumentLine)) {
	$params.ArgumentList = $argumentLine
}
$workingDir = [string]$payload.workingDir
if (-not [string]::IsNullOrWhiteSpace($workingDir)) {
	$params.WorkingDirectory = $workingDir
}
Start-Process @params
`;

	await spawnAndWait(
		'powershell.exe',
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-EncodedCommand',
			encodePowerShellCommand(script),
		],
		undefined,
		true,
	);
}

/**
 * Windows のコマンドライン引数文字列を引数配列へ分割する。
 * ダブルクォートで囲まれた区間は 1 引数として扱い、囲みクォートは除去する。
 * 例: '/c "C:\\my path\\x.bat"' -> ['/c', 'C:\\my path\\x.bat']
 * @param {string} argString 引数文字列
 * @returns {string[]} 引数配列
 */
function parseWindowsArgs(argString: string): string[] {
	const result: string[] = [];
	const trimmed          = argString.trim();

	if (!trimmed) {
		return result;
	}

	let current    = '';
	let inQuotes   = false;
	let hasContent = false;

	for (const ch of trimmed) {
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
 * ターゲットがコンソール（黒い画面）を伴うインタプリタ／スクリプトか判定する
 * @param {string} targetPath 実行パス
 * @returns {boolean} コンソール系なら true
 */
function isConsoleScriptTarget(targetPath: string): boolean {
	const base = path.basename(targetPath).toLowerCase();

	if (CONSOLE_INTERPRETERS.has(base)) {
		return true;
	}

	return SCRIPT_EXTENSIONS.has(path.extname(targetPath).toLowerCase());
}

/**
 * start コマンドのタイトルに使える安全な文字列へ整形する
 * （ダブルクォート・パーセント・改行は cmd の解釈を壊すため除去）
 * @param {string} name アプリ名
 * @returns {string} 整形後タイトル
 */
function sanitizeConsoleTitle(name: string): string {
	const cleaned = (name || '').replace(/["%\r\n]/g, ' ').trim();

	return cleaned || 'App';
}

/**
 * start に渡す「インタプリタ＋引数」部分のコマンドライン文字列を組み立てる。
 * スクリプト直接指定（.bat/.ps1 等）はダブルクリック相当の起動コマンドへ展開する。
 * @param {string} targetPath 実行パス
 * @param {string} args 引数（.lnk 由来の場合は既にクォート済み）
 * @returns {string} コマンドライン文字列
 */
function buildConsoleInvocation(targetPath: string, args: string): string {
	const ext       = path.extname(targetPath).toLowerCase();
	const argSuffix = args ? ` ${args}` : '';

	if (ext === '.bat' || ext === '.cmd') {
		return `cmd.exe /c "${targetPath}"${argSuffix}`;
	}

	if (ext === '.ps1') {
		return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${targetPath}"${argSuffix}`;
	}

	if (ext === '.vbs' || ext === '.js') {
		return `wscript.exe "${targetPath}"${argSuffix}`;
	}

	// 既にインタプリタ（cmd.exe 等）の場合はそのまま実行する。
	return `"${targetPath}"${argSuffix}`;
}

/**
 * Start-Process -Verb RunAs に渡す実行ファイルと引数文字列を組み立てる
 * @param {string} targetPath 実行パス
 * @param {string} args 引数
 * @returns {{ filePath: string; argumentLine: string }} 起動情報
 */
function buildElevatedInvocation(
	targetPath: string,
	args: string,
): { filePath: string; argumentLine: string } {
	const ext       = path.extname(targetPath).toLowerCase();
	const argSuffix = args ? ` ${args}` : '';

	if (ext === '.bat' || ext === '.cmd') {
		return {
			filePath    : 'cmd.exe',
			argumentLine: `/d /c ${quoteWindowsArgument(targetPath)}${argSuffix}`,
		};
	}

	if (ext === '.ps1') {
		return {
			filePath    : 'powershell.exe',
			argumentLine: [
				'-NoProfile',
				'-ExecutionPolicy Bypass',
				`-File ${quoteWindowsArgument(targetPath)}${argSuffix}`,
			].join(' '),
		};
	}

	if (ext === '.vbs' || ext === '.js') {
		return {
			filePath    : 'wscript.exe',
			argumentLine: `${quoteWindowsArgument(targetPath)}${argSuffix}`,
		};
	}

	return {
		filePath    : targetPath,
		argumentLine: args,
	};
}

/**
 * コンソール系ターゲットを、ウィンドウタイトルにアプリ名を設定して起動する。
 * `cmd /c start "<タイトル>" ...` を使うと、bat 内部の入れ子 cmd/pwsh 呼び出しに
 * 上書きされずタイトルが保持される（エクスプローラ起動時のような識別性を担保）。
 * @param {string} title ウィンドウタイトル（アプリ名）
 * @param {string} targetPath 実行パス
 * @param {string} args 引数
 * @param {string} cwd 作業ディレクトリ
 * @returns {Promise<void>}
 */
async function launchConsoleWithTitle(
	title: string,
	targetPath: string,
	args: string,
	cwd: string,
): Promise<void> {
	const safeTitle   = sanitizeConsoleTitle(title);
	const dirPart     = cwd ? ` /d "${cwd.replace(/\\+$/, '')}"` : '';
	const invocation  = buildConsoleInvocation(targetPath, args);
	const commandLine = `/d /c start "${safeTitle}"${dirPart} ${invocation}`;

	// 外側 cmd は start を呼んで即終了するだけなので非表示にする。
	// start は新規コンソール（CREATE_NEW_CONSOLE）を生成するため、子ウィンドウは表示される。
	await spawnDetached('cmd.exe', [commandLine], cwd, true, true);
}

/**
 * 解決済みターゲットを管理者権限で起動する
 * @param {string} targetPath 実行パス
 * @param {string} args 引数
 * @param {string} workingDir 作業ディレクトリ
 * @param {string} [title] コンソール系の場合に設定するウィンドウタイトル
 * @returns {Promise<void>}
 */
async function launchResolvedTargetAsAdmin(
	targetPath: string,
	args: string,
	workingDir: string,
	title?: string,
): Promise<void> {
	if (process.platform !== 'win32') {
		throw new Error('管理者として実行は Windows でのみ利用できます。');
	}

	const cwd = workingDir || path.dirname(targetPath);

	if (title && isConsoleScriptTarget(targetPath)) {
		const safeTitle   = sanitizeConsoleTitle(title);
		const dirPart     = cwd ? ` /d "${cwd.replace(/\\+$/, '')}"` : '';
		const invocation  = buildConsoleInvocation(targetPath, args);
		const commandLine = `/d /c start "${safeTitle}"${dirPart} ${invocation}`;

		await startProcessElevated('cmd.exe', commandLine, cwd);
		return;
	}

	const invocation = buildElevatedInvocation(targetPath, args);

	await startProcessElevated(invocation.filePath, invocation.argumentLine, cwd);
}

/**
 * 解決済みターゲットを別プロセスで起動する
 * @param {string} targetPath 実行パス
 * @param {string} args 引数
 * @param {string} workingDir 作業ディレクトリ
 * @param {string} [title] コンソール系の場合に設定するウィンドウタイトル
 * @param {boolean} [runAsAdmin=false] 管理者権限で起動するか
 * @returns {Promise<void>}
 */
async function launchResolvedTarget(
	targetPath: string,
	args: string,
	workingDir: string,
	title?: string,
	runAsAdmin = false,
): Promise<void> {
	const cwd = workingDir || path.dirname(targetPath);

	if (runAsAdmin) {
		await launchResolvedTargetAsAdmin(targetPath, args, workingDir, title);
		return;
	}

	// コンソール（黒い画面）を伴う起動は、識別しやすいようアプリ名をタイトルに表示する。
	if (title && isConsoleScriptTarget(targetPath)) {
		await launchConsoleWithTitle(title, targetPath, args, cwd);
		return;
	}

	const argList = parseWindowsArgs(args);
	const ext     = path.extname(targetPath).toLowerCase();

	if (ext === '.bat' || ext === '.cmd') {
		await spawnDetached('cmd.exe', ['/d', '/c', targetPath, ...argList], cwd);
		return;
	}

	if (ext === '.ps1') {
		await spawnDetached(
			'powershell.exe',
			['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', targetPath, ...argList],
			cwd,
		);
		return;
	}

	await spawnDetached(targetPath, argList, cwd);
}

/**
 * .lnk を ShellExecute 経由で別プロセス起動する（ダブルクリック相当）
 *
 * explorer.exe / cmd start 経由だと .lnk 内の AUMI や作業フォルダが
 * 正しく反映されず、タスクバーアイコンが崩れることがある。
 * @param {string} lnkPath ショートカットパス
 * @returns {Promise<void>}
 */
async function launchShortcut(lnkPath: string): Promise<void> {
	if (process.platform === 'win32') {
		const scriptPath = getLaunchShortcutScriptPath();

		if (!pathExists(scriptPath)) {
			throw new Error(`Shortcut launcher script not found: ${scriptPath}`);
		}

		await spawnDetached('wscript.exe', ['//B', '//Nologo', scriptPath, lnkPath], undefined, true);
		return;
	}

	const openResult = await shell.openPath(lnkPath);

	if (openResult) {
		throw new Error(openResult);
	}
}

/**
 * アプリを起動する
 * @param {BrowserWindow} win メインウィンドウ
 * @param {string} appPath 実行パス
 * @param {string} args 引数
 * @param {string} workingDir 作業ディレクトリ
 * @param {'stay' | 'minimize' | 'close'} launchBehavior 起動後挙動
 * @param {string} [appName] ランチャー登録名（コンソール系のタブタイトルに使用）
 * @param {boolean} [runAsAdmin=false] 管理者権限で起動するか
 * @returns {Promise<LaunchResult>} 起動結果
 */
export async function launchApp(
	win: BrowserWindow,
	appPath: string,
	args: string,
	workingDir: string,
	launchBehavior: 'stay' | 'minimize' | 'close',
	appName = '',
	runAsAdmin = false,
): Promise<LaunchResult> {
	const normalizedPath = normalizeExecutablePath(appPath);

	if (!isValidExecutablePath(normalizedPath)) {
		return {
			success: false,
			error  : `Unsupported file type: ${appPath}`,
		};
	}

	if (!pathExists(normalizedPath)) {
		return {
			success: false,
			error  : `Path not found: ${normalizedPath}`,
		};
	}

	try {
		const ext         = path.extname(normalizedPath).toLowerCase();
		const startedAt   = Date.now();
		let   readMs      = 0;
		let   launchedVia = runAsAdmin ? 'runas' : 'direct';
		let   targetPath  = normalizedPath;

		if (ext === '.lnk') {
			// .lnk のターゲットを読み取り、ターゲットを直接起動する。
			// .lnk 自体を ShellExecute するとシェルのリンク解決（分散リンク追跡）が走り、
			// 環境によっては初回に数十秒ハング＆システム全体が固まる。直接起動でこれを回避する。
			const readStart = Date.now();
			const shortcut  = await readShortcut(normalizedPath);

			readMs = Date.now() - readStart;

			if (shortcut?.target) {
				targetPath = shortcut.target;
				await launchResolvedTarget(
					shortcut.target,
					args || shortcut.args,
					workingDir || shortcut.cwd,
					appName,
					runAsAdmin,
				);
			} else {
				// ターゲットを解決できない（UWP/PIDL 形式等）場合のみ ShellExecute にフォールバックする。
				if (runAsAdmin) {
					launchedVia = 'shortcut-runas';
					await launchResolvedTarget(normalizedPath, args, workingDir, appName, true);
				} else {
					launchedVia = 'shellexecute';
					await launchShortcut(normalizedPath);
				}
			}
		} else {
			await launchResolvedTarget(normalizedPath, args, workingDir, appName, runAsAdmin);
		}

		applyLaunchBehavior(win, launchBehavior);

		logger.info('App launched', {
			path     : normalizedPath,
			target   : targetPath,
			via      : launchedVia,
			runAsAdmin,
			readMs,
			totalMs  : Date.now() - startedAt,
		});
		return { success: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		logger.error('App launch failed', { path: appPath, error: message });

		return {
			success: false,
			error  : message,
		};
	}
}
