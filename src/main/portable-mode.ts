import fs from 'node:fs';
import path from 'node:path';

/** ポータブル判定ファイル名 */
export const PORTABLE_MARKER_FILE_NAME = 'portable-mode.json';

/** ポータブル版 AppUserModelID */
export const PORTABLE_APP_USER_MODEL_ID = 'jp.tm-systems.tms-app-launcher.portable';

/** ポータブル識別ファイルの内容 */
export const PORTABLE_MARKER_CONTENTS = '{\n  "schemaVersion": 1\n}\n';

/** 更新確認の実装方式 */
export type UpdateCheckMode = 'disabled' | 'electron-updater' | 'github-release-api';

/** ポータブル版の保存先パス */
export interface PortableDataPaths {
	exeDir: string;
	userData: string;
	dataDir: string;
	sessionData: string;
	logs: string;
	crashDumps: string;
	temp: string;
	iconCache: string;
}

/** 書き込み探針結果 */
export interface WritableProbeResult {
	ok: boolean;
	error?: string;
}

/**
 * exe と同じフォルダを返す
 * @param {string} execPath 実行ファイルパス
 * @returns {string} exe ディレクトリ
 */
export function resolvePortableExeDir(execPath: string): string {
	return path.dirname(execPath);
}

/**
 * ポータブル判定ファイルのパスを返す
 * @param {string} execPath 実行ファイルパス
 * @returns {string} 判定ファイルパス
 */
export function resolvePortableMarkerPath(execPath: string): string {
	return path.join(resolvePortableExeDir(execPath), PORTABLE_MARKER_FILE_NAME);
}

/**
 * ポータブルモードか判定する。cwd は見ない。
 * ファイルがあれば JSON の成否に関わらずポータブルとする。
 * @param {string} execPath 実行ファイルパス
 * @param {(filePath: string) => boolean} [existsFn] 存在判定
 * @returns {boolean} ポータブルなら true
 */
export function detectPortableMode(
	execPath: string,
	existsFn: (filePath: string) => boolean = fs.existsSync,
): boolean {
	return existsFn(resolvePortableMarkerPath(execPath));
}

/**
 * ポータブル版の保存先パスを解決する。dataDir は userData と同じ（平坦化）。
 * @param {string} exeDir exe ディレクトリ
 * @returns {PortableDataPaths} 保存先
 */
export function resolvePortableDataPaths(exeDir: string): PortableDataPaths {
	const userData = path.join(exeDir, 'data');

	return {
		exeDir,
		userData,
		dataDir    : userData,
		sessionData: path.join(userData, 'session'),
		logs       : path.join(userData, 'logs'),
		crashDumps : path.join(userData, 'crash-dumps'),
		temp       : path.join(userData, 'temp'),
		iconCache  : path.join(userData, 'icon-cache'),
	};
}

/**
 * 既定 dataDir を解決する
 * @param {string} userData userData
 * @param {boolean} isPortable ポータブルなら true
 * @returns {string} dataDir
 */
export function resolveDefaultDataDir(userData: string, isPortable: boolean): string {
	if (isPortable) {
		return userData;
	}

	return path.join(userData, 'data');
}

/**
 * launcher-data.json が平坦配置か判定する
 * @param {string} dataDir dataDir
 * @param {string} userData userData
 * @returns {boolean} dataDir が userData と同じなら true
 */
export function isFlattenedDataDir(dataDir: string, userData: string): boolean {
	return path.resolve(dataDir) === path.resolve(userData);
}

/**
 * 更新確認の実装方式を決める。ポータブルでは electron-updater を使わない。
 * @param {boolean} isPackaged パッケージ済みなら true
 * @param {boolean} isPortable ポータブルなら true
 * @returns {UpdateCheckMode} 更新確認方式
 */
export function resolveUpdateCheckMode(isPackaged: boolean, isPortable: boolean): UpdateCheckMode {
	if (isPortable) {
		return 'github-release-api';
	}

	if (!isPackaged) {
		return 'disabled';
	}

	return 'electron-updater';
}

/**
 * ディレクトリへ書き込めるか探針する。失敗しても他場所へ逃がさない。
 * @param {string} directory 探針対象
 * @returns {WritableProbeResult} 結果
 */
export function probeWritableDirectory(directory: string): WritableProbeResult {
	const probeName = `.write-probe-${process.pid}-${Date.now()}`;
	const probePath = path.join(directory, probeName);

	try {
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(probePath, 'ok', 'utf8');
		fs.unlinkSync(probePath);

		return { ok: true };
	} catch (error) {
		try {
			if (fs.existsSync(probePath)) {
				fs.unlinkSync(probePath);
			}
		} catch {
			// 探針ファイルの後始末に失敗しても、書き込み不可の判定を優先する
		}

		return {
			ok   : false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
