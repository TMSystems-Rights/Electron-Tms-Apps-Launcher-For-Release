import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import {
	buildResolvedIconCacheKey,
	getIconCacheDir,
	readIconFromDiskCache,
	writeIconToDiskCache,
} from '../dist/main/icon-cache.js';

/** 1x1 透明 PNG */
const TINY_PNG_BASE64   = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

/**
 * キャッシュキーから PNG ファイルパスを導出する
 * @param {string} userDataDir userData
 * @param {string} cacheKey キャッシュキー
 * @returns {string} PNG パス
 */
function expectedCacheFilePath(userDataDir, cacheKey) {
	const hash = crypto.createHash('sha256').update(cacheKey, 'utf8').digest('hex');

	return path.join(userDataDir, 'icon-cache', `${hash}.png`);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-al-icon-cache-'));

app.setPath('userData', tempDir);

app.whenReady().then(() => {
	try {
		const samplePath = 'C:\\Apps\\Example.lnk';
		const mtime      = 1_700_000_000_000;
		const cacheKey   = buildResolvedIconCacheKey(samplePath, mtime);

		assert.equal(cacheKey, `resolved:${samplePath}:${mtime}`);
		assert.equal(getIconCacheDir(), path.join(tempDir, 'icon-cache'));
		assert.equal(readIconFromDiskCache(cacheKey), null);

		writeIconToDiskCache(cacheKey, TINY_PNG_DATA_URL);

		const cacheFile = expectedCacheFilePath(tempDir, cacheKey);

		assert.ok(fs.existsSync(cacheFile), 'cache png should exist');

		const roundTrip = readIconFromDiskCache(cacheKey);

		assert.ok(roundTrip?.startsWith('data:image/png;base64,'), 'round trip should be data url');

		const written  = fs.readFileSync(cacheFile);
		const expected = Buffer.from(TINY_PNG_BASE64, 'base64');

		assert.deepEqual(written, expected);

		const newMtimeKey = buildResolvedIconCacheKey(samplePath, mtime + 1);

		assert.equal(readIconFromDiskCache(newMtimeKey), null, 'mtime change should miss cache');

		console.log('test-icon-cache: all assertions passed');
		app.exit(0);
	} catch (error) {
		console.error(error);
		app.exit(1);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
