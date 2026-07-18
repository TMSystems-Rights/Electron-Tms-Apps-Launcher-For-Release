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
	if (process.platform !== 'win32') {
		return undefined;
	}

	const candidates = app.isPackaged
		? [
			path.join(process.resourcesPath, APP_ICON_FILE_NAME),
		]
		: [
			path.join(app.getAppPath(), 'build', APP_ICON_FILE_NAME),
			path.join(process.cwd(), 'build', APP_ICON_FILE_NAME),
			path.join(__dirname, '..', '..', 'build', APP_ICON_FILE_NAME),
		];

	return candidates.find((candidate) => fs.existsSync(candidate));
}
