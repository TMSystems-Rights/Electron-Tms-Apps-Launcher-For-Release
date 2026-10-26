/**
 * 現在のプロセスが管理者かを PowerShell で一度だけ調べ、結果をキャッシュする
 * 権限の昇格はせず、判定結果だけを返す
 * @file
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

/** 管理者権限チェックコマンド */
const ADMIN_CHECK_COMMAND = ['$identity = [Security.Principal.WindowsIdentity]::GetCurrent()', '$principal = [Security.Principal.WindowsPrincipal]::new($identity)', '$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'].join('; ');

/** 管理者権限チェック結果キャッシュ */
let administratorPromise: Promise<boolean> | null = null;

/**
 * Windows PowerShell のパスを解決する
 * @returns {string} powershell.exe パス
 */
function resolveWindowsPowerShellPath(): string {
	// SystemRoot が未設定のときは C:\Windows。単位はディレクトリパス
	const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';

	return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * PowerShell の boolean 出力を bool に変換する
 * @param {string} stdout 標準出力
 * @returns {boolean} true 出力なら true
 */
function parsePowerShellBoolean(stdout: string): boolean {
	return stdout.trim().toLowerCase() === 'true';
}

/**
 * 現在のプロセスが管理者権限で実行されているかを判定する
 * @returns {Promise<boolean>} 管理者権限なら true
 */
export function isAdministrator(): Promise<boolean> {
	// ----------------------------------------------
	// win32 以外は管理者になれない。判定コマンドは起動しない
	// ----------------------------------------------
	if (process.platform !== 'win32') {
		return Promise.resolve(false);
	}

	// ----------------------------------------------
	// 未取得のときだけ PowerShell を実行し、同じ Promise を使い回す
	// ----------------------------------------------
	if (!administratorPromise) {
		administratorPromise = new Promise((resolve) => {
			execFile(
				resolveWindowsPowerShellPath(),
				['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ADMIN_CHECK_COMMAND],
				{
					// 応答待ちの上限。単位は ms。超過は error になり非管理者
					timeout: 5000,
					// コンソールウィンドウを出さない
					windowsHide: true
				},
				(error, stdout) => {
					// 起動失敗かタイムアウト。stdout は見ずに非管理者として確定する
					if (error) {
						resolve(false);
						return;
					}

					resolve(parsePowerShellBoolean(stdout));
				}
			);
		});
	}

	return administratorPromise;
}
