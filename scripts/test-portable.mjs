/**
 * ポータブル判定、保存先、更新方式を dist の portable-mode に対して検証する
 * 一時ディレクトリ以外は変更しない。終了コード 0 は成功、アサーション失敗は 1
 * @file
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// dist を require する関数。ESM からは createRequire で取る
const require                                                                                                                                                                = createRequire(import.meta.url);
// リポジトリルート。dist のモジュールをここから読む
const rootDir                                                                                                                                                                = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ポータブル判定と保存先。一時ディレクトリ以外は変えない
const { detectPortableMode, isFlattenedDataDir, probeWritableDirectory, resolveDefaultDataDir, resolvePortableDataPaths, resolvePortableMarkerPath, resolveUpdateCheckMode } = require(path.join(rootDir, 'dist', 'main', 'portable-mode.js'));
// 版比較と Releases の tag 取得
const { compareNormalizedVersions, isNewerRelease, normalizeVersionTag, parseLatestReleaseTag, fetchLatestReleaseTag }                                                       = require(path.join(rootDir, 'dist', 'main', 'github-release.js'));
// 公式ポータル URL の許可判定。任意 URL は開かない
const { PRODUCTION_PORTAL_URL, getOfficialPortalUrl, isAllowedOfficialPortalUrl, resolvePortalEnvironment }                                                                  = require(path.join(rootDir, 'dist', 'main', 'portal-url.js'));
// ポータブル更新失敗の文言
const { formatPortableUpdateErrorMessage }                                                                                                                                   = require(path.join(rootDir, 'dist', 'main', 'updater.js'));

/**
 * 成功する GitHub Releases 応答を返す
 * @returns {Promise<{ ok: true, json: () => Promise<{ tag_name: string, assets: { name: string }[] }> }>} 応答
 */
async function mockGithubLatestOk() {
	return {
		// HTTP 成功。本文は readOkReleaseJson が返す
		ok: true,
		// リリース JSON を後から読む
		json: readOkReleaseJson
	};
}

/**
 * 成功 JSON を返す
 * @returns {Promise<{ tag_name: string, assets: { name: string }[] }>} JSON
 */
async function readOkReleaseJson() {
	return {
		// 比較に使う tag。v 付き
		tag_name: 'v9.9.9',
		// 無視する asset。タグ解析には使わない
		assets: [
			{
				// インストーラ名。このテストでは中身を見ない
				name: 'ignore.exe'
			}
		]
	};
}

/**
 * 403 応答を返す
 * @returns {Promise<{ ok: false, status: number, json: () => Promise<Record<string, never>> }>} 応答
 */
async function mockGithubLatestForbidden() {
	return {
		// HTTP 失敗
		ok: false,
		// 認証または権限エラー
		status: 403,
		// 本文は空オブジェクト
		json: readEmptyJson
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
		// 403 を返す差し替え。ネットワークへは出さない
		fetchImpl: mockGithubLatestForbidden
	});
}

/**
 * ZIP 一覧を正規化する
 * @param {string} stdout PowerShell 出力
 * @returns {string[]} エントリ名
 */
