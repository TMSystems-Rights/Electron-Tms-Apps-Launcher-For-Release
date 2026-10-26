/**
 * アイコンキャッシュの読み書きを、一時 userData 上で検証する
 * 本番の userData は変更しない。終了コード 0 は成功、アサーション失敗は 1
 * @file
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { buildResolvedIconCacheKey, getIconCacheDir, readIconFromDiskCache, writeIconToDiskCache } from '../dist/main/icon-cache.js';

/** 1x1 透明 PNG */
const TINY_PNG_BASE64   = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// キャッシュへ書く data URL。中身は直上の 1x1 透明 PNG。空にはしない
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

/**
 * キャッシュキーから PNG ファイルパスを導出する
 * @param {string} userDataDir userData
 * @param {string} cacheKey キャッシュキー
 * @returns {string} PNG パス
 */
function expectedCacheFilePath(userDataDir, cacheKey) {
	// キャッシュキーの SHA-256。ファイル名に使い、キー文字列そのものはパスに出さない
	const hash = crypto.createHash('sha256').update(cacheKey, 'utf8').digest('hex');

	return path.join(userDataDir, 'icon-cache', `${hash}.png`);
}

// このテスト専用の userData。本番の userData は指さない。終了時に消す
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-al-icon-cache-'));

app.setPath('userData', tempDir);

app.whenReady().then(() => {
	try {
		// キャッシュキーの元パス。実在しなくてよい
		const samplePath = 'C:\\Apps\\Example.lnk';
		// 解決に使う更新時刻。単位はミリ秒。変えると別キーになる
		const mtime      = 1_700_000_000_000;
		// パスと更新時刻から作るキャッシュキー
		const cacheKey   = buildResolvedIconCacheKey(samplePath, mtime);

		assert.equal(cacheKey, `resolved:${samplePath}:${mtime}`);
		assert.equal(getIconCacheDir(), path.join(tempDir, 'icon-cache'));
		assert.equal(readIconFromDiskCache(cacheKey), null);

		// ----------------------------------------------
		writeIconToDiskCache(cacheKey, TINY_PNG_DATA_URL);

		// 期待する PNG の絶対パス。userData の icon-cache 配下
		const cacheFile = expectedCacheFilePath(tempDir, cacheKey);

		assert.ok(fs.existsSync(cacheFile), 'cache png should exist');

		// 読み戻した data URL。ファイルが壊れているか無いときは null
		const roundTrip = readIconFromDiskCache(cacheKey);

		assert.ok(roundTrip?.startsWith('data:image/png;base64,'), 'round trip should be data url');

		// ディスク上の PNG バイト列
		const written  = fs.readFileSync(cacheFile);
		// テストが書いた PNG。data URL の中身と一致するはず
		const expected = Buffer.from(TINY_PNG_BASE64, 'base64');

		assert.deepEqual(written, expected);

		// ----------------------------------------------
		// 更新時刻を 1 ミリ秒ずらしたキー。前のファイルには当たらない
		const newMtimeKey = buildResolvedIconCacheKey(samplePath, mtime + 1);

		assert.equal(readIconFromDiskCache(newMtimeKey), null, 'mtime change should miss cache');

		console.log('test-icon-cache: all assertions passed');
		app.exit(0);
	} catch (error) {
		console.error(error);
		app.exit(1);
	} finally {
		fs.rmSync(tempDir, {
			// 中のキャッシュファイルも消す
			recursive: true,
			// 既に無い場合はエラーにしない
			force: true
		});
	}
});
