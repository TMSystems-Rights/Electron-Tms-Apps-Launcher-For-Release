import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require                              = createRequire(import.meta.url);
const rootDir                              = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
	detectPortableMode,
	isFlattenedDataDir,
	probeWritableDirectory,
	resolveDefaultDataDir,
	resolvePortableDataPaths,
	resolvePortableMarkerPath,
	resolveUpdateCheckMode,
} = require(path.join(rootDir, 'dist', 'main', 'portable-mode.js'));
const {
	compareNormalizedVersions,
	isNewerRelease,
	normalizeVersionTag,
	parseLatestReleaseTag,
	fetchLatestReleaseTag,
} = require(path.join(rootDir, 'dist', 'main', 'github-release.js'));
const {
	DEVELOPMENT_PORTAL_URL,
	PRODUCTION_PORTAL_URL,
	getOfficialPortalUrl,
	isAllowedOfficialPortalUrl,
	resolvePortalEnvironment,
} = require(path.join(rootDir, 'dist', 'main', 'portal-url.js'));
const { formatPortableUpdateErrorMessage } = require(path.join(rootDir, 'dist', 'main', 'updater.js'));

/**
 * 成功する GitHub Releases 応答を返す
 * @returns {Promise<{ ok: true, json: () => Promise<{ tag_name: string, assets: { name: string }[] }> }>} 応答
 */
async function mockGithubLatestOk() {
	return {
		ok  : true,
		json: readOkReleaseJson,
	};
}

/**
 * 成功 JSON を返す
 * @returns {Promise<{ tag_name: string, assets: { name: string }[] }>} JSON
 */
async function readOkReleaseJson() {
	return {
		tag_name: 'v9.9.9',
		assets  : [{ name: 'ignore.exe' }],
	};
}

/**
 * 403 応答を返す
 * @returns {Promise<{ ok: false, status: number, json: () => Promise<Record<string, never>> }>} 応答
 */
async function mockGithubLatestForbidden() {
	return {
		ok    : false,
		status: 403,
		json  : readEmptyJson,
	};
}

/**
 * 空 JSON を返す
 * @returns {Promise<Record<string, never>>} JSON
 */
async function readEmptyJson() {
	return {};
}

/**
 * 403 になる API 呼び出し
 * @returns {Promise<string>} tag_name
 */
function fetchForbiddenLatestTag() {
	return fetchLatestReleaseTag({
		fetchImpl: mockGithubLatestForbidden,
	});
}

/**
 * ZIP 一覧を正規化する
 * @param {string} stdout PowerShell 出力
 * @returns {string[]} エントリ名
 */
function parseZipListing(stdout) {
	const entries = [];

	for (const raw of stdout.split(/\r?\n/u)) {
		const line = raw.trim().replace(/\\/gu, '/');

		if (line) {
			entries.push(line);
		}
	}

	return entries;
}

/**
 * data 配下のエントリがあるか判定する
 * @param {string[]} entries ZIP エントリ
 * @returns {boolean} あれば true
 */
function hasPortableDataEntries(entries) {
	for (const entry of entries) {
		if (entry === 'TMS-AppsLauncher/data' || entry.startsWith('TMS-AppsLauncher/data/')) {
			return true;
		}
	}

	return false;
}

/**
 * ポータブル関連の単体テストを実行する
 * @returns {Promise<void>}
 */