function parseZipListing(stdout) {
	// 正規化したエントリ名。空行は捨てる
	const entries = [];

	// ZIP 一覧の 1 行。区切りは CR LF でも LF でもよい
	for (const raw of stdout.split(/\r?\n/u)) {
		// 前後空白を除き、バックスラッシュをスラッシュにしたパス。空行は入れない
		const line = raw.trim().replace(/\\/gu, '/');

		// 空行はエントリにしない
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
	// ZIP 内の 1 エントリ。data 配下ならポータブル同梱データがある
	for (const entry of entries) {
		// data ディレクトリそのもの、またはその配下。どちらか一方で同梱とみなす
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
	// テスト後に戻す作業ディレクトリ。一時ディレクトリへ移る
	const previousCwd = process.cwd();
	// このテスト専用の一時ルート。終了時に消す
	const tempRoot    = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-al-portable-'));

	try {
		// 偽の exe があるディレクトリ。マーカーもここへ置く
		const exeDir   = path.join(tempRoot, 'launch-dir');
		// exe とは別の作業ディレクトリ。マーカーが無い側
		const otherCwd = path.join(tempRoot, 'other-cwd');
		// 壊した JSON のマーカー。中身が不正でもポータブルとみなす
		const marker   = path.join(exeDir, 'portable-mode.json');
		// 実在しなくてよい偽の exe パス
		const execPath = path.join(exeDir, 'TmsAppLauncher.exe');

		fs.mkdirSync(exeDir, { recursive: true });
		fs.mkdirSync(otherCwd, { recursive: true });
		fs.writeFileSync(execPath, 'fake-exe', 'utf8');
		fs.writeFileSync(marker, '{ not-json', 'utf8');

		process.chdir(otherCwd);

		assert.equal(resolvePortableMarkerPath(execPath), marker, 'marker path must be next to execPath');
		assert.equal(detectPortableMode(execPath), true, 'broken JSON still counts as portable');
		assert.equal(detectPortableMode(path.join(otherCwd, 'TmsAppLauncher.exe')), false, 'missing marker is not portable');

		// ポータブル時の userData と dataDir。exe 隣の data を指す
		const paths = resolvePortableDataPaths(exeDir);

		assert.equal(paths.userData, path.join(exeDir, 'data'));
		assert.equal(paths.dataDir, paths.userData);
		assert.equal(isFlattenedDataDir(paths.dataDir, paths.userData), true);
		assert.equal(path.join(paths.userData, 'data', 'launcher-data.json'), path.join(exeDir, 'data', 'data', 'launcher-data.json'));
		assert.notEqual(path.join(paths.dataDir, 'launcher-data.json'), path.join(exeDir, 'data', 'data', 'launcher-data.json'));

		// インストーラ版の userData。ポータブルの data とは別
		const installerUserData = path.join(tempRoot, 'appdata', 'tms-app-launcher');
		// インストーラ版の data ディレクトリ。userData の下の data
		const installerDataDir  = resolveDefaultDataDir(installerUserData, false);

		assert.equal(installerDataDir, path.join(installerUserData, 'data'));
		assert.equal(isFlattenedDataDir(installerDataDir, installerUserData), false);
		assert.equal(path.join(installerDataDir, 'launcher-data.json'), path.join(installerUserData, 'data', 'launcher-data.json'));
		assert.equal(resolveDefaultDataDir(paths.userData, true), paths.userData);

		assert.equal(resolveUpdateCheckMode(true, true), 'github-release-api');
		assert.equal(resolveUpdateCheckMode(true, false), 'electron-updater');
		assert.equal(resolveUpdateCheckMode(false, false), 'disabled');
		assert.equal(resolveUpdateCheckMode(false, true), 'github-release-api', 'portable must never use electron-updater');

		// 書き込み探針の結果。一時ディレクトリなので成功するはず
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
				// 成功 JSON を返す差し替え。ネットワークへは出さない
				fetchImpl: mockGithubLatestOk
			}),
			'v9.9.9'
		);

		await assert.rejects(fetchForbiddenLatestTag, /HTTP 403/);

		assert.equal(resolvePortalEnvironment({ isPackaged: false }), 'development');
		assert.equal(resolvePortalEnvironment({ isPackaged: false, envValue: 'production' }), 'development');
		assert.equal(resolvePortalEnvironment({ isPackaged: true }), 'production');
		assert.equal(resolvePortalEnvironment({ isPackaged: true, envValue: 'staging' }), 'production');
		assert.equal(resolvePortalEnvironment({ isPackaged: true, envValue: 'development' }), 'development');
		// 開発用ポータル。本番 URL と違うときだけ開発環境で許可する
		const testDevelopmentPortalUrl = 'https://portal.dev.example/preview/#apps';
		assert.equal(getOfficialPortalUrl('development', testDevelopmentPortalUrl), testDevelopmentPortalUrl);
		assert.equal(getOfficialPortalUrl('development', ''), PRODUCTION_PORTAL_URL);
		assert.equal(getOfficialPortalUrl('production', testDevelopmentPortalUrl), PRODUCTION_PORTAL_URL);
		assert.equal(isAllowedOfficialPortalUrl(testDevelopmentPortalUrl, ''), false);
		assert.equal(isAllowedOfficialPortalUrl(testDevelopmentPortalUrl, testDevelopmentPortalUrl), true);
		assert.equal(isAllowedOfficialPortalUrl(PRODUCTION_PORTAL_URL, ''), true);
		assert.equal(isAllowedOfficialPortalUrl('http://tm-systems.jp/#apps', ''), false);
		assert.equal(isAllowedOfficialPortalUrl('https://evil.example/#apps', ''), false);
		assert.equal(isAllowedOfficialPortalUrl('https://tm-systems.jp/secret', ''), false);
		assert.equal(isAllowedOfficialPortalUrl('https://tm-systems.jp/?next=https://evil.example', ''), false);
		assert.match(formatPortableUpdateErrorMessage('timeout'), /確認に失敗/);

		// 偽の win-unpacked。ZIP に入れる元
		const fakeUnpacked = path.join(tempRoot, 'win-unpacked');
		// ZIP の出力先。一時ディレクトリの中
		const fakeOutput   = path.join(tempRoot, 'portable-out');

		fs.mkdirSync(path.join(fakeUnpacked, 'resources'), { recursive: true });
		fs.writeFileSync(path.join(fakeUnpacked, 'TmsAppLauncher.exe'), 'exe', 'utf8');
		fs.writeFileSync(path.join(fakeUnpacked, 'app-update.yml'), 'should-exclude', 'utf8');
		fs.writeFileSync(path.join(fakeUnpacked, 'resources', 'app.asar'), 'asar', 'utf8');
		fs.mkdirSync(path.join(fakeUnpacked, 'data'), { recursive: true });
		fs.writeFileSync(path.join(fakeUnpacked, 'data', 'launcher-data.json'), '{}', 'utf8');

		// パッケージスクリプトの結果。status が 0 以外なら失敗
		const packed = spawnSync('pwsh', ['-NoProfile', '-File', path.join(rootDir, 'scripts', 'package-portable.ps1'), '-ProjectRoot', rootDir, '-Version', '9.9.9-test', '-WinUnpackedDir', fakeUnpacked, '-OutputDir', fakeOutput], {
			// 標準出力を文字列で受け取る。コンソールのコードページには依存しない
			encoding: 'utf8'
		});

		assert.equal(packed.status, 0, packed.stderr || packed.stdout);
		// できた ZIP。バージョンはテスト用の 9.9.9-test
		const zipPath  = path.join(fakeOutput, 'TmsAppLauncher-9.9.9-test-portable-x64.zip');
		// ZIP の SHA-256 を書いた隣のファイル
		const hashPath = `${zipPath}.sha256`;

		assert.equal(fs.existsSync(zipPath), true);
		assert.equal(fs.existsSync(hashPath), true);

		// ZIP のバイト列。ハッシュ計算の入力
		const zipBuffer = fs.readFileSync(zipPath);
		// 計算した SHA-256。16 進小文字
		const digest    = crypto.createHash('sha256').update(zipBuffer).digest('hex');
		// .sha256 ファイルの本文。末尾改行は除く
		const hashText  = fs.readFileSync(hashPath, 'utf8').trim();

		assert.equal(hashText, `${digest}  TmsAppLauncher-9.9.9-test-portable-x64.zip`);

		// ZIP エントリ一覧の取得結果。status が 0 以外なら失敗
		const listing = spawnSync('pwsh', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}'); $z.Entries.FullName; $z.Dispose()`], {
			// エントリ名を文字列で受け取る
			encoding: 'utf8'
		});

		assert.equal(listing.status, 0, listing.stderr || listing.stdout);

		// スラッシュ区切りにしたエントリ名。空行は含まない
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
