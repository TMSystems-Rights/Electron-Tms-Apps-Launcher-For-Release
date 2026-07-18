import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from '../dist/main/ipc.js';

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const rootDir     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-app-launcher-row-drag-'));
const dataDir     = path.join(userDataDir, 'data');

app.setPath('userData', userDataDir);
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'launcher-data.json'), JSON.stringify({
	schemaVersion: 1,
	settings     : {
		toggleInitialState      : 'expandAll',
		groupExpandedStates     : { 'g-test': true },
		window                  : { width: 720, height: 720 },
		appearance              : 'light',
		launchBehavior          : 'stay',
		rememberWindowSizeOnLaunch: false,
		paneCount               : 1,
		uncategorizedPane       : 'left',
	},
	groups: [
		{ id: 'g-test', name: 'テスト', order: 0, isUncategorized: false, pane: 'left' },
	],
	apps: [
		{ id: 'a-one', name: 'One', path: 'C:\\Windows\\System32\\notepad.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-test', order: 0 },
		{ id: 'a-two', name: 'Two', path: 'C:\\Windows\\System32\\calc.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-test', order: 1 },
	],
}, null, 2), 'utf8');

app.whenReady().then(async () => {
	registerIpcHandlers();

	const win = new BrowserWindow({
		show         : false,
		titleBarStyle: 'hidden',
		webPreferences: {
			preload         : path.join(rootDir, 'dist/preload/preload.js'),
			contextIsolation: true,
			sandbox         : true,
		},
	});

	await win.loadFile(path.join(rootDir, 'dist/renderer/index.html'));
	await new Promise((resolve) => setTimeout(resolve, 1500));

	const result = await win.webContents.executeJavaScript(`(async () => {
		const rows = [...document.querySelectorAll('.tms-al-app-row')];
		if (rows.length < 2) return { error: 'need 2+ rows', count: rows.length };

		const first = rows[0];
		const before = rows.map((r) => r.getAttribute('data-app-id'));
		const list = first.parentElement;
		if (!list) return { error: 'no app list' };

		TMS_AL.RowDrag._placeInList(list, first, 10000, '.tms-al-app-row');
		await TMS_AL.ScreenMain.RecalculateOrdersFromDom();

		const after = [...document.querySelectorAll('.tms-al-app-row')].map((r) => r.getAttribute('data-app-id'));
		return {
			before,
			after,
			moved: before[0] !== after[0],
		};
	})()`);

	if (result.error || !result.moved) {
		throw new Error(`Row drag test failed: ${JSON.stringify(result)}`);
	}

	console.log('Row drag test passed');
	win.destroy();
	app.quit();
}).catch((error) => {
	console.error(error);
	app.exit(1);
});
