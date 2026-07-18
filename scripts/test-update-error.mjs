import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require                      = createRequire(import.meta.url);
const rootDir                      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatUpdateErrorMessage } = require(path.join(rootDir, 'dist', 'main', 'updater.js'));

assert.match(
	formatUpdateErrorMessage('sha512 checksum mismatch, expected abc, got def'),
	/検証に失敗/,
);
assert.match(
	formatUpdateErrorMessage('Cannot parse blockmap "foo.blockmap", error: incorrect header check'),
	/差分情報/,
);
assert.equal(
	formatUpdateErrorMessage('network timeout'),
	'アップデートのダウンロードに失敗しました: network timeout',
);

console.log('test-update-error: all assertions passed');
