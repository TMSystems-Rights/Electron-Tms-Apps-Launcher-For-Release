/**
 * ウィンドウアイコンの ico を、パッケージ版と開発版で探して返す
 * ファイルが無いときは undefined を返し、呼び出し側が既定アイコンのままにする
 * @file
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** アプリケーションアイコンファイル名 */
const APP_ICON_FILE_NAME = 'icon.ico';

/**
 * ウィンドウ表示用アイコンパスを取得する
 * @returns {string | undefined} 存在する場合は絶対パス
 */
export function getAppIconPath(): string | undefined {
	// ----------------------------------------------
	// win32 以外に ico は渡さない。呼び出し側は OS の既定アイコン
	// ----------------------------------------------
	if (process.platform !== 'win32') {
		return undefined;
	}

	// ----------------------------------------------
	// パッケージは resources、開発は build。どれも無ければ undefined
	// ----------------------------------------------
	const candidates = app.isPackaged ? [path.join(process.resourcesPath, APP_ICON_FILE_NAME)] : [path.join(app.getAppPath(), 'build', APP_ICON_FILE_NAME), path.join(process.cwd(), 'build', APP_ICON_FILE_NAME), path.join(__dirname, '..', '..', 'build', APP_ICON_FILE_NAME)];

	return candidates.find((candidate) => fs.existsSync(candidate));
}
