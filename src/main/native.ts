import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, nativeImage, shell } from 'electron';
import {
	buildResolvedIconCacheKey,
	readIconFromDiskCache,
	writeIconToDiskCache,
} from './icon-cache';
import { logger } from './logger';
import type { ProductInfo } from './types';

const execFileAsync = promisify(execFile);

/** ショートカット読込失敗ログの出力モード */
type ShortcutReadFailureLogMode = 'always' | 'once' | 'silent';

/** ショートカット読込失敗を一度だけ出すためのキー集合 */
const loggedShortcutReadFailures = new Set<string>();

/** PowerShell テキスト出力の UTF-8 前置宣言 */
const POWERSHELL_UTF8_PREFIX = [
	'[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
	'$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
].join('; ');

/**
 * PowerShell を UTF-8 出力で実行する
 * @param {string} command 実行コマンド
 * @param {number} [timeout=10000] タイムアウト（ms）
 * @returns {Promise<string>} 標準出力
 */
async function runPowerShellUtf8(command: string, timeout = 10000): Promise<string> {
	const script     = `${POWERSHELL_UTF8_PREFIX}; ${command}`;
	const { stdout } = await execFileAsync(
		'powershell.exe',
		['-NoProfile', '-Command', script],
		{
			windowsHide: true,
			timeout,
			encoding   : 'utf8',
			maxBuffer  : 10 * 1024 * 1024,
		},
	);

	return stdout.trim();
}

/**
 * 製品名として利用可能な文字列か判定する
 * @param {string} value 文字列
 * @returns {boolean} 利用可能なら true
 */
function isReadableProductText(value: string): boolean {
	if (!value || !value.trim()) {
		return false;
	}

	if (value.includes('\uFFFD')) {
		return false;
	}

	return !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value);
}

/** 画像ファイルとして直接読み込める拡張子 */
const IMAGE_ICON_EXTENSIONS = new Set(['.ico', '.png', '.webp', '.jpg', '.jpeg']);

/**
 * 画像ファイルパスか判定する
 * @param {string} filePath ファイルパス
 * @returns {boolean} 画像ファイルなら true
 */
function isImageIconFile(filePath: string): boolean {
	return IMAGE_ICON_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** アイコンキャッシュ（path + mtime をキー） */
const iconCache = new Map<string, string>();

/**
 * 実行パスを正規化する（trim・両端クォート除去・環境変数展開）
 * @param {string} filePath 入力パス
 * @returns {string} 正規化後パス
 */
export function normalizeExecutablePath(filePath: string): string {
	if (!filePath || typeof filePath !== 'string') {
		return '';
	}

	let normalized = filePath.trim();

	if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
		normalized = normalized.slice(1, -1).trim();
	}

	if (process.platform === 'win32') {
		normalized = normalized.replace(/%([^%]+)%/g, (match, varName: string) => {
			return process.env[varName] ?? match;
		});
	}

	return normalized;
}

/**
 * ファイルの mtime を取得する
 * @param {string} filePath ファイルパス
 * @returns {number} mtime（ミリ秒）
 */
function getFileMtime(filePath: string): number {
	try {
		return fs.statSync(filePath).mtimeMs;
	} catch {
		return 0;
	}
}

/**
 * 正規化済みパスがディスク上に存在するか判定する
 * @param {string} filePath 正規化済みパス
 * @returns {boolean} 存在すれば true
 */
