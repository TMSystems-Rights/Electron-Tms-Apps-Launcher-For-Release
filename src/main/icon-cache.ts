import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { logger } from './logger';

/**
 * アイコン永続キャッシュの保存先ディレクトリ
 * @returns {string} キャッシュディレクトリパス
 */
export function getIconCacheDir(): string {
	return path.join(app.getPath('userData'), 'icon-cache');
}

/**
 * 解決済みアイコンの永続キャッシュキーを構築する
 * @param {string} normalizedPath 正規化済みパス
 * @param {number} mtime ソースファイルの mtime（ミリ秒）
 * @returns {string} キャッシュキー
 */
export function buildResolvedIconCacheKey(normalizedPath: string, mtime: number): string {
	return `resolved:${normalizedPath}:${mtime}`;
}

/**
 * キャッシュキーから PNG ファイルパスを導出する
 * @param {string} cacheKey キャッシュキー
 * @returns {string} PNG ファイルパス
 */
function getCacheFilePath(cacheKey: string): string {
	const hash = crypto.createHash('sha256').update(cacheKey, 'utf8').digest('hex');

	return path.join(getIconCacheDir(), `${hash}.png`);
}

/**
 * 永続キャッシュからアイコンを読み込む
 * @param {string} cacheKey キャッシュキー
 * @returns {string | null} Data URL（未ヒット時 null）
 */
export function readIconFromDiskCache(cacheKey: string): string | null {
	const filePath = getCacheFilePath(cacheKey);

	try {
		if (!fs.existsSync(filePath)) {
			return null;
		}

		const buffer = fs.readFileSync(filePath);

		if (buffer.length === 0) {
			return null;
		}

		return `data:image/png;base64,${buffer.toString('base64')}`;
	} catch (error) {
		logger.warn('Icon disk cache read failed', {
			cacheKey,
			error : error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * 永続キャッシュへアイコンを書き込む
 * @param {string} cacheKey キャッシュキー
 * @param {string} dataUrl PNG Data URL
 * @returns {void}
 */
export function writeIconToDiskCache(cacheKey: string, dataUrl: string): void {
	const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);

	if (!match) {
		return;
	}

	try {
		const dir = getIconCacheDir();

		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(getCacheFilePath(cacheKey), Buffer.from(match[1], 'base64'));
	} catch (error) {
		logger.warn('Icon disk cache write failed', {
			cacheKey,
			error : error instanceof Error ? error.message : String(error),
		});
	}
}
