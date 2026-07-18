import { execFile } from 'node:child_process';
import path from 'node:path';

/** 管理者権限チェックコマンド */
const ADMIN_CHECK_COMMAND = [
	'$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
	'$principal = [Security.Principal.WindowsPrincipal]::new($identity)',
	'$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
].join('; ');

/** 管理者権限チェック結果キャッシュ */
let administratorPromise: Promise<boolean> | null = null;

/**
 * Windows PowerShell のパスを解決する
 * @returns {string} powershell.exe パス
 */
function resolveWindowsPowerShellPath(): string {
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
	if (process.platform !== 'win32') {
		return Promise.resolve(false);
	}

	if (!administratorPromise) {
		administratorPromise = new Promise((resolve) => {
			execFile(
				resolveWindowsPowerShellPath(),
				[
					'-NoProfile',
					'-NonInteractive',
					'-ExecutionPolicy',
					'Bypass',
					'-Command',
					ADMIN_CHECK_COMMAND,
				],
				{
					timeout    : 5000,
					windowsHide: true,
				},
				(error, stdout) => {
					if (error) {
						resolve(false);
						return;
					}

					resolve(parsePowerShellBoolean(stdout));
				},
			);
		});
	}

	return administratorPromise;
}
