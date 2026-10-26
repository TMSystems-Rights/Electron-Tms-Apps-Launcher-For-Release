/**
 * 抽出済みアイコンを userData 配下のキャッシュへ読み書きする
 * 抽出そのものは native が行い、このファイルはパスとファイルの対応だけを持つ
 * @file
 */
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
	// キーの SHA-256 hex。同じキーは同じファイル名。単位は 64 文字。空キーもハッシュになる
	const hash = crypto.createHash('sha256').update(cacheKey, 'utf8').digest('hex');

	return path.join(getIconCacheDir(), `${hash}.png`);
}

/**
 * 永続キャッシュからアイコンを読み込む
 * @param {string} cacheKey キャッシュキー
 * @returns {string | null} Data URL（未ヒット時 null）
 */
export function readIconFromDiskCache(cacheKey: string): string | null {
	// キーに対応する PNG の絶対パス。ファイルが無くてもパス自体は返す
	const filePath = getCacheFilePath(cacheKey);

	try {
		// ----------------------------------------------
		// キャッシュファイルが無いときは未ヒット
		// ----------------------------------------------
		if (!fs.existsSync(filePath)) {
			return null;
		}

		// ファイル全体。読めないときは catch で null
		const buffer = fs.readFileSync(filePath);

		// 0 バイトは壊れたキャッシュ。未ヒットとして null
		if (buffer.length === 0) {
			return null;
		}

		return `data:image/png;base64,${buffer.toString('base64')}`;
	} catch (error) {
		logger.warn('Icon disk cache read failed', {
			// 読めなかったキー。空でもハッシュパスは作られている
			cacheKey,
			// Error でなければ文字列化。メッセージが空のときもある
			error: error instanceof Error ? error.message : String(error)
		});
		return null;
	}
}

/**
 * 永続キャッシュへアイコンを書き込む
 * @param {string} cacheKey キャッシュキー
 * @param {string} dataUrl PNG Data URL
 */
export function writeIconToDiskCache(cacheKey: string, dataUrl: string): void {
	// PNG の base64 本体。形式が違うときは null で何も書かない
	const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);

	// data URL が PNG base64 でない。キャッシュは更新しない
	if (!match) {
		return;
	}

	try {
		// ----------------------------------------------
		// userData/icon-cache を作り、キーのハッシュ名で PNG を上書きする
		// ----------------------------------------------
		const dir = getIconCacheDir();

		fs.mkdirSync(dir, {
			// 親が無くてもまとめて作る
			recursive: true
		});
		fs.writeFileSync(getCacheFilePath(cacheKey), Buffer.from(match[1], 'base64'));
	} catch (error) {
		logger.warn('Icon disk cache write failed', {
			// 書けなかったキー
			cacheKey,
			// Error でなければ文字列化。メッセージが空のときもある
			error: error instanceof Error ? error.message : String(error)
		});
	}
}
