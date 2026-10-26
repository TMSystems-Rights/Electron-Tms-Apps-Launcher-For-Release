/**
 * アプリ行のドラッグ並び替えを Electron 上で検証する
 * 一時 userData 以外は変更しない。終了コード 0 は成功、失敗は 1
 * @file
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from '../dist/main/ipc.js';

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

// リポジトリルート。dist の画面と preload をここから読む
const rootDir     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// このテスト専用の userData。本番の保存先は指さない
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-app-launcher-row-drag-'));
// launcher-data.json を置く data。userData の直下
const dataDir     = path.join(userDataDir, 'data');

app.setPath('userData', userDataDir);
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
	path.join(dataDir, 'launcher-data.json'),
	JSON.stringify(
		{
			schemaVersion: 1,
			settings: {
				toggleInitialState: 'expandAll',
				groupExpandedStates: { 'g-test': true },
				window: { width: 720, height: 720 },
				appearance: 'light',
				launchBehavior: 'stay',
				rememberWindowSizeOnLaunch: false,
				paneCount: 1,
				uncategorizedPane: 'left'
			},
			groups: [{ id: 'g-test', name: 'テスト', order: 0, isUncategorized: false, pane: 'left' }],
			apps: [
				{ id: 'a-one', name: 'One', path: 'C:\\Windows\\System32\\notepad.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-test', order: 0 },
				{ id: 'a-two', name: 'Two', path: 'C:\\Windows\\System32\\calc.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-test', order: 1 }
			]
		},
		null,
		2
	),
	'utf8'
);

app.whenReady()
	.then(async () => {
		registerIpcHandlers();

		// 画面を載せる非表示ウィンドウ。テストが終わったら破棄する
		const win = new BrowserWindow({
			// テスト中はウィンドウを出さない
			show: false,
			// ランチャー本体と同じタイトルバーなし
			titleBarStyle: 'hidden',
			// 描画プロセスの隔離。preload だけが launcherApi を渡す
			webPreferences: {
				// ビルド済み preload
				preload: path.join(rootDir, 'dist/preload/preload.js'),
				// ページから Node を直接触らせない
				contextIsolation: true,
				// レンダラーをサンドボックスにする
				sandbox: true
			}
		});

		await win.loadFile(path.join(rootDir, 'dist/renderer/index.html'));
		await new Promise((resolve) => setTimeout(resolve, 1500));

		// ページ内で並べ替えを実行した結果。失敗時は error が入る
		const result = await win.webContents.executeJavaScript(`(async () => {
		// 画面上のアプリ行。2 件未満では入れ替えを見ない
		const rows = [...document.querySelectorAll('.tms-al-app-row')];
		// 行が 2 件未満では入れ替えを検証できない
		if (rows.length < 2) return {
			// 失敗理由。行数が足りない
			error: 'need 2+ rows',
			// 実際の行数
			count: rows.length
		};

		// 先頭行。これをリストの末尾側へ動かす
		const first = rows[0];
		// 移動前のアプリ ID。DOM 順
		const before = rows.map((r) => r.getAttribute('data-app-id'));
		// 行の親リスト。無いときは並べ替えできない
		const list = first.parentElement;
		// 行の親リストが無いときは並べ替えできない
		if (!list) return {
			// 失敗理由。アプリ一覧が無い
			error: 'no app list'
		};

		TMS_AL.RowDrag._placeInList(list, first, 10000, '.tms-al-app-row');
		await TMS_AL.ScreenMain.RecalculateOrdersFromDom();

		// 移動後のアプリ ID。DOM 順。先頭が変わっていれば成功
		const after = [...document.querySelectorAll('.tms-al-app-row')].map((r) => r.getAttribute('data-app-id'));
		return {
			// 移動前の ID 順
			before,
			// 移動後の ID 順
			after,
			// 先頭 ID が変わったか。変わらなければ失敗
			moved: before[0] !== after[0],
		};
	})()`);

		// 失敗、または先頭行が動いていないときはテスト失敗。どちらか一方で足りる
		if (result.error || !result.moved) {
			throw new Error(`Row drag test failed: ${JSON.stringify(result)}`);
		}

		console.log('Row drag test passed');
		win.destroy();
		app.quit();
	})
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});
