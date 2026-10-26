/**
 * Outlook クラシックの検査、前面化、終了を PowerShell ガードへ委譲する
 * 起動してよいかの判断だけを返し、通常アプリの起動手順は launcher が続ける
 * @file
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

/** Outlook classic guard の操作 */
export type OutlookClassicGuardAction = 'inspect' | 'activate' | 'terminate';

/** Outlook classic 起動前に取る操作 */
export type OutlookClassicLaunchAction = 'launch' | 'activate' | 'confirm-restart';

/** Outlook クラシックの可視ウィンドウ。ツールウィンドウは含めない */
export interface OutlookClassicWindowInfo {
	/** OUTLOOK のプロセス ID */
	pid: number;
	/** ウィンドウハンドルを 10 進文字列にしたもの */
	hWnd: string;
	/** ウィンドウタイトル。空のときもある */
	windowTitle: string;
}

/** Outlook クラシックガードの 1 回の実行結果 */
export interface OutlookClassicGuardResult {
	/** 依頼した操作 */
	action: OutlookClassicGuardAction;
	/** 見つかった OUTLOOK のプロセス ID */
	processIds: number[];
	/** タスクバーに出る可視ウィンドウ */
	windows: OutlookClassicWindowInfo[];
	/** 前面化できたとき true。inspect と terminate では false */
	activated: boolean;
	/** 前面化したウィンドウ。していないときは null */
	activatedWindow: OutlookClassicWindowInfo | null;
	/** 強制終了できたプロセス ID */
	terminatedProcessIds: number[];
	/** 終了後も残っているプロセス ID */
	remainingProcessIds: number[];
	/** 個別プロセスの終了失敗。全体を止めずにメッセージだけ積む */
	errors: string[];
}

/** 空の Outlook classic guard 結果 */
const EMPTY_RESULT: OutlookClassicGuardResult = {
	// 正規化前の仮。呼び出し側の action で上書きする
	action: 'inspect',
	// プロセスは見つかっていない
	processIds: [],
	// 可視ウィンドウは無い
	windows: [],
	// 前面化していない
	activated: false,
	// 前面化したウィンドウは無い
	activatedWindow: null,
	// 終了させたプロセスは無い
	terminatedProcessIds: [],
	// 残存プロセスは無い
	remainingProcessIds: [],
	// 個別失敗は無い
	errors: []
};

/** PowerShell helper のタイムアウト */
const GUARD_TIMEOUT_MS = 15000;

/**
 * 値を配列として扱う
 * @param {unknown} value 値
 * @returns {unknown[]} 配列
 */
function asArray(value: unknown): unknown[] {
	// ----------------------------------------------
	// 既に配列なら包み直さない
	// ----------------------------------------------
	if (Array.isArray(value)) {
		return value;
	}

	// ----------------------------------------------
	// null か undefined。どちらかで空配列。0 や空文字はこの分岐に入らない
	// ----------------------------------------------
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
	// ----------------------------------------------
	// null、undefined、またはオブジェクトでない。どちらかでウィンドウにしない
	// ----------------------------------------------
	if (!value || typeof value !== 'object') {
		return null;
	}

	// ----------------------------------------------
	// 不足フィールドは undefined。pid と hWnd が無ければ無効
	// ----------------------------------------------
	const candidate = value as Partial<OutlookClassicWindowInfo>;
	// 整数でない値は NaN。0 以下は無効。単位はプロセス ID
	const pid       = Number(candidate.pid);
	// 未設定は空文字。空ならウィンドウとして扱わない
	const hWnd      = String(candidate.hWnd ?? '').trim();

	// ----------------------------------------------
	// 正の整数 pid と空でないハンドルの両方が必要。どちらか欠けると null
	// ----------------------------------------------
	if (!Number.isInteger(pid) || pid <= 0 || !hWnd) {
		return null;
	}

	return {
		// 検査を通ったプロセス ID。0 以下にはならない
		pid,
		// 10 進文字列のハンドル。空にはならない
		hWnd,
		// タイトル。未設定は空文字。空でもウィンドウは有効
		windowTitle: String(candidate.windowTitle ?? '')
	};
}

/**
 * Outlook classic guard 結果に正規化する
 * @param {OutlookClassicGuardAction} action 実行アクション
 * @param {unknown} value 値
 * @returns {OutlookClassicGuardResult} guard 結果
 */
