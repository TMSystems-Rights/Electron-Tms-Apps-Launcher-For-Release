/**
 * 登録アプリを、拡張子と管理者権限に応じた方法で起動する
 * 起動結果以外は保存せず、データ更新は呼び出し側が行う
 * @file
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, dialog, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import { logger } from './logger';
import { isValidExecutablePath, normalizeExecutablePath, pathExists, readShortcut } from './native';
import { getOutlookClassicLaunchAction, isOutlookClassicExecutable, runOutlookClassicGuard } from './outlook-classic';
import type { OutlookClassicGuardResult } from './outlook-classic';
import type { LaunchResult } from './types';

/** execFile / spawn 単体では直接起動できない拡張子 */
const SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1', '.vbs', '.js']);

/** コンソール（黒い画面）を伴うインタプリタの実行ファイル名 */
const CONSOLE_INTERPRETERS = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe']);

/** Edge はプロファイル起動を自前の broker が処理するため、v1.7.1 と同じ direct 起動にする */
const DIRECT_GUI_EXECUTABLES = new Set(['msedge.exe', 'msedge_proxy.exe']);

/** 実際の起動・処理方式 */
type LaunchVia = 'runas' | 'direct' | 'shellexecute' | 'shortcut-runas' | 'foreground';

/** Outlook classic 起動前ガードの結果 */
type OutlookClassicPrelaunchResult = { action: 'continue' } | { action: 'activated'; guardResult: OutlookClassicGuardResult } | { action: 'cancelled'; guardResult: OutlookClassicGuardResult };

/**
 * ショートカット起動用 VBS スクリプトのパス
 * @returns {string} VBS パス
 */
function getLaunchShortcutScriptPath(): string {
	// パッケージ済みなら resources、開発時はアプリ直下
	if (app.isPackaged) {
		return path.join(process.resourcesPath, 'launch-shortcut.vbs');
	}

	return path.join(app.getAppPath(), 'resources', 'launch-shortcut.vbs');
}

/**
 * GUI 実行ファイル起動用 VBS スクリプトのパス
 * @returns {string} VBS パス
 */
function getLaunchExeScriptPath(): string {
	// パッケージ済みなら resources、開発時はアプリ直下
	if (app.isPackaged) {
		return path.join(process.resourcesPath, 'launch-exe.vbs');
	}

	return path.join(app.getAppPath(), 'resources', 'launch-exe.vbs');
}

/**
 * Outlook classic guard 用 PowerShell スクリプトのパス
 * @returns {string} PowerShell パス
 */
function getOutlookClassicGuardScriptPath(): string {
	// パッケージ済みなら resources、開発時はアプリ直下
	if (app.isPackaged) {
		return path.join(process.resourcesPath, 'outlook-classic-guard.ps1');
	}

	return path.join(app.getAppPath(), 'resources', 'outlook-classic-guard.ps1');
}

/**
 * 起動後のランチャー挙動を適用する
 * @param {BrowserWindow} win メインウィンドウ
 * @param {'stay' | 'minimize' | 'close'} behavior 挙動
 */
