import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from '../dist/main/ipc.js';

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const rootDir     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-app-launcher-ui-'));
const dataDir     = path.join(userDataDir, 'data');

app.setPath('userData', userDataDir);
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'launcher-data.json'), JSON.stringify({
	schemaVersion: 1,
	settings     : {
		toggleInitialState        : 'expandAll',
		groupExpandedStates       : { 'g-dev': false, 'g-chat': true },
		window                    : { width: 760, height: 720 },
		appearance                : 'light',
		launchBehavior            : 'stay',
		rememberWindowSizeOnLaunch: false,
		paneCount                 : 2,
		uncategorizedPane         : 'left',
	},
	groups: [
		{ id: 'g-dev', name: '開発', order: 0, isUncategorized: false, pane: 'left' },
		{ id: 'g-chat', name: '連絡', order: 0, isUncategorized: false, pane: 'right' },
	],
	apps: [
		{ id: 'a-code', name: 'Visual Studio Code', path: 'C:\\Tools\\Code.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-dev', order: 0 },
		{ id: 'a-edge', name: 'TAME Sort Utility', path: 'C:\\Program Files\\TameSort.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-dev', order: 1 },
		{ id: 'a-teams', name: 'Microsoft Teams', path: 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ms-teams.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-chat', order: 0 },
		{ id: 'a-teams-short', name: 'ms-teams', path: 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ms-teams.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-chat', order: 1 },
	],
}, null, 2), 'utf8');

app.whenReady().then(async () => {
	registerIpcHandlers();

	const win = new BrowserWindow({
		show         : false,
		titleBarStyle: 'hidden',
		webPreferences: {
			preload         : path.join(rootDir, 'dist', 'preload', 'preload.js'),
			contextIsolation: true,
			sandbox         : true,
		},
	});

	await win.loadFile(path.join(rootDir, 'dist', 'renderer', 'index.html'));
	await new Promise((resolve) => setTimeout(resolve, 1200));

	const result = await win.webContents.executeJavaScript(`(async () => {
		const input = document.getElementById('tmsAlSearchInput');
		const results = document.getElementById('tmsAlSearchResults');
		input.value = 'v c s';
		input.dispatchEvent(new Event('input', { bubbles: true }));

		const option = results.querySelector('[role="option"]');
		const initial = {
			resultText: option?.textContent,
			lineTexts: [...option?.querySelectorAll('.tms-al-search__option-line') ?? []].map((line) => line.textContent),
			characterHighlights: option?.querySelectorAll('.tms-al-search__highlight--character').length,
			resultCount: results.querySelectorAll('[role="option"]').length,
		};
		const launchIds = [];
		const launchCalls = [];
		TMS_AL.ScreenMain.LaunchApp = async (appId, options) => {
			launchIds.push(appId);
			launchCalls.push({ appId, runAsAdmin: options?.runAsAdmin === true });
		};
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		option?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
		const searchLaunchIds = launchIds.slice();

		await TMS_AL.ScreenMain.HandleAppContextMenuAction('a-code', 'runAsAdmin');
		const contextAction = launchCalls[launchCalls.length - 1];

		const group = document.querySelector('[data-group-id="g-dev"]');
		const row = document.querySelector('[data-app-id="a-code"]');
		const preview = {
			groupExpanded: group?.classList.contains('tms-al-group--expanded'),
			rowHighlighted: row?.classList.contains('tms-al-app-row--search-preview'),
			persistedState: TMS_AL.ScreenMain._groupExpanded['g-dev'],
		};

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		const cleared = {
			inputValue: input.value,
			resultsHidden: results.hidden,
			groupExpanded: group?.classList.contains('tms-al-group--expanded'),
		};

		input.value = 'teams';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		const teamsSearch = {
			labels: [...results.querySelectorAll('[role="option"]')].map((option) => option.textContent),
			lineTexts: [...results.querySelectorAll('[role="option"]')].map((option) => (
				[...option.querySelectorAll('.tms-al-search__option-line')].map((line) => line.textContent)
			)),
			partialHighlightCounts: [...results.querySelectorAll('[role="option"]')].map((option) => (
				option.querySelectorAll('.tms-al-search__highlight:not(.tms-al-search__highlight--character)').length
			)),
			characterHighlightCounts: [...results.querySelectorAll('[role="option"]')].map((option) => (
				option.querySelectorAll('.tms-al-search__highlight--character').length
			)),
			hasSeparator: results.querySelector('.tms-al-search__separator') !== null,
			resultCount: results.querySelectorAll('[role="option"]').length,
		};

		const btnCollapseAll = document.getElementById('tmsAlBtnCollapseAll');
		btnCollapseAll?.focus();
		btnCollapseAll?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		const globalCleared = {
			inputValue: input.value,
			resultsHidden: results.hidden,
			activeElementId: document.activeElement?.id,
		};

		const btnExpandAll = document.getElementById('tmsAlBtnExpandAll');
		btnExpandAll?.focus();
		window.dispatchEvent(new Event('focus'));
		await new Promise((resolve) => setTimeout(resolve, 20));
		const windowFocus = {
			activeElementId: document.activeElement?.id,
		};

		const settingsModal = document.getElementById('tmsAlModalSettings');
		const settingsClose = document.getElementById('tmsAlBtnSettingsClose');
		settingsModal.hidden = false;
		settingsClose?.focus();
		window.dispatchEvent(new Event('focus'));
		await new Promise((resolve) => setTimeout(resolve, 20));
		const modalWindowFocus = {
			activeElementId: document.activeElement?.id,
		};
		settingsModal.hidden = true;

		TMS_AL.ScreenMain.ApplyRunningApps({ appIds: ['a-code'] });
		await TMS_AL.ScreenMain.Render();
		const rerenderedRow = document.querySelector('[data-app-id="a-code"]');
		const running = {
			classApplied: rerenderedRow?.classList.contains('tms-al-app-row--running'),
			dotVisible: !rerenderedRow?.querySelector('.tms-al-app-row__running-state')?.hidden,
		};

		const contextEvents = [];
		TMS_AL.ScreenMain.OpenAppContextMenu = async (appId, event) => {
			event.preventDefault();
			contextEvents.push({ appId, defaultPrevented: event.defaultPrevented });
		};
		rerenderedRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		const contextMenu = {
			count: contextEvents.length,
			appId: contextEvents[0]?.appId,
			defaultPrevented: contextEvents[0]?.defaultPrevented,
		};

		await TMS_AL.Theme.Apply('dark');
		return {
			initial,
			launchIds: searchLaunchIds,
			contextAction,
			preview,
			cleared,
			teamsSearch,
			globalCleared,
			windowFocus,
			modalWindowFocus,
			running,
			contextMenu,
			darkTheme: document.body.classList.contains('tms-al-theme-dark'),
		};
	})()`);

	const passed = result.initial.resultText === '開発：Visual Studio CodeCode.exe'
		&& JSON.stringify(result.initial.lineTexts) === JSON.stringify(['開発：Visual Studio Code', 'Code.exe'])
		&& result.initial.characterHighlights === 3
		&& result.initial.resultCount === 1
		&& JSON.stringify(result.launchIds) === JSON.stringify(['a-code', 'a-code'])
		&& result.contextAction.appId === 'a-code'
		&& result.contextAction.runAsAdmin
		&& result.preview.groupExpanded
		&& result.preview.rowHighlighted
		&& result.preview.persistedState === false
		&& result.cleared.inputValue === ''
		&& result.cleared.resultsHidden
		&& !result.cleared.groupExpanded
		&& result.teamsSearch.labels[0] === '連絡：Microsoft Teamsms-teams.exe'
		&& result.teamsSearch.labels[1] === '連絡：ms-teamsms-teams.exe'
		&& result.teamsSearch.labels[2] === '開発：TAME Sort UtilityTameSort.exe'
		&& JSON.stringify(result.teamsSearch.lineTexts[0]) === JSON.stringify(['連絡：Microsoft Teams', 'ms-teams.exe'])
		&& JSON.stringify(result.teamsSearch.lineTexts[1]) === JSON.stringify(['連絡：ms-teams', 'ms-teams.exe'])
		&& JSON.stringify(result.teamsSearch.lineTexts[2]) === JSON.stringify(['開発：TAME Sort Utility', 'TameSort.exe'])
		&& JSON.stringify(result.teamsSearch.partialHighlightCounts) === JSON.stringify([2, 2, 0])
		&& JSON.stringify(result.teamsSearch.characterHighlightCounts) === JSON.stringify([0, 0, 10])
		&& result.teamsSearch.hasSeparator
		&& result.teamsSearch.resultCount === 3
		&& result.globalCleared.inputValue === ''
		&& result.globalCleared.resultsHidden
		&& result.globalCleared.activeElementId === 'tmsAlBtnCollapseAll'
		&& result.windowFocus.activeElementId === 'tmsAlSearchInput'
		&& result.modalWindowFocus.activeElementId === 'tmsAlBtnSettingsClose'
		&& result.running.classApplied
		&& result.running.dotVisible
		&& result.contextMenu.count === 1
		&& result.contextMenu.appId === 'a-code'
		&& result.contextMenu.defaultPrevented
		&& result.darkTheme;

	if (!passed) {
		throw new Error(`UI integration test failed: ${JSON.stringify(result)}`);
	}

	console.log('UI integration tests passed');
	win.destroy();
	app.quit();
}).catch((error) => {
	console.error(error);
	app.exit(1);
});
