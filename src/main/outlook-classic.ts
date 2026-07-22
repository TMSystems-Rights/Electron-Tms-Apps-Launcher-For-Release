import { spawn } from 'node:child_process';
import path from 'node:path';

/** Outlook classic guard の操作 */
export type OutlookClassicGuardAction = 'inspect' | 'activate' | 'terminate';

/** Outlook classic 起動前に取る操作 */
export type OutlookClassicLaunchAction = 'launch' | 'activate' | 'confirm-restart';

/** Outlook classic の可視ウィンドウ */
export interface OutlookClassicWindowInfo {
	pid: number;
	hWnd: string;
	windowTitle: string;
}

/** Outlook classic guard の実行結果 */
export interface OutlookClassicGuardResult {
	action: OutlookClassicGuardAction;
	processIds: number[];
	windows: OutlookClassicWindowInfo[];
	activated: boolean;
	activatedWindow: OutlookClassicWindowInfo | null;
	terminatedProcessIds: number[];
	remainingProcessIds: number[];
	errors: string[];
}

/** 空の Outlook classic guard 結果 */
const EMPTY_RESULT: OutlookClassicGuardResult = {
	action              : 'inspect',
	processIds          : [],
	windows             : [],
	activated           : false,
	activatedWindow     : null,
	terminatedProcessIds: [],
	remainingProcessIds : [],
	errors              : [],
};

/** PowerShell helper のタイムアウト */
const GUARD_TIMEOUT_MS = 15000;

/**
 * 値を配列として扱う
 * @param {unknown} value 値
 * @returns {unknown[]} 配列
 */
function asArray(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}

	if (value === null || value === undefined) {
		return [];
	}

	return [value];
}

/**
 * 数値配列に正規化する
 * @param {unknown} value 値
 * @returns {number[]} 数値配列
 */
function normalizeNumberArray(value: unknown): number[] {
	return asArray(value)
		.map((item) => Number(item))
		.filter((item) => Number.isInteger(item) && item > 0);
}

/**
 * 文字列配列に正規化する
 * @param {unknown} value 値
 * @returns {string[]} 文字列配列
 */
function normalizeStringArray(value: unknown): string[] {
	return asArray(value)
		.map((item) => String(item ?? '').trim())
		.filter(Boolean);
}

/**
 * Outlook classic ウィンドウ情報に正規化する
 * @param {unknown} value 値
 * @returns {OutlookClassicWindowInfo | null} ウィンドウ情報
 */
function normalizeWindowInfo(value: unknown): OutlookClassicWindowInfo | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Partial<OutlookClassicWindowInfo>;
	const pid       = Number(candidate.pid);
	const hWnd      = String(candidate.hWnd ?? '').trim();

	if (!Number.isInteger(pid) || pid <= 0 || !hWnd) {
		return null;
	}

	return {
		pid,
		hWnd,
		windowTitle: String(candidate.windowTitle ?? ''),
	};
}

/**
 * Outlook classic guard 結果に正規化する
 * @param {OutlookClassicGuardAction} action 実行アクション
 * @param {unknown} value 値
 * @returns {OutlookClassicGuardResult} guard 結果
 */
function normalizeGuardResult(
	action: OutlookClassicGuardAction,
	value: unknown,
): OutlookClassicGuardResult {
	if (!value || typeof value !== 'object') {
		return { ...EMPTY_RESULT, action };
	}

	const raw             = value as Record<string, unknown>;
	const windows         = asArray(raw.windows).map(normalizeWindowInfo).filter((item) => item !== null);
	const activatedWindow = normalizeWindowInfo(raw.activatedWindow);

	return {
		action,
		processIds          : normalizeNumberArray(raw.processIds),
		windows,
		activated           : raw.activated === true,
		activatedWindow,
		terminatedProcessIds: normalizeNumberArray(raw.terminatedProcessIds),
		remainingProcessIds : normalizeNumberArray(raw.remainingProcessIds),
		errors              : normalizeStringArray(raw.errors),
	};
}

/**
 * Outlook classic の実行ファイルか判定する
 * @param {string} targetPath 起動対象パス
 * @returns {boolean} Outlook classic なら true
 */
export function isOutlookClassicExecutable(targetPath: string): boolean {
	return path.win32.basename(String(targetPath ?? '')).toLowerCase() === 'outlook.exe';
}

/**
 * Outlook classic 起動前に取る操作を判定する
 * @param {Pick<OutlookClassicGuardResult, 'processIds' | 'windows'>} snapshot 状態
 * @returns {OutlookClassicLaunchAction} 操作
 */
export function getOutlookClassicLaunchAction(
	snapshot: Pick<OutlookClassicGuardResult, 'processIds' | 'windows'>,
): OutlookClassicLaunchAction {
	if (snapshot.windows.length > 0) {
		return 'activate';
	}

	if (snapshot.processIds.length > 0) {
		return 'confirm-restart';
	}

	return 'launch';
}

/**
 * Outlook classic guard helper を実行する
 * @param {string} scriptPath PowerShell helper パス
 * @param {OutlookClassicGuardAction} action 操作
 * @returns {Promise<OutlookClassicGuardResult>} guard 結果
 */
export function runOutlookClassicGuard(
	scriptPath: string,
	action: OutlookClassicGuardAction,
): Promise<OutlookClassicGuardResult> {
	return new Promise((resolve, reject) => {
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		let   settled                = false;
		const child                  = spawn(
			'powershell.exe',
			[
				'-NoProfile',
				'-ExecutionPolicy',
				'Bypass',
				'-File',
				scriptPath,
				'-Action',
				action,
			],
			{
				stdio      : ['ignore', 'pipe', 'pipe'],
				windowsHide: true,
			},
		);
		const timeout                = setTimeout(() => {
			if (settled) {
				return;
			}

			settled = true;
			child.kill();
			reject(new Error(`Outlook classic guard timed out after ${GUARD_TIMEOUT_MS}ms`));
		}, GUARD_TIMEOUT_MS);

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', (chunk: string) => {
			stdoutChunks.push(chunk);
		});

		child.stderr.on('data', (chunk: string) => {
			stderrChunks.push(chunk);
		});

		child.once('error', (error) => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeout);
			reject(error);
		});

		child.once('close', (code) => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeout);

			const stdoutText = stdoutChunks.join('').trim();
			const stderrText = stderrChunks.join('').trim();

			if (code !== 0) {
				reject(new Error(
					`Outlook classic guard exited with code ${code ?? 'unknown'}${stderrText ? `: ${stderrText}` : ''}`,
				));
				return;
			}

			try {
				resolve(normalizeGuardResult(action, stdoutText ? JSON.parse(stdoutText) : null));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);

				reject(new Error(`Failed to parse Outlook classic guard output: ${message}`));
			}
		});
	});
}
