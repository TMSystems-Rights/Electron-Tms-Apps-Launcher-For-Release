/**
 * 更新失敗メッセージの文言を、dist の updater に対して検証する
 * ファイルは書かない。終了コード 0 は成功、アサーション失敗は 1
 * @file
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist を require するための関数。ESM からは createRequire で取る
const require                      = createRequire(import.meta.url);
// リポジトリルート。dist の updater をここから読む
const rootDir                      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 検証するメッセージ整形。このスクリプトはファイルを書かない
const { formatUpdateErrorMessage } = require(path.join(rootDir, 'dist', 'main', 'updater.js'));

assert.match(formatUpdateErrorMessage('sha512 checksum mismatch, expected abc, got def'), /検証に失敗/);
assert.match(formatUpdateErrorMessage('Cannot parse blockmap "foo.blockmap", error: incorrect header check'), /差分情報/);
assert.equal(formatUpdateErrorMessage('network timeout'), 'アップデートのダウンロードに失敗しました: network timeout');

console.log('test-update-error: all assertions passed');