async function runPortableTests() {
	const previousCwd = process.cwd();
	const tempRoot    = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-al-portable-'));

	try {
		const exeDir   = path.join(tempRoot, 'launch-dir');
		const otherCwd = path.join(tempRoot, 'other-cwd');
		const marker   = path.join(exeDir, 'portable-mode.json');
		const execPath = path.join(exeDir, 'TmsAppLauncher.exe');

		fs.mkdirSync(exeDir, { recursive: true });
		fs.mkdirSync(otherCwd, { recursive: true });
		fs.writeFileSync(execPath, 'fake-exe', 'utf8');
		fs.writeFileSync(marker, '{ not-json', 'utf8');

		process.chdir(otherCwd);

		assert.equal(
			resolvePortableMarkerPath(execPath),
			marker,
			'marker path must be next to execPath',
		);
		assert.equal(detectPortableMode(execPath), true, 'broken JSON still counts as portable');
		assert.equal(
			detectPortableMode(path.join(otherCwd, 'TmsAppLauncher.exe')),
			false,
			'missing marker is not portable',
		);

		const paths = resolvePortableDataPaths(exeDir);

		assert.equal(paths.userData, path.join(exeDir, 'data'));
		assert.equal(paths.dataDir, paths.userData);
		assert.equal(isFlattenedDataDir(paths.dataDir, paths.userData), true);
		assert.equal(
			path.join(paths.userData, 'data', 'launcher-data.json'),
			path.join(exeDir, 'data', 'data', 'launcher-data.json'),
		);
		assert.notEqual(
			path.join(paths.dataDir, 'launcher-data.json'),
			path.join(exeDir, 'data', 'data', 'launcher-data.json'),
		);

		const installerUserData = path.join(tempRoot, 'appdata', 'tms-app-launcher');
		const installerDataDir  = resolveDefaultDataDir(installerUserData, false);

		assert.equal(installerDataDir, path.join(installerUserData, 'data'));
		assert.equal(isFlattenedDataDir(installerDataDir, installerUserData), false);
		assert.equal(
			path.join(installerDataDir, 'launcher-data.json'),
			path.join(installerUserData, 'data', 'launcher-data.json'),
		);
		assert.equal(resolveDefaultDataDir(paths.userData, true), paths.userData);

		assert.equal(resolveUpdateCheckMode(true, true), 'github-release-api');
		assert.equal(resolveUpdateCheckMode(true, false), 'electron-updater');
		assert.equal(resolveUpdateCheckMode(false, false), 'disabled');
		assert.equal(
			resolveUpdateCheckMode(false, true),
			'github-release-api',
			'portable must never use electron-updater',
		);

		const probeOk = probeWritableDirectory(path.join(tempRoot, 'writable-data'));

		assert.equal(probeOk.ok, true);

		assert.equal(normalizeVersionTag('v1.8.0'), '1.8.0');
		assert.equal(normalizeVersionTag('1.8.0'), '1.8.0');
		assert.equal(compareNormalizedVersions('v1.8.0', '1.7.4') > 0, true);
		assert.equal(isNewerRelease('v1.8.0', '1.8.0'), false);
		assert.equal(isNewerRelease('v1.7.4', '1.8.0'), false);
		assert.equal(isNewerRelease('1.8.1', 'v1.8.0'), true);
		assert.equal(parseLatestReleaseTag({ tag_name: 'v1.8.0' }), 'v1.8.0');

		assert.equal(
			await fetchLatestReleaseTag({
				fetchImpl: mockGithubLatestOk,
			}),
			'v9.9.9',
		);

		await assert.rejects(fetchForbiddenLatestTag, /HTTP 403/);

		assert.equal(resolvePortalEnvironment({ isPackaged: false }), 'development');
		assert.equal(resolvePortalEnvironment({ isPackaged: false, envValue: 'production' }), 'development');
		assert.equal(resolvePortalEnvironment({ isPackaged: true }), 'production');
		assert.equal(resolvePortalEnvironment({ isPackaged: true, envValue: 'staging' }), 'production');
		assert.equal(resolvePortalEnvironment({ isPackaged: true, envValue: 'development' }), 'development');
		assert.equal(getOfficialPortalUrl('development'), DEVELOPMENT_PORTAL_URL);
		assert.equal(getOfficialPortalUrl('production'), PRODUCTION_PORTAL_URL);
		assert.equal(isAllowedOfficialPortalUrl(DEVELOPMENT_PORTAL_URL), true);
		assert.equal(isAllowedOfficialPortalUrl(PRODUCTION_PORTAL_URL), true);
		assert.equal(isAllowedOfficialPortalUrl('http://tm-systems.jp/#apps'), false);
		assert.equal(isAllowedOfficialPortalUrl('https://evil.example/#apps'), false);
		assert.equal(isAllowedOfficialPortalUrl('https://tm-systems.jp/secret'), false);
		assert.equal(isAllowedOfficialPortalUrl('https://tm-systems.jp/?next=https://evil.example'), false);
		assert.equal(isAllowedOfficialPortalUrl('https://cjac3.info/030_tms-portal/#apps'), true);
		assert.match(formatPortableUpdateErrorMessage('timeout'), /確認に失敗/);

		const fakeUnpacked = path.join(tempRoot, 'win-unpacked');
		const fakeOutput   = path.join(tempRoot, 'portable-out');

		fs.mkdirSync(path.join(fakeUnpacked, 'resources'), { recursive: true });
		fs.writeFileSync(path.join(fakeUnpacked, 'TmsAppLauncher.exe'), 'exe', 'utf8');
		fs.writeFileSync(path.join(fakeUnpacked, 'app-update.yml'), 'should-exclude', 'utf8');
		fs.writeFileSync(path.join(fakeUnpacked, 'resources', 'app.asar'), 'asar', 'utf8');
		fs.mkdirSync(path.join(fakeUnpacked, 'data'), { recursive: true });
		fs.writeFileSync(path.join(fakeUnpacked, 'data', 'launcher-data.json'), '{}', 'utf8');

		const packed = spawnSync(
			'pwsh',
			[
				'-NoProfile',
				'-File',
				path.join(rootDir, 'scripts', 'package-portable.ps1'),
				'-ProjectRoot',
				rootDir,
				'-Version',
				'9.9.9-test',
				'-WinUnpackedDir',
				fakeUnpacked,
				'-OutputDir',
				fakeOutput,
			],
			{ encoding: 'utf8' },
		);

		assert.equal(packed.status, 0, packed.stderr || packed.stdout);
		const zipPath  = path.join(fakeOutput, 'TmsAppLauncher-9.9.9-test-portable-x64.zip');
		const hashPath = `${zipPath}.sha256`;

		assert.equal(fs.existsSync(zipPath), true);
		assert.equal(fs.existsSync(hashPath), true);

		const zipBuffer = fs.readFileSync(zipPath);
		const digest    = crypto.createHash('sha256').update(zipBuffer).digest('hex');
		const hashText  = fs.readFileSync(hashPath, 'utf8').trim();

		assert.equal(hashText, `${digest}  TmsAppLauncher-9.9.9-test-portable-x64.zip`);

		const listing = spawnSync(
			'pwsh',
			[
				'-NoProfile',
				'-Command',
				`Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}'); $z.Entries.FullName; $z.Dispose()`,
			],
			{ encoding: 'utf8' },
		);

		assert.equal(listing.status, 0, listing.stderr || listing.stdout);

		const entries = parseZipListing(listing.stdout);

		assert.equal(entries.includes('TMS-AppsLauncher/TmsAppLauncher.exe'), true);
		assert.equal(entries.includes('TMS-AppsLauncher/portable-mode.json'), true);
		assert.equal(entries.includes('TMS-AppsLauncher/README-PORTABLE.txt'), true);
		assert.equal(entries.includes('TMS-AppsLauncher/app-update.yml'), false);
		assert.equal(hasPortableDataEntries(entries), false);

		console.log('test-portable: all assertions passed');
	} finally {
		process.chdir(previousCwd);
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

await runPortableTests();
