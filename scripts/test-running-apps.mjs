import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
	areSameAppIds,
	getProfileDirectory,
	isExcludedScriptHost,
	isWindowsAppAliasPath,
	getBatchLaunchExecutable,
	matchRunningAppIds,
	normalizePathForMatch,
} = require(path.join(rootDir, 'dist', 'main', 'running-apps-match.js'));
const {
	getOutlookClassicLaunchAction,
	isOutlookClassicExecutable,
} = require(path.join(rootDir, 'dist', 'main', 'outlook-classic.js'));

assert.equal(normalizePathForMatch(' "C:/Tools/App.exe" '), 'c:\\tools\\app.exe');
assert.equal(
	isWindowsAppAliasPath(
		'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ms-teams.exe',
		'C:\\Users\\tester\\AppData\\Local',
	),
	true,
);
assert.equal(isWindowsAppAliasPath('C:\\Tools\\ms-teams.exe', 'C:\\Users\\tester'), false);
assert.equal(isExcludedScriptHost('C:\\Windows\\System32\\cmd.exe'), true);
assert.equal(isOutlookClassicExecutable('C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE'), true);
assert.equal(isOutlookClassicExecutable('C:\\Program Files\\WindowsApps\\Microsoft.OutlookForWindows\\olk.exe'), false);
assert.equal(getOutlookClassicLaunchAction({ processIds: [], windows: [] }), 'launch');
assert.equal(getOutlookClassicLaunchAction({ processIds: [100], windows: [] }), 'confirm-restart');
assert.equal(getOutlookClassicLaunchAction({
	processIds: [100],
	windows   : [{ pid: 100, hWnd: '123456', windowTitle: '受信トレイ - Outlook' }],
}), 'activate');
assert.equal(
	getBatchLaunchExecutable([
		'@echo off',
		'set "FirefoxDebugFdeExe=C:\\Program Files\\Firefox Developer Edition\\firefox.exe"',
		'start "" "%FirefoxDebugFdeExe%" -no-remote',
	].join('\n')),
	'C:\\Program Files\\Firefox Developer Edition\\firefox.exe',
);