function rawPathExists(filePath: string): boolean {
	try {
		// Windows の App Execution Alias（Microsoft Store アプリの実行エイリアス）は
		// stat が EACCES になり、fs.existsSync() では存在していても false になる。
		// F_OK のアクセス確認なら、通常ファイルと実行エイリアスの両方を判定できる。
		fs.accessSync(filePath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * アイコン取得リクエスト
 */
interface IconRequest {
	path: string;
	iconIndex?: number;
	method: 'associated' | 'indexed' | 'electron' | 'image';
}

/**
 * アイコン取得リクエスト一覧を構築する
 * @param {string} normalized 正規化済みパス
 * @returns {IconRequest[]} リクエスト一覧（優先順）
 */
function buildIconRequests(normalized: string): IconRequest[] {
	const requests: IconRequest[] = [];
	const ext                     = path.extname(normalized).toLowerCase();

	if (ext === '.lnk') {
		let preferShortcutAssociated = false;

		try {
			const link                                 = shell.readShortcutLink(normalized);
			const target                               = normalizeExecutablePath(link.target ?? '');
			const targetKey                            = target ? path.win32.normalize(target).toLowerCase() : '';
			let deferredTargetIcon: IconRequest | null = null;

			if (link.icon) {
				const iconPath = normalizeExecutablePath(link.icon);

				if (iconPath && rawPathExists(iconPath)) {
					if (isImageIconFile(iconPath)) {
						requests.push({ path: iconPath, method: 'image' });
						preferShortcutAssociated = true;
					} else {
						const indexedRequest: IconRequest = {
							path     : iconPath,
							iconIndex: link.iconIndex ?? 0,
							method   : 'indexed',
						};
						const iconKey                     = path.win32.normalize(iconPath).toLowerCase();

						if (targetKey && iconKey === targetKey && (link.iconIndex ?? 0) === 0) {
							deferredTargetIcon = indexedRequest;
						} else {
							requests.push(indexedRequest);
							preferShortcutAssociated = true;
						}
					}
				}
			}

			if (preferShortcutAssociated) {
				requests.push({ path: normalized, method: 'associated' });
			}

			if (target && rawPathExists(target)) {
				requests.push({ path: target, method: 'electron' });

				if (deferredTargetIcon) {
					requests.push(deferredTargetIcon);
				}

				requests.push({ path: target, method: 'associated' });
			}
		} catch {
			// ショートカット解決失敗時は .lnk 本体のみ試行
		}

		if (!preferShortcutAssociated) {
			requests.push({ path: normalized, method: 'associated' });
		}

		return requests;
	}

	requests.push({ path: normalized, method: 'electron' });
	requests.push({ path: normalized, method: 'associated' });

	return requests;
}

/**
 * パスが exe または lnk か検証する
 * @param {string} filePath ファイルパス
 * @returns {boolean} 有効なら true
 */
export function isValidExecutablePath(filePath: string): boolean {
	const normalized = normalizeExecutablePath(filePath);

	if (!normalized) {
		return false;
	}

	const ext = path.extname(normalized).toLowerCase();
	return ext === '.exe' || ext === '.lnk';
}

/**
 * ファイルが存在するか判定する
 * @param {string} filePath ファイルパス
 * @returns {boolean} 存在すれば true
 */
export function pathExists(filePath: string): boolean {
	const normalized = normalizeExecutablePath(filePath);

	if (!normalized) {
		return false;
	}

	return rawPathExists(normalized);
}

/**
 * 画像ファイルを PowerShell で PNG Base64 として読み込む
 * @param {string} filePath 画像パス
 * @returns {Promise<string | null>} Data URL
 */
async function extractImageFileViaPowerShell(filePath: string): Promise<string | null> {
	if (!rawPathExists(filePath)) {
		return null;
	}

	const escapedPath = filePath.replace(/'/g, "''");
	const ext         = path.extname(filePath).toLowerCase();
	const outputSize  = 48;

	let loadIcon: string;

	if (ext === '.ico') {
		loadIcon = `$icon = New-Object System.Drawing.Icon('${escapedPath}')`;
	} else {
		loadIcon = `$img = [System.Drawing.Image]::FromFile('${escapedPath}'); $icon = [System.Drawing.Icon]::FromHandle(([System.Drawing.Bitmap]$img).GetHicon())`;
	}

	const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
${loadIcon}
if ($null -eq $icon) { exit 2 }
$size = ${outputSize}
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$g.DrawIcon($icon, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
`;

	try {
		const stdout = await runPowerShellUtf8(script, 15000);

		if (!stdout) {
			return null;
		}

		return `data:image/png;base64,${stdout}`;
	} catch (error) {
		logger.warn('PowerShell image file load failed', {
			path : filePath,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * 画像ファイル（ico/png 等）を Data URL として取得する
 * @param {string} filePath 画像パス
 * @returns {Promise<string | null>} Data URL
 */
async function tryGetImageFileDataUrl(filePath: string): Promise<string | null> {
	if (!rawPathExists(filePath)) {
		return null;
	}

	const cacheKey = `img:${filePath}:${getFileMtime(filePath)}`;

	if (iconCache.has(cacheKey)) {
		return iconCache.get(cacheKey) ?? null;
	}

	try {
		const image = nativeImage.createFromPath(filePath);

		if (!image.isEmpty()) {
			const size    = image.getSize();
			const target  = Math.max(size.width, size.height) > 48
				? image.resize({ width: 48, height: 48 })
				: image;
			const dataUrl = target.toDataURL();

			iconCache.set(cacheKey, dataUrl);
			return dataUrl;
		}
	} catch (error) {
		logger.warn('nativeImage load failed', {
			path : filePath,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const fallback = await extractImageFileViaPowerShell(filePath);

	if (fallback) {
		iconCache.set(cacheKey, fallback);
	}

	return fallback;
}

/**
 * ファイル名（拡張子なし）を取得する
 * @param {string} filePath ファイルパス
 * @returns {string} ファイル名
 */
export function getBaseNameWithoutExt(filePath: string): string {
	return path.basename(filePath, path.extname(filePath));
}

/**
 * PowerShell でアイコンを PNG Base64 として抽出する
 * @param {string} filePath ファイルパス
 * @param {number} [iconIndex] リソース内アイコンインデックス（省略時は関連アイコン）
 * @returns {Promise<string | null>} Data URL
 */
async function extractIconViaPowerShell(
	filePath: string,
	iconIndex?: number,
): Promise<string | null> {
	if (!rawPathExists(filePath)) {
		return null;
	}

	const cacheScope = iconIndex !== undefined ? `idx:${iconIndex}` : 'assoc';
	const cacheKey   = `ps:${cacheScope}:${filePath}:${getFileMtime(filePath)}`;

	if (iconCache.has(cacheKey)) {
		return iconCache.get(cacheKey) ?? null;
	}

	const escapedPath      = filePath.replace(/'/g, "''");
	const outputSize       = 48;
	const useExtractIconEx = iconIndex !== undefined
		&& iconIndex >= 0
		&& path.extname(filePath).toLowerCase() !== '.lnk';

	let scriptHead: string;

	if (useExtractIconEx) {
		scriptHead = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class TmsIconExtract {
	[DllImport("shell32.dll", CharSet = CharSet.Unicode)]
	public static extern uint ExtractIconEx(string lpszFile, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, uint nIcons);
}
'@
$p = '${escapedPath}'
$idx = ${iconIndex}
$large = @([IntPtr]::Zero)
$n = [TmsIconExtract]::ExtractIconEx($p, $idx, $large, $null, 1)
if ($n -eq 0 -or $large[0] -eq [IntPtr]::Zero) { exit 2 }
$icon = [System.Drawing.Icon]::FromHandle($large[0])
`;
	} else {
		scriptHead = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$p = '${escapedPath}'
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p)
if ($null -eq $icon) { exit 2 }
`;
	}

	const scriptTail = `
$size = ${outputSize}
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$g.DrawIcon($icon, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
`;

	try {
		const stdout = await runPowerShellUtf8(scriptHead + scriptTail, 15000);
		const base64 = stdout;

		if (!base64) {
			return null;
		}

		const dataUrl = `data:image/png;base64,${base64}`;

		iconCache.set(cacheKey, dataUrl);
		return dataUrl;
	} catch (error) {
		logger.warn('PowerShell icon extraction failed', {
			path     : filePath,
			iconIndex: iconIndex ?? null,
			error    : error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Electron API でアイコンを取得する（.lnk には使用しない）
 * @param {string} filePath 正規化済みパス
 * @returns {Promise<string | null>} Data URL
 */
async function tryGetFileIconElectron(filePath: string): Promise<string | null> {
	if (!rawPathExists(filePath)) {
		return null;
	}

	if (path.extname(filePath).toLowerCase() === '.lnk') {
		return null;
	}

	if (isImageIconFile(filePath)) {
		return null;
	}

	const cacheKey = `electron:${filePath}:${getFileMtime(filePath)}`;

	if (iconCache.has(cacheKey)) {
		return iconCache.get(cacheKey) ?? null;
	}

	try {
		const image   = await app.getFileIcon(filePath, { size: 'large' });
		const dataUrl = image.toDataURL();

		iconCache.set(cacheKey, dataUrl);
		return dataUrl;
	} catch (error) {
		logger.warn('Electron icon extraction failed', {
			path : filePath,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * アイコンリクエストを処理する
 * @param {IconRequest} request リクエスト
 * @returns {Promise<string | null>} Data URL
 */
async function tryIconRequest(request: IconRequest): Promise<string | null> {
	if (!rawPathExists(request.path)) {
		return null;
	}

	if (request.method === 'electron') {
		return tryGetFileIconElectron(request.path);
	}

	if (request.method === 'image') {
		return tryGetImageFileDataUrl(request.path);
	}

	if (request.method === 'indexed' && request.iconIndex !== undefined) {
		return extractIconViaPowerShell(request.path, request.iconIndex);
	}

	return extractIconViaPowerShell(request.path);
}

/**
 * 解決済みアイコンをメモリ／永続キャッシュへ保存する
 * @param {string} cacheKey キャッシュキー
 * @param {string} dataUrl Data URL
 * @returns {string} Data URL
 */
function rememberResolvedIcon(cacheKey: string, dataUrl: string): string {
	iconCache.set(cacheKey, dataUrl);
	writeIconToDiskCache(cacheKey, dataUrl);
	return dataUrl;
}

/**
 * アイコンを Data URL として取得する
 * @param {string} filePath exe/lnk または画像パス
 * @returns {Promise<string | null>} Data URL（失敗時 null）
 */
export async function getIconDataUrl(filePath: string): Promise<string | null> {
	const normalized = normalizeExecutablePath(filePath);

	if (!normalized) {
		return null;
	}

	const resolvedCacheKey = buildResolvedIconCacheKey(normalized, getFileMtime(normalized));

	if (iconCache.has(resolvedCacheKey)) {
		return iconCache.get(resolvedCacheKey) ?? null;
	}

	const cachedOnDisk = readIconFromDiskCache(resolvedCacheKey);

	if (cachedOnDisk) {
		iconCache.set(resolvedCacheKey, cachedOnDisk);
		return cachedOnDisk;
	}

	if (isImageIconFile(normalized)) {
		const imageDataUrl = await tryGetImageFileDataUrl(normalized);

		if (imageDataUrl) {
			return rememberResolvedIcon(resolvedCacheKey, imageDataUrl);
		}
	}

	const requests = buildIconRequests(normalized);

	for (const request of requests) {
		const dataUrl = await tryIconRequest(request);

		if (dataUrl) {
			return rememberResolvedIcon(resolvedCacheKey, dataUrl);
		}
	}

	return null;
}

/**
 * PowerShell で FileDescription / ProductName を取得する
 * @param {string} filePath exe パス
 * @returns {Promise<ProductInfo>} 製品情報
 */
export async function getProductInfo(filePath: string): Promise<ProductInfo> {
	const normalized            = normalizeExecutablePath(filePath);
	const fallback: ProductInfo = {
		fileDescription: '',
		productName    : '',
	};

	if (!normalized || !rawPathExists(normalized)) {
		return fallback;
	}

	const ext = path.extname(normalized).toLowerCase();

	if (ext === '.lnk') {
		try {
			const link   = shell.readShortcutLink(normalized);
			const target = normalizeExecutablePath(link.target);

			if (target && rawPathExists(target) && path.extname(target).toLowerCase() === '.exe') {
				return getProductInfo(target);
			}
		} catch {
			// ショートカット名をフォールバック
		}

		return {
			fileDescription: getBaseNameWithoutExt(normalized),
			productName    : '',
		};
	}

	if (ext !== '.exe') {
		return {
			fileDescription: getBaseNameWithoutExt(normalized),
			productName    : '',
		};
	}

	const escapedPath = normalized.replace(/'/g, "''");

	try {
		const stdout = await runPowerShellUtf8(
			`(Get-Item -LiteralPath '${escapedPath}').VersionInfo | Select-Object FileDescription,ProductName | ConvertTo-Json -Compress`,
		);

		const parsed = JSON.parse(stdout) as {
			FileDescription?: string;
			ProductName?: string;
		};

		return {
			fileDescription: (parsed.FileDescription ?? '').trim(),
			productName    : (parsed.ProductName ?? '').trim(),
		};
	} catch (error) {
		logger.warn('Product info extraction failed', {
			path : filePath,
			error: error instanceof Error ? error.message : String(error),
		});

		return {
			fileDescription: getBaseNameWithoutExt(normalized),
			productName    : '',
		};
	}
}

/**
 * アプリ名を自動取得する（優先順位: FileDescription > ProductName > ファイル名）
 * @param {string} filePath exe/lnk パス
 * @returns {Promise<string>} アプリ名
 */
export async function resolveAppName(filePath: string): Promise<string> {
	const normalized = normalizeExecutablePath(filePath);

	if (!normalized) {
		return '';
	}

	const ext            = path.extname(normalized).toLowerCase();
	const lnkDisplayName = ext === '.lnk' ? getBaseNameWithoutExt(normalized) : '';
	const info           = await getProductInfo(normalized);

	if (isReadableProductText(info.fileDescription)) {
		return info.fileDescription;
	}

	if (isReadableProductText(info.productName)) {
		return info.productName;
	}

	if (lnkDisplayName) {
		return lnkDisplayName;
	}

	return getBaseNameWithoutExt(normalized);
}

/**
 * ショートカット情報を読み込む
 * @param {string} lnkPath lnk パス
 * @param {{ failureLogMode?: ShortcutReadFailureLogMode }} [options] ログ出力設定
 * @returns {Promise<{ target: string; args: string; cwd: string; appUserModelId: string } | null>} 解決結果
 */
export async function readShortcut(
	lnkPath: string,
	options?: { failureLogMode?: ShortcutReadFailureLogMode },
): Promise<{
	target: string;
	args: string;
	cwd: string;
	appUserModelId: string;
} | null> {
	const normalized = normalizeExecutablePath(lnkPath);

	if (!normalized) {
		return null;
	}

	try {
		const link = shell.readShortcutLink(normalized);

		return {
			target        : normalizeExecutablePath(link.target),
			args          : link.args ?? '',
			cwd           : normalizeExecutablePath(link.cwd ?? ''),
			appUserModelId: link.appUserModelId ?? '',
		};
	} catch (error) {
		const message        = error instanceof Error ? error.message : String(error);
		const failureLogMode = options?.failureLogMode ?? 'always';
		const logKey         = `${normalized.toLowerCase()}\n${message}`;
		const shouldLog      = failureLogMode === 'always'
			|| (
				failureLogMode === 'once'
				&& !loggedShortcutReadFailures.has(logKey)
			);

		if (shouldLog) {
			loggedShortcutReadFailures.add(logKey);
			logger.warn('Shortcut read failed', {
				path : normalized,
				error: message,
			});
		}

		return null;
	}
}