function normalizeGuardResult(action: OutlookClassicGuardAction, value: unknown): OutlookClassicGuardResult {
	// ----------------------------------------------
	// null、undefined、またはオブジェクトでない。どちらかで空結果に action だけ載せる
	// ----------------------------------------------
	if (!value || typeof value !== 'object') {
		return {
			// 空の件数とフラグ。action だけ次の行で依頼内容に変える
			...EMPTY_RESULT,
			// 依頼した操作。空結果の inspect を上書きする
			action
		};
	}

	// ----------------------------------------------
	// 欠けたフィールドは空配列か null に落とす
	// ----------------------------------------------
	const raw             = value as Record<string, unknown>;
	// 正規化できた可視ウィンドウ。null は落とす。無ければ空配列
	const windows         = asArray(raw.windows)
		.map(normalizeWindowInfo)
		.filter((item) => item !== null);
	// 前面化したウィンドウ。フィールドが不正なら null
	const activatedWindow = normalizeWindowInfo(raw.activatedWindow);

	return {
		// 呼び出し元が依頼した操作。応答 JSON の action は使わない
		action,
		// 正の整数だけ。0 以下と非数は捨てる。無ければ空
		processIds: normalizeNumberArray(raw.processIds),
		// タスクバーに出る可視ウィンドウ。ツールウィンドウは含めない
		windows,
		// true のときだけ前面化済み。欠けると false
		activated: raw.activated === true,
		// 前面化した 1 窓。していないときは null
		activatedWindow,
		// 強制終了できたプロセス ID。無ければ空
		terminatedProcessIds: normalizeNumberArray(raw.terminatedProcessIds),
		// 終了後も残っているプロセス ID。無ければ空
		remainingProcessIds: normalizeNumberArray(raw.remainingProcessIds),
		// 個別失敗のメッセージ。空要素は捨てる。無ければ空
		errors: normalizeStringArray(raw.errors)
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
export function getOutlookClassicLaunchAction(snapshot: Pick<OutlookClassicGuardResult, 'processIds' | 'windows'>): OutlookClassicLaunchAction {
	// ----------------------------------------------
	// 可視ウィンドウが 1 つでもあれば前面化する。起動はしない
	// ----------------------------------------------
	if (snapshot.windows.length > 0) {
		return 'activate';
	}

	// ----------------------------------------------
	// ウィンドウは無いがプロセスは残っている。再起動確認へ進む
	// ----------------------------------------------
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
export function runOutlookClassicGuard(scriptPath: string, action: OutlookClassicGuardAction): Promise<OutlookClassicGuardResult> {
	return new Promise((resolve, reject) => {
		// ----------------------------------------------
		// 標準出力の断片。完了前は空。結合前は JSON にならない
		// ----------------------------------------------
		const stdoutChunks: string[] = [];
		// 標準エラーの断片。空なら終了コードだけが失敗理由
		const stderrChunks: string[] = [];
		// resolve か reject 済みなら true。二重完了を防ぐ
		let settled                  = false;
		// ガードの PowerShell。終了コード 0 以外は失敗
		const child                  = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', action], {
			// 標準入力は使わない。stdout と stderr だけ受け取る
			stdio: ['ignore', 'pipe', 'pipe'],
			// コンソールウィンドウを出さない
			windowsHide: true
		});
		// 15 秒で kill するタイマー。単位は ms。完了したら clear する
		const timeout                = setTimeout(() => {
			// 既に完了していれば kill しない
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
			// タイムアウト後の error は二重に reject しない
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeout);
			reject(error);
		});

		child.once('close', (code) => {
			// ----------------------------------------------
			// タイムアウトか error のあとなら何もしない
			// ----------------------------------------------
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeout);

			// ----------------------------------------------
			// 標準出力。前後空白を除き、空なら JSON は無い
			// ----------------------------------------------
			const stdoutText = stdoutChunks.join('').trim();
			// 標準エラー。空なら終了コードだけを失敗理由にする
			const stderrText = stderrChunks.join('').trim();

			// 終了コードが 0 以外。null のときは unknown として失敗
			if (code !== 0) {
				reject(new Error(`Outlook classic guard exited with code ${code ?? 'unknown'}${stderrText ? `: ${stderrText}` : ''}`));
				return;
			}

			// ----------------------------------------------
			// 空の標準出力は null として空結果にする
			// ----------------------------------------------
			try {
				resolve(normalizeGuardResult(action, stdoutText ? JSON.parse(stdoutText) : null));
			} catch (error) {
				// 解析例外のメッセージ。Error でなければ文字列化
				const message = error instanceof Error ? error.message : String(error);

				reject(new Error(`Failed to parse Outlook classic guard output: ${message}`));
			}
		});
	});
}