function applyLaunchBehavior(win: BrowserWindow, behavior: 'stay' | 'minimize' | 'close'): void {
	// 起動後にランチャーを最小化する
	if (behavior === 'minimize') {
		win.minimize();
		return;
	}

	// 起動後にランチャーを閉じる
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
function spawnDetached(command: string, argList: string[], cwd?: string, windowsHide = false, verbatim = false): Promise<void> {
	return new Promise((resolve, reject) => {
		// 親終了の影響を受けない子プロセス
		const child = spawn(command, argList, {
			// 作業ディレクトリ。空なら親のカレントを使う
			cwd: cwd || undefined,
			// 親の終了で子を巻き込まない
			detached: true,
			// 標準入出力を親に繋がない
			stdio: 'ignore',
			// true のとき子ウィンドウを出さない
			windowsHide,
			// true のとき引数を Node が再クォートしない
			windowsVerbatimArguments: verbatim
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
function spawnAndWait(command: string, argList: string[], cwd?: string, windowsHide = false): Promise<void> {
	return new Promise((resolve, reject) => {
		// 標準出力の断片。終了時に結合する
		const stdoutChunks: string[] = [];
		// 標準エラーの断片。終了時に結合する
		const stderrChunks: string[] = [];
		// 終了コードを待つ子プロセス
		const child                  = spawn(command, argList, {
			// 作業ディレクトリ。空なら親のカレントを使う
			cwd: cwd || undefined,
			// 入力は捨て、出力だけ受け取る
			stdio: ['ignore', 'pipe', 'pipe'],
			// true のとき子ウィンドウを出さない
			windowsHide
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
			// 標準出力。前後空白は除く。無ければ空
			const stdoutText = stdoutChunks.join('').trim();
			// 標準エラー。前後空白は除く。無ければ空
			const stderrText = stderrChunks.join('').trim();
			// 失敗メッセージに載せる本文。標準エラーが空なら標準出力
			const detail     = stderrText || stdoutText;

			// 終了コード 0 は成功
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`${command} exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}`));
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
	// 空の引数は空のクォートにする
	if (!value) {
		return '""';
	}

	return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

/**
 * 管理者権限で Start-Process するための PowerShell を起動する
 * @param {string} filePath 起動対象
 * @param {string} argumentLine 引数文字列
 * @param {string} workingDir 作業ディレクトリ
 * @returns {Promise<void>}
 */
async function startProcessElevated(filePath: string, argumentLine: string, workingDir: string): Promise<void> {
	// Start-Process へ渡す JSON を UTF-8 Base64 にしたもの
	const payload = Buffer.from(
		JSON.stringify({
			// 昇格して起動する実行ファイル
			filePath: filePath,
			// 引数文字列。空なら引数なし
			argumentLine: argumentLine,
			// 作業ディレクトリ。空なら指定しない
			workingDir: workingDir
		}),
		'utf8'
	).toString('base64');
	// EncodedCommand に載せる PowerShell。payload を展開して RunAs する
	const script  = `
# 失敗したら止める。警告で続行しない
$ErrorActionPreference = 'Stop'
# コンソール出力を BOM なし UTF-8 にする
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# パイプライン出力のエンコード。コンソール出力と揃える
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# Base64 から戻した起動パラメータ。filePath、argumentLine、workingDir を持つ
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
# Start-Process の引数。FilePath と Verb は必須
$params = @{
	# 昇格して起動する実行ファイル
	FilePath = [string]$payload.filePath
	# 管理者として起動する
	Verb = 'RunAs'
}
# 引数文字列。空白だけなら引数を付けない
$argumentLine = [string]$payload.argumentLine
# 引数があるときだけ ArgumentList を付ける。空なら付けない
if (-not [string]::IsNullOrWhiteSpace($argumentLine)) {
	$params.ArgumentList = $argumentLine
}
# 作業ディレクトリ。空白だけなら付けない
$workingDir = [string]$payload.workingDir
# 作業ディレクトリがあるときだけ付ける。空なら付けない
if (-not [string]::IsNullOrWhiteSpace($workingDir)) {
	$params.WorkingDirectory = $workingDir
}
Start-Process @params
`;

	await spawnAndWait('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellCommand(script)], undefined, true);
}

/**
 * Windows のコマンドライン引数文字列を引数配列へ分割する
 * ダブルクォートで囲まれた区間は 1 引数として扱い、囲みクォートは除去する
 * 例: '/c "C:\\my path\\x.bat"' -> ['/c', 'C:\\my path\\x.bat']
 * @param {string} argString 引数文字列
 * @returns {string[]} 引数配列
 */
function parseWindowsArgs(argString: string): string[] {
	// 分割結果。空入力のときは空配列のまま返す
	const result: string[] = [];
	// 前後空白を除いた入力。空なら引数なし
	const trimmed          = argString.trim();

	// 引数文字列が空である
	if (!trimmed) {
		return result;
	}

	// 組み立て中の 1 引数。クォート中は空白も含む
	let current    = '';
	// ダブルクォートの内側なら true。初期は外側
	let inQuotes   = false;
	// 空クォートも含め、出力すべき内容があるか。未着手は false
	let hasContent = false;

	for (const ch of trimmed) {
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
 * ターゲットがコンソール（黒い画面）を伴うインタプリタ／スクリプトか判定する
 * @param {string} targetPath 実行パス
 * @returns {boolean} コンソール系なら true
 */
function isConsoleScriptTarget(targetPath: string): boolean {
	// 比較用のファイル名。小文字
	const base = path.basename(targetPath).toLowerCase();

	// コンソールを出すインタプリタ本体である
	if (CONSOLE_INTERPRETERS.has(base)) {
		return true;
	}

	return SCRIPT_EXTENSIONS.has(path.extname(targetPath).toLowerCase());
}

/**
 * ShellExecute ヘルパーではなく direct 起動を使う GUI 実行ファイルか判定する
 * @param {string} targetPath 実行パス
 * @returns {boolean} direct 起動対象なら true
 */
function shouldLaunchGuiDirectly(targetPath: string): boolean {
	return DIRECT_GUI_EXECUTABLES.has(path.basename(targetPath).toLowerCase());
}

/**
 * Outlook classic の残留プロセス終了確認を表示する
 * @param {BrowserWindow} win メインウィンドウ
 * @param {OutlookClassicGuardResult} guardResult guard 結果
 * @returns {Promise<boolean>} 再起動を続行するなら true
 */
async function confirmTerminateOutlookClassic(win: BrowserWindow, guardResult: OutlookClassicGuardResult): Promise<boolean> {
	// 表示用の PID 列。プロセスが無ければ空
	const processIds = guardResult.processIds.join(', ');
	// ダイアログの選択。0 が再起動、1 がキャンセル
	const result     = await dialog.showMessageBox(win, {
		// 警告アイコン
		type: 'warning',
		// 左が再起動、右がキャンセル
		buttons: ['終了して再起動', 'キャンセル'],
		// Enter の初期位置はキャンセル
		defaultId: 1,
		// Esc もキャンセル
		cancelId: 1,
		// ボタンをリンク表示にしない
		noLink: true,
		// ダイアログタイトル
		title: 'Outlook の残留プロセス',
		// 本文
		message: 'Outlook のプロセスは残っていますが、表示中のウィンドウが見つかりません。',
		// 注意と、PID があるときだけ付ける行
		detail: ['未保存のメールや同期処理がある場合はキャンセルしてください。', `残留プロセスを終了して Outlook を再起動しますか？${processIds ? `\nPID: ${processIds}` : ''}`].join('\n')
	});

	return result.response === 0;
}

/**
 * Outlook classic の可視ウィンドウを前面化する
 * @param {string} scriptPath guard スクリプト
 * @param {string} sourcePath ランチャー登録パス
 * @param {string} targetPath 起動対象パス
 * @returns {Promise<OutlookClassicPrelaunchResult>} 起動前処理結果
 */
async function activateOutlookClassicWindow(scriptPath: string, sourcePath: string, targetPath: string): Promise<OutlookClassicPrelaunchResult> {
	// 前面化の成否。ウィンドウが消えていれば windows は空
	const guardResult = await runOutlookClassicGuard(scriptPath, 'activate');

	// 前面化するウィンドウが残っていない
	if (guardResult.windows.length === 0) {
		logger.warn('Outlook classic window disappeared before activation', {
			// ランチャーに登録されたパス
			path: sourcePath,
			// 解決した起動対象
			target: targetPath,
			// 検査時点の PID。無ければ空
			processIds: guardResult.processIds
		});
		return { action: 'continue' };
	}

	logger.info('Outlook classic window activation requested', {
		// ランチャーに登録されたパス
		path: sourcePath,
		// 解決した起動対象
		target: targetPath,
		// 前面化できた件数
		activated: guardResult.activated,
		// 前面化したウィンドウ。無ければ未設定
		window: guardResult.activatedWindow
	});

	return { action: 'activated', guardResult };
}

/**
 * Outlook classic の残留プロセスを終了する
 * @param {string} scriptPath guard スクリプト
 * @param {string} sourcePath ランチャー登録パス
 * @param {string} targetPath 起動対象パス
 * @returns {Promise<OutlookClassicPrelaunchResult>} 起動前処理結果
 */
async function terminateOutlookClassicResidualProcess(scriptPath: string, sourcePath: string, targetPath: string): Promise<OutlookClassicPrelaunchResult> {
	// 終了処理の結果。途中でウィンドウが出たら前面化へ切り替える
	const guardResult = await runOutlookClassicGuard(scriptPath, 'terminate');

	// 終了前に可視ウィンドウが現れた
	if (guardResult.windows.length > 0) {
		logger.info('Outlook classic window appeared before termination', {
			// ランチャーに登録されたパス
			path: sourcePath,
			// 解決した起動対象
			target: targetPath,
			// 残っている PID
			processIds: guardResult.processIds
		});
		return activateOutlookClassicWindow(scriptPath, sourcePath, targetPath);
	}

	// 終了エラーがある、またはプロセスが残っている。どちらかで失敗とする
	if (guardResult.errors.length > 0 || guardResult.remainingProcessIds.length > 0) {
		throw new Error(['Outlook の残留プロセスを終了できませんでした。', guardResult.remainingProcessIds.length > 0 ? `残存 PID: ${guardResult.remainingProcessIds.join(', ')}` : '', guardResult.errors.join('\n')].filter(Boolean).join('\n'));
	}

	logger.info('Outlook classic residual process terminated', {
		// ランチャーに登録されたパス
		path: sourcePath,
		// 解決した起動対象
		target: targetPath,
		// 終了できた PID
		terminatedProcessIds: guardResult.terminatedProcessIds
	});

	return { action: 'continue' };
}

/**
 * Outlook classic 起動前に、既存ウィンドウ前面化または残留プロセス確認を行う
 * @param {BrowserWindow} win メインウィンドウ
 * @param {string} sourcePath ランチャー登録パス
 * @param {string} targetPath 起動対象パス
 * @returns {Promise<OutlookClassicPrelaunchResult>} 起動前処理結果
 */
async function handleOutlookClassicBeforeLaunch(win: BrowserWindow, sourcePath: string, targetPath: string): Promise<OutlookClassicPrelaunchResult> {
	// ----------------------------------------------
	// Outlook classic 以外は起動を続ける
	// ----------------------------------------------
	// Windows 以外、または Outlook classic の実行ファイルでない
	if (process.platform !== 'win32' || !isOutlookClassicExecutable(targetPath)) {
		return { action: 'continue' };
	}

	// guard スクリプトの絶対パス
	const scriptPath = getOutlookClassicGuardScriptPath();

	// スクリプトが配置されていない
	if (!pathExists(scriptPath)) {
		logger.warn('Outlook classic guard script not found', {
			// ランチャーに登録されたパス
			path: sourcePath,
			// 解決した起動対象
			target: targetPath,
			// 見つからなかったスクリプト
			scriptPath
		});
		return { action: 'continue' };
	}

	// 検査結果。失敗時は起動を続ける
	let guardResult: OutlookClassicGuardResult;

	try {
		guardResult = await runOutlookClassicGuard(scriptPath, 'inspect');
	} catch (error) {
		// ログへ出す失敗理由。Error 以外は文字列化する
		const message = error instanceof Error ? error.message : String(error);

		logger.warn('Outlook classic guard failed', {
			// ランチャーに登録されたパス
			path: sourcePath,
			// 解決した起動対象
			target: targetPath,
			// 検査失敗の理由
			error: message
		});
		return { action: 'continue' };
	}

	// ----------------------------------------------
	// 前面化するか、残留プロセスを確認する
	// ----------------------------------------------
	// 検査結果から選ぶ次の動作
	const action = getOutlookClassicLaunchAction(guardResult);

	// 既存ウィンドウを前面化する
	if (action === 'activate') {
		return activateOutlookClassicWindow(scriptPath, sourcePath, targetPath);
	}

	// 残留プロセスの終了確認が必要である
	if (action === 'confirm-restart') {
		// ユーザーが終了して再起動を選んだか。キャンセルは false
		const confirmed = await confirmTerminateOutlookClassic(win, guardResult);

		// ユーザーがキャンセルした
		if (!confirmed) {
			logger.info('Outlook classic residual restart cancelled', {
				// ランチャーに登録されたパス
				path: sourcePath,
				// 解決した起動対象
				target: targetPath,
				// 残していた PID
				processIds: guardResult.processIds
			});
			return { action: 'cancelled', guardResult };
		}

		return terminateOutlookClassicResidualProcess(scriptPath, sourcePath, targetPath);
	}

	return { action: 'continue' };
}

/**
 * start コマンドのタイトルに使える安全な文字列へ整形する
 * （ダブルクォート・パーセント・改行は cmd の解釈を壊すため除去）
 * @param {string} name アプリ名
 * @returns {string} 整形後タイトル
 */
function sanitizeConsoleTitle(name: string): string {
	// クォート、パーセント、改行を空白にしたタイトル。空なら App
	const cleaned = (name || '').replace(/["%\r\n]/g, ' ').trim();

	return cleaned || 'App';
}

/**
 * start に渡す「インタプリタ＋引数」部分のコマンドライン文字列を組み立てる
 * スクリプト直接指定（.bat/.ps1 等）はダブルクリック相当の起動コマンドへ展開する
 * @param {string} targetPath 実行パス
 * @param {string} args 引数（.lnk 由来の場合は既にクォート済み）
 * @returns {string} コマンドライン文字列
 */
function buildConsoleInvocation(targetPath: string, args: string): string {
	// 起動対象の拡張子。小文字
	const ext       = path.extname(targetPath).toLowerCase();
	// 引数があるときだけ先頭に空白を付けた続き。無ければ空
	const argSuffix = args ? ` ${args}` : '';

	// バッチである
	if (ext === '.bat' || ext === '.cmd') {
		return `cmd.exe /c "${targetPath}"${argSuffix}`;
	}

	// PowerShell スクリプトである
	if (ext === '.ps1') {
		return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${targetPath}"${argSuffix}`;
	}

	// スクリプトホストで開く拡張子である
	if (ext === '.vbs' || ext === '.js') {
		return `wscript.exe "${targetPath}"${argSuffix}`;
	}

	// 既にインタプリタ（cmd.exe 等）の場合はそのまま実行する
	return `"${targetPath}"${argSuffix}`;
}

/**
 * Start-Process -Verb RunAs に渡す実行ファイルと引数文字列を組み立てる
 * @param {string} targetPath 実行パス
 * @param {string} args 引数
 * @returns {{ filePath: string; argumentLine: string }} 起動情報
 */
function buildElevatedInvocation(targetPath: string, args: string): { filePath: string; argumentLine: string } {
	// 起動対象の拡張子。小文字
	const ext       = path.extname(targetPath).toLowerCase();
	// 引数があるときだけ先頭に空白を付けた続き。無ければ空
	const argSuffix = args ? ` ${args}` : '';

	// バッチは cmd 経由で昇格する
	if (ext === '.bat' || ext === '.cmd') {
		return {
			// 昇格する実行ファイル
			filePath: 'cmd.exe',
			// /d /c のうしろに付けるバッチと引数
			argumentLine: `/d /c ${quoteWindowsArgument(targetPath)}${argSuffix}`
		};
	}

	// PowerShell スクリプトは powershell 経由で昇格する
	if (ext === '.ps1') {
		return {
			// 昇格する実行ファイル
			filePath: 'powershell.exe',
			// プロファイルなしでスクリプトを開く引数
			argumentLine: ['-NoProfile', '-ExecutionPolicy Bypass', `-File ${quoteWindowsArgument(targetPath)}${argSuffix}`].join(' ')
		};
	}

	// スクリプトホストで開く拡張子である
	if (ext === '.vbs' || ext === '.js') {
		return {
			// 昇格する実行ファイル
			filePath: 'wscript.exe',
			// スクリプトパスと引数
			argumentLine: `${quoteWindowsArgument(targetPath)}${argSuffix}`
		};
	}

	return {
		// 昇格する実行ファイル。スクリプト以外はそのまま
		filePath: targetPath,
		// 呼び出し元の引数。空なら引数なし
		argumentLine: args
	};
}

/**
 * コンソール系ターゲットを、ウィンドウタイトルにアプリ名を設定して起動する
 * `cmd /c start "<タイトル>" ...` を使うと、bat 内部の入れ子 cmd/pwsh 呼び出しに
 * 上書きされずタイトルが保持される（エクスプローラ起動時のような識別性を担保）
 * @param {string} title ウィンドウタイトル（アプリ名）
 * @param {string} targetPath 実行パス
 * @param {string} args 引数
 * @param {string} cwd 作業ディレクトリ
 * @returns {Promise<void>}
 */
async function launchConsoleWithTitle(title: string, targetPath: string, args: string, cwd: string): Promise<void> {
	// cmd のタイトルに使える文字列。空なら App
	const safeTitle   = sanitizeConsoleTitle(title);
	// 作業ディレクトリがあるときだけ付ける /d。無ければ空
	const dirPart     = cwd ? ` /d "${cwd.replace(/\\+$/, '')}"` : '';
	// start のうしろに続けるインタプリタと引数
	const invocation  = buildConsoleInvocation(targetPath, args);
	// 外側 cmd に渡す 1 引数。start まで含めたコマンドライン
	const commandLine = `/d /c start "${safeTitle}"${dirPart} ${invocation}`;

	// 外側 cmd は start を呼んで即終了するだけなので非表示にする
	// start は新規コンソール（CREATE_NEW_CONSOLE）を生成するため、子ウィンドウは表示される
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
async function launchResolvedTargetAsAdmin(targetPath: string, args: string, workingDir: string, title?: string): Promise<void> {
	// Windows 以外では管理者起動を使えない
	if (process.platform !== 'win32') {
		throw new Error('管理者として実行は Windows でのみ利用できます。');
	}

	// 作業ディレクトリ。未指定なら実行ファイルのフォルダ
	const cwd = workingDir || path.dirname(targetPath);

	// タイトルがあり、かつコンソール系の起動である
	if (title && isConsoleScriptTarget(targetPath)) {
		// cmd のタイトルに使える文字列。空なら App
		const safeTitle   = sanitizeConsoleTitle(title);
		// 作業ディレクトリがあるときだけ付ける /d。無ければ空
		const dirPart     = cwd ? ` /d "${cwd.replace(/\\+$/, '')}"` : '';
		// start のうしろに続けるインタプリタと引数
		const invocation  = buildConsoleInvocation(targetPath, args);
		// 外側 cmd に渡す 1 引数。start まで含めたコマンドライン
		const commandLine = `/d /c start "${safeTitle}"${dirPart} ${invocation}`;

		await startProcessElevated('cmd.exe', commandLine, cwd);
		return;
	}

	// 拡張子に応じた昇格コマンド。スクリプト以外は対象そのもの
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
 * @returns {Promise<'runas' | 'direct' | 'shellexecute'>} 実際の起動方式
 */
async function launchResolvedTarget(targetPath: string, args: string, workingDir: string, title?: string, runAsAdmin = false): Promise<'runas' | 'direct' | 'shellexecute'> {
	// ----------------------------------------------
	// 管理者起動とコンソール起動
	// ----------------------------------------------
	// 作業ディレクトリ。未指定なら実行ファイルのフォルダ
	const cwd = workingDir || path.dirname(targetPath);

	// 管理者権限での起動である
	if (runAsAdmin) {
		await launchResolvedTargetAsAdmin(targetPath, args, workingDir, title);
		return 'runas';
	}

	// コンソール（黒い画面）を伴う起動は、識別しやすいようアプリ名をタイトルに表示する
	if (title && isConsoleScriptTarget(targetPath)) {
		await launchConsoleWithTitle(title, targetPath, args, cwd);
		return 'direct';
	}

	// ----------------------------------------------
	// 拡張子ごとの直接起動
	// ----------------------------------------------
	// 空白区切りの引数。空文字なら空配列
	const argList = parseWindowsArgs(args);
	// 起動対象の拡張子。小文字
	const ext     = path.extname(targetPath).toLowerCase();

	// バッチである
	if (ext === '.bat' || ext === '.cmd') {
		await spawnDetached('cmd.exe', ['/d', '/c', targetPath, ...argList], cwd);
		return 'direct';
	}

	// PowerShell スクリプトである
	if (ext === '.ps1') {
		await spawnDetached('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', targetPath, ...argList], cwd);
		return 'direct';
	}

	// Edge など、ShellExecute を使わない GUI である
	if (shouldLaunchGuiDirectly(targetPath)) {
		await spawnDetached(targetPath, argList, cwd);
		return 'direct';
	}

	// GUI の .exe 等は ShellExecute で起動する（CreateProcess 直起動だと
	// 未保存確認などのモーダルが前面に出ない／閉じられない症状が出ることがある）
	await launchExecutableViaShell(targetPath, args, cwd);
	return 'shellexecute';
}

/**
 * .lnk を ShellExecute 経由で別プロセス起動する（ダブルクリック相当）
 *
 * explorer.exe / cmd start 経由だと .lnk 内の AUMI や作業フォルダが
 * 正しく反映されず、タスクバーアイコンが崩れることがある
 * @param {string} lnkPath ショートカットパス
 * @returns {Promise<void>}
 */
async function launchShortcut(lnkPath: string): Promise<void> {
	// Windows では VBS から ShellExecute する
	if (process.platform === 'win32') {
		// launch-shortcut.vbs の絶対パス
		const scriptPath = getLaunchShortcutScriptPath();

		// 起動スクリプトが配置されていない
		if (!pathExists(scriptPath)) {
			throw new Error(`Shortcut launcher script not found: ${scriptPath}`);
		}

		await spawnDetached('wscript.exe', ['//B', '//Nologo', scriptPath, lnkPath], undefined, true);
		return;
	}

	// shell.openPath の失敗理由。空なら成功
	const openResult = await shell.openPath(lnkPath);

	// 失敗理由が返っている
	if (openResult) {
		throw new Error(openResult);
	}
}

/**
 * GUI 実行ファイルを ShellExecute 経由で別プロセス起動する（エクスプローラー相当）
 *
 * Node の spawn（CreateProcess）直起動だと、子アプリの未保存確認などの
 * モーダルダイアログが前面に出ず、閉じられないように見えることがある
 * @param {string} targetPath 実行パス
 * @param {string} args 引数文字列
 * @param {string} cwd 作業ディレクトリ
 * @returns {Promise<void>}
 */
async function launchExecutableViaShell(targetPath: string, args: string, cwd: string): Promise<void> {
	// Windows 以外はプロセスを直接起動する
	if (process.platform !== 'win32') {
		await spawnDetached(targetPath, parseWindowsArgs(args), cwd);
		return;
	}

	// launch-exe.vbs の絶対パス
	const scriptPath = getLaunchExeScriptPath();

	// 起動スクリプトが配置されていない
	if (!pathExists(scriptPath)) {
		throw new Error(`Executable launcher script not found: ${scriptPath}`);
	}

	await spawnAndWait('wscript.exe', ['//B', '//Nologo', scriptPath, targetPath, args || '', cwd || ''], undefined, true);
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
export async function launchApp(win: BrowserWindow, appPath: string, args: string, workingDir: string, launchBehavior: 'stay' | 'minimize' | 'close', appName = '', runAsAdmin = false): Promise<LaunchResult> {
	// ----------------------------------------------
	// パスを検証する
	// ----------------------------------------------
	// クォートと環境変数を展開した実行パス。空なら未指定
	const normalizedPath = normalizeExecutablePath(appPath);

	// exe / lnk 以外である
	if (!isValidExecutablePath(normalizedPath)) {
		return {
			// 呼び出し側は失敗として扱う
			success: false,
			// 拡張子が対象外である理由
			error: `Unsupported file type: ${appPath}`
		};
	}

	// 展開後のパスがディスク上に無い
	if (!pathExists(normalizedPath)) {
		return {
			// 呼び出し側は失敗として扱う
			success: false,
			// 見つからなかったパス
			error: `Path not found: ${normalizedPath}`
		};
	}

	try {
		// ----------------------------------------------
		// ショートカットと直接起動を分ける
		// ----------------------------------------------
		// 起動対象の拡張子。小文字
		const ext                  = path.extname(normalizedPath).toLowerCase();
		// 処理開始時刻。ミリ秒
		const startedAt            = Date.now();
		// ショートカット読込にかかった時間。未読込は 0
		let readMs                 = 0;
		// 実際に起動したパス。未解決時は登録パスのまま
		let targetPath             = normalizedPath;
		// 記録する起動方式。管理者指定が無い初期値は direct
		let launchedVia: LaunchVia = 'direct';

		// 管理者起動が指定されている
		if (runAsAdmin) {
			launchedVia = 'runas';
		}

		// ショートカットである
		if (ext === '.lnk') {
			// .lnk のターゲットを読み取り、ターゲットを直接起動する
			// .lnk 自体を ShellExecute するとシェルのリンク解決（分散リンク追跡）が走り、
			// 環境によっては初回に数十秒ハング＆システム全体が固まる。直接起動でこれを回避する
			const readStart = Date.now();
			// 読んだショートカット。ターゲットが無いときは null 相当
			const shortcut  = await readShortcut(normalizedPath);

			readMs = Date.now() - readStart;

			// 起動先のターゲットを解決できた
			if (shortcut?.target) {
				targetPath = shortcut.target;

				// Outlook classic の前面化または残留確認の結果
				const prelaunchResult = await handleOutlookClassicBeforeLaunch(win, normalizedPath, shortcut.target);

				// ユーザーが残留プロセスの終了をキャンセルした
				if (prelaunchResult.action === 'cancelled') {
					return { success: true };
				}

				// 既存ウィンドウを前面化した
				if (prelaunchResult.action === 'activated') {
					launchedVia = 'foreground';
				} else {
					launchedVia = await launchResolvedTarget(shortcut.target, args || shortcut.args, workingDir || shortcut.cwd, appName, runAsAdmin);
				}
			} else {
				// ターゲットを解決できない（UWP/PIDL 形式等）場合のみ ShellExecute にフォールバックする
				if (runAsAdmin) {
					launchedVia = 'shortcut-runas';
					await launchResolvedTarget(normalizedPath, args, workingDir, appName, true);
				} else {
					launchedVia = 'shellexecute';
					await launchShortcut(normalizedPath);
				}
			}
		} else {
			// Outlook classic の前面化または残留確認の結果
			const prelaunchResult = await handleOutlookClassicBeforeLaunch(win, normalizedPath, normalizedPath);

			// ユーザーが残留プロセスの終了をキャンセルした
			if (prelaunchResult.action === 'cancelled') {
				return { success: true };
			}

			// 既存ウィンドウを前面化した
			if (prelaunchResult.action === 'activated') {
				launchedVia = 'foreground';
			} else {
				launchedVia = await launchResolvedTarget(normalizedPath, args, workingDir, appName, runAsAdmin);
			}
		}

		// ----------------------------------------------
		// 起動後の挙動と結果
		// ----------------------------------------------
		applyLaunchBehavior(win, launchBehavior);

		logger.info('App launched', {
			// ランチャーに登録されたパス
			path: normalizedPath,
			// 実際に起動したパス
			target: targetPath,
			// 使った起動方式
			via: launchedVia,
			// 管理者起動を指定したか
			runAsAdmin,
			// ショートカット読込の所要時間。単位はミリ秒。未読込は 0
			readMs,
			// 検証から起動完了までの所要時間。単位はミリ秒
			totalMs: Date.now() - startedAt
		});
		return { success: true };
	} catch (error) {
		// ログと戻り値に載せる失敗理由。Error 以外は文字列化する
		const message = error instanceof Error ? error.message : String(error);

		logger.error('App launch failed', { path: appPath, error: message });

		return {
			// 呼び出し側は失敗として扱う
			success: false,
			// 起動処理が投げた理由
			error: message
		};
	}
}