const registeredApps = [
	{ id: 'exact', executablePath: 'C:\\Tools\\Editor.exe', allowAliasFileNameFallback: false },
	{ id: 'alias', executablePath: 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ms-teams.exe', allowAliasFileNameFallback: true },
	{ id: 'same-name-no-fallback', executablePath: 'C:\\Other\\ms-teams.exe', allowAliasFileNameFallback: false },
	{ id: 'script-host', executablePath: 'C:\\Windows\\System32\\cmd.exe', allowAliasFileNameFallback: false },
	{ id: 'firefox-developer', executablePath: 'C:\\Program Files\\Firefox Developer Edition\\firefox.exe', allowAliasFileNameFallback: false },
	{ id: 'edge-profile-1', executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', allowAliasFileNameFallback: false, profileDirectory: 'profile 1', profileNames: ['TMSystems'], appUserModelId: 'MSEdge.UserData.Profile1' },
	{ id: 'edge-profile-2', executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', allowAliasFileNameFallback: false, profileDirectory: 'profile 2', profileNames: ['個人用'], appUserModelId: 'MSEdge.UserData.Profile2' },
	{ id: 'edge-profile-4', executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', allowAliasFileNameFallback: false, profileDirectory: 'profile 4', profileNames: ['プロファイル 1', '職場'], appUserModelId: 'MSEdge.UserData.Profile4' },
	{ id: 'outlook-classic', executablePath: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE', allowAliasFileNameFallback: false, appUserModelId: 'Microsoft.Office.OUTLOOK.EXE.15', windowTitle: 'Outlook (classic)' },
	{ id: 'outlook-new', executablePath: '', allowAliasFileNameFallback: false, appUserModelId: 'Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows', windowTitle: 'Outlook' },
	{ id: 'teams-link', executablePath: '', allowAliasFileNameFallback: false, appUserModelId: 'MSTeams_8wekyb3d8bbwe!MSTeams', windowTitle: 'Microsoft Teams' },
	{ id: 'teams-alias', executablePath: 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\MSTeams_8wekyb3d8bbwe\\ms-teams.exe', allowAliasFileNameFallback: true },
	{ id: 'pidl', executablePath: 'D:\\Program Files\\WinMerge\\WinMergeU.exe', allowAliasFileNameFallback: false, appUserModelId: 'Thingamahoochie.WinMerge', windowTitle: 'WinMerge' },
	{ id: 'console-title', executablePath: 'C:\\Windows\\System32\\cmd.exe', allowAliasFileNameFallback: false, windowTitle: 'Streaming Driver' },
	{ id: 'obsidian-launcher', executablePath: 'C:\\Windows\\System32\\cmd.exe', allowAliasFileNameFallback: false, windowTitle: 'Obsidian Backup Launcher' },
	{ id: 'docker', executablePath: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', allowAliasFileNameFallback: false, windowTitle: 'Docker Desktop' },
];
const processes      = [
	{ pid: 1, processName: 'Editor', executablePath: 'c:\\tools\\EDITOR.exe', commandLine: '', windowTitle: '', appUserModelId: '' },
	{ pid: 2, processName: 'ms-teams', executablePath: 'C:\\Program Files\\WindowsApps\\MSTeams_1\\ms-teams.exe', commandLine: '', windowTitle: '', appUserModelId: '' },
	{ pid: 3, processName: 'cmd', executablePath: 'C:\\Windows\\System32\\cmd.exe', commandLine: '', windowTitle: '', appUserModelId: '' },
	{ pid: 4, processName: 'Editor', executablePath: 'C:\\Tools\\Editor.exe', commandLine: '', windowTitle: '', appUserModelId: '' },
	{ pid: 5, processName: 'msedge', executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', commandLine: 'msedge.exe', windowTitle: 'Microsoft Edge の新機能 および他 50 ページ - 個人用 - Microsoft Edge', appUserModelId: '' },
	{ pid: 6, processName: 'WinMergeU', executablePath: 'D:\\Program Files\\WinMerge\\WinMergeU.exe', commandLine: '', windowTitle: 'compare.txt - WinMerge 2.16', appUserModelId: '' },
	{ pid: 7, processName: 'WindowsTerminal', executablePath: 'C:\\Program Files\\WindowsApps\\WindowsTerminal.exe', commandLine: '', windowTitle: 'Streaming Driver', appUserModelId: '' },
	{ pid: 8, processName: 'Obsidian', executablePath: 'D:\\Program Files\\Obsidian\\Obsidian.exe', commandLine: '', windowTitle: 'Vault - Obsidian', appUserModelId: '' },
	{ pid: 9, processName: 'Docker Desktop', executablePath: 'C:\\Program Files\\Docker\\Docker\\frontend\\Docker Desktop.exe', commandLine: '', windowTitle: 'Docker Desktop', appUserModelId: '' },
	{ pid: 11, processName: 'firefox', executablePath: 'C:\\Program Files\\Firefox Developer Edition\\firefox.exe', commandLine: 'firefox.exe -no-remote', windowTitle: 'about:debugging - Firefox Developer Edition', appUserModelId: '' },
];

assert.equal(getProfileDirectory('--profile-directory="Profile 4"'), 'profile 4');
assert.deepEqual(matchRunningAppIds(registeredApps, processes), [
	'alias',
	'console-title',
	'docker',
	'edge-profile-2',
	'exact',
	'firefox-developer',
	'pidl',
	'teams-alias',
]);
assert.deepEqual(matchRunningAppIds(registeredApps, [{
	pid             : 10,
	processName     : 'msedge',
	executablePath  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	commandLine     : 'msedge.exe',
	windowTitle     : 'Edge',
	appUserModelId  : 'MSEdge.UserData.Profile1',
}]), ['edge-profile-1']);
assert.deepEqual(matchRunningAppIds(registeredApps, [{
	pid             : 12,
	processName     : 'msedge',
	executablePath  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	commandLine     : 'msedge.exe',
	windowTitle     : 'TMSystems - ソフトウェア工房 および他 16 ページ - 職場 - Microsoft Edge',
	appUserModelId  : '',
}]), ['edge-profile-4']);
assert.deepEqual(matchRunningAppIds(registeredApps, [{
	pid             : 13,
	processName     : 'OUTLOOK',
	executablePath  : 'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE',
	commandLine     : '',
	windowTitle     : '受信トレイ - taku.miyamoto.01@tm-systems.jp - Outlook',
	appUserModelId  : '',
}]), ['outlook-classic']);
assert.deepEqual(matchRunningAppIds(registeredApps, [{
	pid             : 14,
	processName     : 'olk',
	executablePath  : 'C:\\Program Files\\WindowsApps\\Microsoft.OutlookForWindows_1.2026.707.300_x64__8wekyb3d8bbwe\\olk.exe',
	commandLine     : '',
	windowTitle     : 'メール - TMSystems 代表 - Outlook',
	appUserModelId  : 'Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows',
}]), ['outlook-new']);
const teamsRegisteredApps = registeredApps.filter((app) => app.id.startsWith('teams-'));

assert.deepEqual(matchRunningAppIds(teamsRegisteredApps, [{
	pid             : 15,
	processName     : 'ms-teams',
	executablePath  : 'C:\\Program Files\\WindowsApps\\MSTeams_26163.405.4842.717_x64__8wekyb3d8bbwe\\ms-teams.exe',
	commandLine     : '',
	windowTitle     : 'Microsoft Teams',
	appUserModelId  : 'MSTeams_8wekyb3d8bbwe!MSTeams',
}]), ['teams-alias', 'teams-link']);
assert.equal(areSameAppIds(['b', 'a'], ['a', 'b']), true);
assert.equal(areSameAppIds(['a'], ['a', 'b']), false);

console.log('Running app matching tests passed');
