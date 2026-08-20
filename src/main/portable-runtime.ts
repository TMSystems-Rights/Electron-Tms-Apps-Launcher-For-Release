import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import {
	detectPortableMode,
	probeWritableDirectory,
	resolvePortableDataPaths,
	type PortableDataPaths,
} from './portable-mode';

/** ポータブル実行中フラグ */
let portableActive = false;

/** ポータブル exe ディレクトリ */
let portableExeDir: string | null = null;

/**
 * ポータブル実行中か返す
 * @returns {boolean} ポータブルなら true
 */
export function isPortableRuntime(): boolean {
	return portableActive;
}

/**
 * ポータブル exe ディレクトリを返す
 * @returns {string | null} exe ディレクトリ
 */
export function getPortableExeDir(): string | null {
	return portableExeDir;
}

/**
 * ポータブル用サブディレクトリを作成する
 * @param {PortableDataPaths} paths 保存先
 * @returns {void}
 */
function ensurePortableSubdirectories(paths: PortableDataPaths): void {
	const directories = [
		paths.userData,
		paths.sessionData,
		paths.logs,
		paths.crashDumps,
		paths.temp,
		paths.iconCache,
		path.join(paths.userData, 'backups'),
	];

	for (const directory of directories) {
		fs.mkdirSync(directory, { recursive: true });
	}
}

/**
 * 書き込み不可時のエラーを表示して終了する
 * @param {string} detail 詳細
 * @returns {void}
 */
function exitBecauseDataDirIsNotWritable(detail: string): void {
	dialog.showErrorBox(
		'TMS-AppsLauncher',
		[
			'展開先へ書き込めないため、TMS-AppsLauncher を起動できません。',
			'',
			detail,
			'',
			'読み取り専用メディアや書き込み権限のないフォルダでは使用できません。',
			'設定やログを顧客端末のユーザーフォルダへ退避することはありません。',
		].join('\n'),
	);
	app.exit(1);
}

/**
 * 判定ファイルがあれば起動最初期に保存先を切り替える。
 * configureDevUserData / logger.init / 単一インスタンスロックより前に呼ぶ。
 * @returns {boolean} ポータブルとして適用したら true
 */
export function applyPortableRuntimeIfNeeded(): boolean {
	const execPath = process.execPath;

	if (!detectPortableMode(execPath)) {
		return false;
	}

	const exeDir = path.dirname(execPath);
	const paths  = resolvePortableDataPaths(exeDir);
	const probe  = probeWritableDirectory(paths.userData);

	if (!probe.ok) {
		exitBecauseDataDirIsNotWritable(probe.error ?? 'data フォルダへ書き込めません。');
		return false;
	}

	ensurePortableSubdirectories(paths);
	app.setPath('userData', paths.userData);
	app.setPath('sessionData', paths.sessionData);
	app.setPath('logs', paths.logs);
	app.setPath('crashDumps', paths.crashDumps);
	app.setPath('temp', paths.temp);
	process.env.TEMP = paths.temp;
	process.env.TMP  = paths.temp;
	portableActive   = true;
	portableExeDir   = exeDir;

	return true;
}
