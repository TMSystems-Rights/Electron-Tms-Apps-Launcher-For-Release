/**
 * 起動直後にポータブル判定ファイルを見て、userData を exe の隣へ切り替える
 * 保存先へ書けないときは、他の初期化より前にプロセスを終了する
 * @file
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import { detectPortableMode, probeWritableDirectory, resolvePortableDataPaths, type PortableDataPaths } from './portable-mode';

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
 */
function ensurePortableSubdirectories(paths: PortableDataPaths): void {
	// userData 以下と backups。backups は paths に無いのでここで足す
	const directories = [paths.userData, paths.sessionData, paths.logs, paths.crashDumps, paths.temp, paths.iconCache, path.join(paths.userData, 'backups')];

	// 1 件のディレクトリ。既にあっても再帰作成は失敗にしない
	for (const directory of directories) {
		fs.mkdirSync(directory, {
			// 親が無くてもまとめて作る
			recursive: true
		});
	}
}

/**
 * 書き込み不可時のエラーを表示して終了する
 * @param {string} detail 詳細
 */
function exitBecauseDataDirIsNotWritable(detail: string): void {
	dialog.showErrorBox('TMS-AppsLauncher', ['展開先へ書き込めないため、TMS-AppsLauncher を起動できません。', '', detail, '', '読み取り専用メディアや書き込み権限のないフォルダでは使用できません。', '設定やログを顧客端末のユーザーフォルダへ退避することはありません。'].join('\n'));
	app.exit(1);
}

/**
 * 判定ファイルがあれば起動最初期に保存先を切り替える
 * configureDevUserData / logger.init / 単一インスタンスロックより前に呼ぶ
 * @returns {boolean} ポータブルとして適用したら true
 */
export function applyPortableRuntimeIfNeeded(): boolean {
	// このプロセスの exe。判定ファイルは同じフォルダ。cwd は見ない
	const execPath = process.execPath;

	// 判定ファイルが無い。通常の userData のまま続ける
	if (!detectPortableMode(execPath)) {
		return false;
	}

	// exe のあるディレクトリ。保存先の基準。空にはならない
	const exeDir = path.dirname(execPath);
	// data 以下のパス一式。userData は exe 隣の data
	const paths  = resolvePortableDataPaths(exeDir);
	// userData へ書けたか。失敗時だけ error が入る
	const probe  = probeWritableDirectory(paths.userData);

	// 書けない。他の場所へ逃がさず終了する。error が空なら固定文言
	if (!probe.ok) {
		exitBecauseDataDirIsNotWritable(probe.error ?? 'data フォルダへ書き込めません。');
		return false;
	}

	// ----------------------------------------------
	// サブディレクトリを作り、Electron のパスを exe 隣へ切り替える
	// ----------------------------------------------
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
