/**
 * 引数のテストスクリプトを Electron で実行する
 * テストファイル以外は変更しない
 * 終了コードは子プロセスの終了コード。引数が無いときは例外になり 1
 * @file
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// このファイルの URL から require する。ESM のまま Electron の実体パスを取る
const require      = createRequire(import.meta.url);
// Electron 実行ファイル。ELECTRON_RUN_AS_NODE が無い状態でテストを起動する
const electronPath = require('electron');
// 実行するテストスクリプト。未指定なら起動しない
const target       = process.argv[2];
// 子プロセスへ渡す環境。ELECTRON_RUN_AS_NODE は直後に消す
const childEnv     = { ...process.env };

// テストスクリプトが無いときは起動せず例外にする。終了コードは 1
if (!target) {
	throw new Error('Electron test target is required');
}

delete childEnv.ELECTRON_RUN_AS_NODE;

// 起動結果。error があるときはプロセスを開始できていない。status が null のときはシグナル死
const result = spawnSync(electronPath, ['--in-process-gpu', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', path.resolve(target)], {
	// ELECTRON_RUN_AS_NODE を消した環境
	env: childEnv,
	// テストの標準入出力をそのまま親へ出す
	stdio: 'inherit',
	// コンソールウィンドウを出さない
	windowsHide: true
});

// ----------------------------------------------
// OS の一時ディレクトリ。この直下のテスト用フォルダだけ消す
const tempRoot = path.resolve(os.tmpdir());

// 一時ディレクトリ直下の名前。テスト接頭辞以外は触らない
for (const entry of fs.readdirSync(tempRoot)) {
	// 行ドラッグ、UI、アイコンキャッシュの接頭辞のどれでもないとき残す。一つでも一致すると削除候補になる
	if (!entry.startsWith('tms-app-launcher-row-drag-') && !entry.startsWith('tms-app-launcher-ui-') && !entry.startsWith('tms-al-icon-cache-')) {
		continue;
	}

	// 削除候補の絶対パス。一時ディレクトリの外へ出ていないかを次で確認する
	const candidate = path.resolve(tempRoot, entry);

	// 解決後も一時ディレクトリ直下のときだけ消す
	if (path.dirname(candidate) === tempRoot) {
		try {
			fs.rmSync(candidate, {
				// 中のファイルも消す
				recursive: true,
				// 既に無い場合はエラーにしない
				force: true,
				// ロックで失敗したときの再試行回数
				maxRetries: 3
			});
		} catch (error) {
			console.warn(`Could not remove test directory: ${candidate}`, error);
		}
	}
}

// ----------------------------------------------
// 起動そのものが失敗したときはその例外で落とす。テスト本体の終了コードより先に見る
if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
