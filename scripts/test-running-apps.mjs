/**
 * 起動中アプリの一致判定と Outlook クラシックの起動前判断を検証する
 * ファイルは書かない。終了コード 0 は成功、アサーション失敗は 1
 * @file
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist を require する関数。ESM からは createRequire で取る
const require                                                                                                                                                  = createRequire(import.meta.url);
// リポジトリルート。dist の一致判定をここから読む
const rootDir                                                                                                                                                  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 起動中プロセスと登録アプリの一致。ファイルは書かない
const { areSameAppIds, getProfileDirectory, isExcludedScriptHost, isWindowsAppAliasPath, getBatchLaunchExecutable, matchRunningAppIds, normalizePathForMatch } = require(path.join(rootDir, 'dist', 'main', 'running-apps-match.js'));
// Outlook クラシックを起動するか、前面化するか、再起動確認か
const { getOutlookClassicLaunchAction, isOutlookClassicExecutable }                                                                                            = require(path.join(rootDir, 'dist', 'main', 'outlook-classic.js'));

assert.equal(normalizePathForMatch(' "C:/Tools/App.exe" '), 'c:\\tools\\app.exe');
assert.equal(isWindowsAppAliasPath('C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ms-teams.exe', 'C:\\Users\\tester\\AppData\\Local'), true);
assert.equal(isWindowsAppAliasPath('C:\\Tools\\ms-teams.exe', 'C:\\Users\\tester'), false);
assert.equal(isExcludedScriptHost('C:\\Windows\\System32\\cmd.exe'), true);
assert.equal(isOutlookClassicExecutable('C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE'), true);
assert.equal(isOutlookClassicExecutable('C:\\Program Files\\WindowsApps\\Microsoft.OutlookForWindows\\olk.exe'), false);
assert.equal(getOutlookClassicLaunchAction({ processIds: [], windows: [] }), 'launch');
assert.equal(getOutlookClassicLaunchAction({ processIds: [100], windows: [] }), 'confirm-restart');
assert.equal(
	getOutlookClassicLaunchAction({
		processIds: [100],
		windows: [{ pid: 100, hWnd: '123456', windowTitle: '受信トレイ - Outlook' }]
	}),
	'activate'
);
assert.equal(getBatchLaunchExecutable(['@echo off', 'set "FirefoxDebugFdeExe=C:\\Program Files\\Firefox Developer Edition\\firefox.exe"', 'start "" "%FirefoxDebugFdeExe%" -no-remote'].join('\n')), 'C:\\Program Files\\Firefox Developer Edition\\firefox.exe');

// 比較する登録アプリ。実行パスが空の件はウィンドウタイトルや AUMID で見る
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
	{ id: 'docker', executablePath: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', allowAliasFileNameFallback: false, windowTitle: 'Docker Desktop' }
];
// いま動いているプロセス。パスの大文字小文字やエイリアス先の違いを含む
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
	{ pid: 11, processName: 'firefox', executablePath: 'C:\\Program Files\\Firefox Developer Edition\\firefox.exe', commandLine: 'firefox.exe -no-remote', windowTitle: 'about:debugging - Firefox Developer Edition', appUserModelId: '' }
];

assert.equal(getProfileDirectory('--profile-directory="Profile 4"'), 'profile 4');
assert.deepEqual(matchRunningAppIds(registeredApps, processes), ['alias', 'console-title', 'docker', 'edge-profile-2', 'exact', 'firefox-developer', 'pidl', 'teams-alias']);
assert.deepEqual(
	matchRunningAppIds(registeredApps, [
		{
			pid: 10,
			processName: 'msedge',
			executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
			commandLine: 'msedge.exe',
			windowTitle: 'Edge',
			appUserModelId: 'MSEdge.UserData.Profile1'
		}
	]),
	['edge-profile-1']
);
assert.deepEqual(
	matchRunningAppIds(registeredApps, [
		{
			pid: 12,
			processName: 'msedge',
			executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
			commandLine: 'msedge.exe',
			windowTitle: 'TMSystems - ソフトウェア工房 および他 16 ページ - 職場 - Microsoft Edge',
			appUserModelId: ''
		}
	]),
	['edge-profile-4']
);
assert.deepEqual(
	matchRunningAppIds(registeredApps, [
		{
			pid: 13,
			processName: 'OUTLOOK',
			executablePath: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE',
			commandLine: '',
			windowTitle: '受信トレイ - taku.miyamoto.01@tm-systems.jp - Outlook',
			appUserModelId: ''
		}
	]),
	['outlook-classic']
);
assert.deepEqual(
	matchRunningAppIds(registeredApps, [
		{
			pid: 14,
			processName: 'olk',
			executablePath: 'C:\\Program Files\\WindowsApps\\Microsoft.OutlookForWindows_1.2026.707.300_x64__8wekyb3d8bbwe\\olk.exe',
			commandLine: '',
			windowTitle: 'メール - TMSystems 代表 - Outlook',
			appUserModelId: 'Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows'
		}
	]),
	['outlook-new']
);
// Teams の登録だけ。リンクとエイリアスの両方に当たることを見る
const teamsRegisteredApps = registeredApps.filter((app) => app.id.startsWith('teams-'));

assert.deepEqual(
	matchRunningAppIds(teamsRegisteredApps, [
		{
			pid: 15,
			processName: 'ms-teams',
			executablePath: 'C:\\Program Files\\WindowsApps\\MSTeams_26163.405.4842.717_x64__8wekyb3d8bbwe\\ms-teams.exe',
			commandLine: '',
			windowTitle: 'Microsoft Teams',
			appUserModelId: 'MSTeams_8wekyb3d8bbwe!MSTeams'
		}
	]),
	['teams-alias', 'teams-link']
);

// Chrome のプロファイル別の登録。Chrome はタイトルにプロファイル名を出さないため、ウィンドウの AppUserModelID だけで判定できる
const chromeProfileApps    = [
	{
		// 登録アプリの ID
		id                        : 'chrome-profile-1',
		// Chrome の安定版
		executablePath            : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		// エイリアスのファイル名だけでの一致は使わない
		allowAliasFileNameFallback: false,
		// ショートカットの --profile-directory
		profileDirectory          : 'profile 1',
		// Local State の表示名。Chrome のウィンドウのタイトルには出ない
		profileNames              : ['代表'],
		// ショートカットの AppUserModelID。2026-11-23 に実測したウィンドウの ID と同じ形
		appUserModelId            : 'Chrome.UserData.Profile1'
	},
	{
		// 登録アプリの ID
		id                        : 'chrome-profile-2',
		// Chrome の安定版
		executablePath            : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		// エイリアスのファイル名だけでの一致は使わない
		allowAliasFileNameFallback: false,
		// ショートカットの --profile-directory
		profileDirectory          : 'profile 2',
		// Local State の表示名
		profileNames              : ['DT'],
		// ショートカットの AppUserModelID
		appUserModelId            : 'Chrome.UserData.Profile2'
	}
];
// Chrome の Profile 1 のウィンドウ。プロファイル指定なしで起動したプロセスに属し、コマンドラインからはプロファイルが分からない
const chromeProfile1Window = {
	// プロセス ID
	pid           : 16,
	// プロセス名
	processName   : 'chrome',
	// Chrome の安定版
	executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
	// プロファイル指定の無いコマンドライン
	commandLine   : 'chrome.exe',
	// プロファイル名を含まないタイトル
	windowTitle   : '新しいタブ - Google Chrome',
	// ウィンドウの AppUserModelID。PropVariant を 24 バイトにして読めるようになった値
	appUserModelId: 'Chrome.UserData.Profile1'
};

// ウィンドウの ID が読めれば、そのプロファイルの登録だけが起動中になる
assert.deepEqual(matchRunningAppIds(chromeProfileApps, [chromeProfile1Window]), ['chrome-profile-1']);
// ID が空（PropVariant が 16 バイトだった頃の値）だと、タイトルにもコマンドラインにも手がかりが無く、どちらも起動中にならない
assert.deepEqual(matchRunningAppIds(chromeProfileApps, [{ ...chromeProfile1Window, appUserModelId: '' }]), []);

// ウィンドウ列挙スクリプトのバイト列。ファイルは書かない
const taskbarScriptBytes = readFileSync(path.join(rootDir, 'resources', 'get-taskbar-apps.ps1'));

// Windows PowerShell 5.1 が UTF-8 として読むよう、BOM で始まる
assert.deepEqual([...taskbarScriptBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
// PropVariant を x64 の PROPVARIANT と同じ 24 バイトで確保している。16 バイトだとウィンドウの AppUserModelID を読めない
assert.match(taskbarScriptBytes.toString('utf8'), /\[StructLayout\(LayoutKind\.Explicit, Size = 24\)\]\s+private struct PropVariant/);
assert.equal(areSameAppIds(['b', 'a'], ['a', 'b']), true);
assert.equal(areSameAppIds(['a'], ['a', 'b']), false);

console.log('Running app matching tests passed');
