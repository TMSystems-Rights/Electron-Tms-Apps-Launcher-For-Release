/**
 * ポータブル判定、保存先パス、更新確認の方式を純粋関数で決める
 * ディレクトリの作成とプロセス終了は portable-runtime が行う
 * @file
 */
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

/** ポータブル版が使うディレクトリ。すべて exe のあるフォルダを基準にする */
export interface PortableDataPaths {
	/** ポータブル exe のあるディレクトリ */
	exeDir: string;
	/** Electron の userData。ポータブルでは exe の隣 */
	userData: string;
	/** launcher-data.json を置く場所。ポータブルでは userData と同じ */
	dataDir: string;
	/** Electron の sessionData */
	sessionData: string;
	/** ログの出力先 */
	logs: string;
	/** クラッシュダンプの出力先 */
	crashDumps: string;
	/** 一時ファイルの出力先 */
	temp: string;
	/** 抽出済みアイコンのキャッシュ */
	iconCache: string;
}

/** ディレクトリへ空ファイルを書いて消せるかの結果。探針ファイルは残さない */
export interface WritableProbeResult {
	/** 書き込めたとき true */
	ok: boolean;
	/** 失敗理由。成功時は未設定 */
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
 * ポータブルモードか判定する。cwd は見ない
 * ファイルがあれば JSON の成否に関わらずポータブルとする
 * @param {string} execPath 実行ファイルパス
 * @param {(filePath: string) => boolean} [existsFn] 存在判定
 * @returns {boolean} ポータブルなら true
 */
export function detectPortableMode(execPath: string, existsFn: (filePath: string) => boolean = fs.existsSync): boolean {
	return existsFn(resolvePortableMarkerPath(execPath));
}

/**
 * ポータブル版の保存先パスを解決する。dataDir は userData と同じ（平坦化）
 * @param {string} exeDir exe ディレクトリ
 * @returns {PortableDataPaths} 保存先
 */
export function resolvePortableDataPaths(exeDir: string): PortableDataPaths {
	// exe 隣の data。launcher-data.json もここへ置く
	const userData = path.join(exeDir, 'data');

	return {
		// 渡された exe ディレクトリ。空パスなら相対のまま残り得る
		exeDir,
		// Electron の userData。exe の隣の data
		userData,
		// launcher-data.json の場所。ポータブルでは userData と同じ
		dataDir: userData,
		// セッション。userData の下。未作成でもパスは返す
		sessionData: path.join(userData, 'session'),
		// ログ。userData の下
		logs: path.join(userData, 'logs'),
		// クラッシュダンプ。userData の下
		crashDumps: path.join(userData, 'crash-dumps'),
		// 一時ファイル。userData の下。TEMP と TMP もここへ向ける
		temp: path.join(userData, 'temp'),
		// 抽出アイコン。userData の下
		iconCache: path.join(userData, 'icon-cache')
	};
}

/**
 * 既定 dataDir を解決する
 * @param {string} userData userData
 * @param {boolean} isPortable ポータブルなら true
 * @returns {string} dataDir
 */
export function resolveDefaultDataDir(userData: string, isPortable: boolean): string {
	// ポータブルは userData をそのまま dataDir にする。data サブフォルダは重ねない
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
 * 更新確認の実装方式を決める。ポータブルでは electron-updater を使わない
 * @param {boolean} isPackaged パッケージ済みなら true
 * @param {boolean} isPortable ポータブルなら true
 * @returns {UpdateCheckMode} 更新確認方式
 */
export function resolveUpdateCheckMode(isPackaged: boolean, isPortable: boolean): UpdateCheckMode {
	// ----------------------------------------------
	// ポータブルは GitHub API。electron-updater は使わない。未パッケージでもこちらが先
	// ----------------------------------------------
	if (isPortable) {
		return 'github-release-api';
	}

	// ----------------------------------------------
	// 未パッケージかつポータブルでない。確認自体をしない
	// ----------------------------------------------
	if (!isPackaged) {
		return 'disabled';
	}

	return 'electron-updater';
}

/**
 * ディレクトリへ書き込めるか探針する。失敗しても他場所へ逃がさない
 * @param {string} directory 探針対象
 * @returns {WritableProbeResult} 結果
 */
export function probeWritableDirectory(directory: string): WritableProbeResult {
	// pid と時刻で名前を分ける。成功後は残さない
	const probeName = `.write-probe-${process.pid}-${Date.now()}`;
	// 探針のフルパス。親が無いときは mkdir してから書く
	const probePath = path.join(directory, probeName);

	// ----------------------------------------------
	// 書いて消せたら書き込み可。探針ファイルは残さない
	// ----------------------------------------------
	try {
		fs.mkdirSync(directory, {
			// 親が無くてもまとめて作る
			recursive: true
		});
		fs.writeFileSync(probePath, 'ok', 'utf8');
		fs.unlinkSync(probePath);

		return {
			// 書けて消せた
			ok: true
		};
	} catch (error) {
		// ----------------------------------------------
		// 失敗時は探針だけ消し、書き込み不可を返す
		// ----------------------------------------------
		try {
			// 途中まで書いたファイルがあるときだけ消す。書く前の失敗ではファイルは無い
			if (fs.existsSync(probePath)) {
				fs.unlinkSync(probePath);
			}
		} catch {
			// 探針ファイルの後始末に失敗しても、書き込み不可の判定を優先する
		}

		return {
			// 書けなかった。別のディレクトリへは切り替えない
			ok: false,
			// Error でなければ文字列。メッセージが空のときもある
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
