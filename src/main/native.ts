/**
 * 実行ファイルの存在、アイコン、製品名、ショートカットの解決を Windows 側へ問い合わせる
 * アイコンのディスク保存は icon-cache に渡し、このファイルは抽出結果を返す
 * @file
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, nativeImage, shell } from 'electron';
import { buildResolvedIconCacheKey, readIconFromDiskCache, writeIconToDiskCache } from './icon-cache';
import { logger } from './logger';
import type { ProductInfo } from './types';

/** execFile を Promise 化した実行関数 */
const execFileAsync = promisify(execFile);

/** ショートカット読込失敗ログの出力モード */
type ShortcutReadFailureLogMode = 'always' | 'once' | 'silent';

/** ショートカット読込失敗を一度だけ出すためのキー集合 */
const loggedShortcutReadFailures = new Set<string>();

/** PowerShell テキスト出力の UTF-8 前置宣言 */
const POWERSHELL_UTF8_PREFIX = ['[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)', '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)'].join('; ');

/**
 * PowerShell を UTF-8 出力で実行する
 * @param {string} command 実行コマンド
 * @param {number} [timeout=10000] タイムアウト（ms）
 * @returns {Promise<string>} 標準出力
 */
async function runPowerShellUtf8(command: string, timeout = 10000): Promise<string> {
	// UTF-8 宣言を先頭に付けたコマンド
	const script     = `${POWERSHELL_UTF8_PREFIX}; ${command}`;
	// powershell.exe の標準出力。失敗時は reject される
	const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
		// コンソールウィンドウを出さない
		windowsHide: true,
		// 待ち時間。単位はミリ秒
		timeout,
		// 標準出力の文字コード
		encoding: 'utf8',
		// 標準出力の上限。単位はバイト
		maxBuffer: 10 * 1024 * 1024
	});

	return stdout.trim();
}

/**
 * 製品名として利用可能な文字列か判定する
 * @param {string} value 文字列
 * @returns {boolean} 利用可能なら true
 */
function isReadableProductText(value: string): boolean {
	// 空、または空白だけである
	if (!value || !value.trim()) {
		return false;
	}

	// 置換不能文字を含み、文字化けしている
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
	// 入力が空、または文字列でない
	if (!filePath || typeof filePath !== 'string') {
		return '';
	}

	// 前後空白を除いたパス。このあとクォートと環境変数を外す
	let normalized = filePath.trim();

	// 長さが 2 以上であり、かつ先頭と末尾がダブルクォートである。どれか欠けると外さない
	if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
		normalized = normalized.slice(1, -1).trim();
	}

	// Windows のときだけ %VAR% を環境変数へ展開する
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
		// stat が EACCES になり、fs.existsSync() では存在していても false になる
		// F_OK のアクセス確認なら、通常ファイルと実行エイリアスの両方を判定できる
		fs.accessSync(filePath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * アイコン抽出の 1 回分。method の順に試し、先に取れたものを使う
 */
interface IconRequest {
	/** 抽出対象のファイルパス */
	path: string;
	/** 実行ファイル内のアイコン番号。method が indexed のときだけ使う */
	iconIndex?: number;
	/** associated は関連付け、indexed は番号指定、electron は Electron API、image は画像ファイル */
	method: 'associated' | 'indexed' | 'electron' | 'image';
}

/**
 * アイコン取得リクエスト一覧を構築する
 * @param {string} normalized 正規化済みパス
 * @returns {IconRequest[]} リクエスト一覧（優先順）
 */
function buildIconRequests(normalized: string): IconRequest[] {
	// ----------------------------------------------
	// ショートカットはリンク先とアイコン指定を優先する
	// ----------------------------------------------
	// 優先順に積む抽出候補。該当が無ければ空
	const requests: IconRequest[] = [];
	// 対象の拡張子。小文字
	const ext                     = path.extname(normalized).toLowerCase();

	// ショートカットである
	if (ext === '.lnk') {
		// ショートカット側のアイコンを関連アイコンより先に使うか。未採用は false
		let preferShortcutAssociated = false;

		try {
			// ショートカットの中身。読めなければ catch へ落ちる
			const link      = shell.readShortcutLink(normalized);
			// リンク先。未設定は空
			const target    = normalizeExecutablePath(link.target ?? '');
			// 比較用のリンク先。無いときは空
			const targetKey = target ? path.win32.normalize(target).toLowerCase() : '';

			// リンク先と同じ既定アイコン。後回しにしないときは null
			let deferredTargetIcon: IconRequest | null = null;

			// 独自アイコンが指定されている
			if (link.icon) {
				// アイコンファイルの正規化パス。空なら未指定
				const iconPath = normalizeExecutablePath(link.icon);

				// アイコンパスがあり、かつディスク上に存在する
				if (iconPath && rawPathExists(iconPath)) {
					// 画像ファイルとして直接読める
					if (isImageIconFile(iconPath)) {
						requests.push({ path: iconPath, method: 'image' });
						preferShortcutAssociated = true;
					} else {
						// リソース番号で取るアイコン。番号未指定は 0
						const indexedRequest: IconRequest = {
							// アイコンを含むファイル
							path: iconPath,
							// リソース内の番号。未指定は 0
							iconIndex: link.iconIndex ?? 0,
							// 番号指定の抽出
							method: 'indexed'
						};

						// 比較用のアイコンパス。小文字
						const iconKey = path.win32.normalize(iconPath).toLowerCase();

						// リンク先があり、アイコンが同じファイルであり、かつ番号が 0 である
						if (targetKey && iconKey === targetKey && (link.iconIndex ?? 0) === 0) {
							deferredTargetIcon = indexedRequest;
						} else {
							requests.push(indexedRequest);
							preferShortcutAssociated = true;
						}
					}
				}
			}

			// ショートカット自身の関連アイコンを先に使う
			if (preferShortcutAssociated) {
				requests.push({ path: normalized, method: 'associated' });
			}

			// リンク先があり、かつディスク上に存在する
			if (target && rawPathExists(target)) {
				requests.push({ path: target, method: 'electron' });

				// 後回しにしたリンク先アイコンがある
				if (deferredTargetIcon) {
					requests.push(deferredTargetIcon);
				}

				requests.push({ path: target, method: 'associated' });
			}
		} catch {
			// ショートカット解決失敗時は .lnk 本体のみ試行
		}

		// ショートカット側のアイコンを優先していない
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
	// 正規化済みパス。空なら判定しない
	const normalized = normalizeExecutablePath(filePath);

	// パスが空である
	if (!normalized) {
		return false;
	}

	// 拡張子。小文字
	const ext = path.extname(normalized).toLowerCase();
	return ext === '.exe' || ext === '.lnk';
}

/**
 * ファイルが存在するか判定する
 * @param {string} filePath ファイルパス
 * @returns {boolean} 存在すれば true
 */
export function pathExists(filePath: string): boolean {
	// 正規化済みパス。空なら存在しないものとして扱う
	const normalized = normalizeExecutablePath(filePath);

	// パスが空である
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
	// 画像ファイルがディスク上に無い
	if (!rawPathExists(filePath)) {
		return null;
	}

	// PowerShell の単一引用符を重ねたパス
	const escapedPath = filePath.replace(/'/g, "''");
	// 拡張子。小文字。ico とそれ以外で読み方が違う
	const ext         = path.extname(filePath).toLowerCase();
	// 書き出す一辺。単位は px
	const outputSize  = 48;

	// System.Drawing で Icon を作る行。拡張子で中身が変わる
	let loadIcon: string;

	// ICO である
	if (ext === '.ico') {
		loadIcon = `$icon = New-Object System.Drawing.Icon('${escapedPath}')`;
	} else {
		loadIcon = `$img = [System.Drawing.Image]::FromFile('${escapedPath}'); $icon = [System.Drawing.Icon]::FromHandle(([System.Drawing.Bitmap]$img).GetHicon())`;
	}

	// PNG へ描画する PowerShell。ico とそれ以外で読み込み行が違う
	const script = `
# 失敗したら止める。警告で続行しない
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
${loadIcon}
# アイコンを読めなかった。PNG は作らず終了コード 2
if ($null -eq $icon) { exit 2 }
# 書き出す一辺。単位は px
$size = ${outputSize}
# 透過 PNG の描画先
$bmp = New-Object System.Drawing.Bitmap $size, $size
# 描画コンテキスト。使い終わってもここでは破棄しない
$g = [System.Drawing.Graphics]::FromImage($bmp)
# 縮小しても輪郭が荒れにくい補間
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
# 縁を滑らかにする
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$g.DrawIcon($icon, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
# PNG のバイト列を受けるメモリ
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
`;

	try {
		// PowerShell が書いた Base64。失敗や空出力は null
		const stdout = await runPowerShellUtf8(script, 15000);

		// Base64 が空である
		if (!stdout) {
			return null;
		}

		return `data:image/png;base64,${stdout}`;
	} catch (error) {
		logger.warn('PowerShell image file load failed', {
			// 読めなかった画像
			path: filePath,
			// 失敗理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
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
	// 画像ファイルがディスク上に無い
	if (!rawPathExists(filePath)) {
		return null;
	}

	// パスと更新時刻からなるキャッシュキー。ファイルが変わると別キー
	const cacheKey = `img:${filePath}:${getFileMtime(filePath)}`;

	// 同じファイルをすでに変換済みである
	if (iconCache.has(cacheKey)) {
		return iconCache.get(cacheKey) ?? null;
	}

	try {
		// パスから読んだ画像。失敗時は空画像
		const image = nativeImage.createFromPath(filePath);

		// 画素がある
		if (!image.isEmpty()) {
			// 元の幅と高さ。単位は px
			const size    = image.getSize();
			// 長辺が 48px を超えるときだけ縮小した画像
			const target  = Math.max(size.width, size.height) > 48 ? image.resize({ width: 48, height: 48 }) : image;
			// PNG の Data URL
			const dataUrl = target.toDataURL();

			iconCache.set(cacheKey, dataUrl);
			return dataUrl;
		}
	} catch (error) {
		logger.warn('nativeImage load failed', {
			// 読めなかった画像
			path: filePath,
			// 失敗理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
		});
	}

	// Electron で読めないときの PowerShell 結果。失敗時は null
	const fallback = await extractImageFileViaPowerShell(filePath);

	// PowerShell が Data URL を返した
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
async function extractIconViaPowerShell(filePath: string, iconIndex?: number): Promise<string | null> {
	// 対象ファイルがディスク上に無い
	if (!rawPathExists(filePath)) {
		return null;
	}

	// 番号指定か関連アイコンか。番号が無いときは assoc
	const cacheScope = iconIndex !== undefined ? `idx:${iconIndex}` : 'assoc';
	// 抽出方法、パス、更新時刻からなるキャッシュキー
	const cacheKey   = `ps:${cacheScope}:${filePath}:${getFileMtime(filePath)}`;

	// 同じ条件の抽出結果がメモリにある
	if (iconCache.has(cacheKey)) {
		return iconCache.get(cacheKey) ?? null;
	}

	// PowerShell の単一引用符を重ねたパス
	const escapedPath      = filePath.replace(/'/g, "''");
	// 書き出す一辺。単位は px
	const outputSize       = 48;
	// 番号があり、0 以上であり、かつショートカットでない。どれか欠けると関連アイコン
	const useExtractIconEx = iconIndex !== undefined && iconIndex >= 0 && path.extname(filePath).toLowerCase() !== '.lnk';

	// アイコン取得までの PowerShell。番号指定と関連アイコンで分かれる
	let scriptHead: string;

	// ExtractIconEx で番号指定する
	if (useExtractIconEx) {
		scriptHead = `
# 失敗したら止める。警告で続行しない
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
# アイコンを取る実行ファイル
$p = '${escapedPath}'
# 実行ファイル内のアイコン番号。0 以上
$idx = ${iconIndex}
# 大きいアイコンの受け口。取れなければゼロ
$large = @([IntPtr]::Zero)
# 取れた個数。0 なら失敗
$n = [TmsIconExtract]::ExtractIconEx($p, $idx, $large, $null, 1)
# 個数が 0、またはハンドルがゼロ。どちらかなら PNG は作らず終了コード 2
if ($n -eq 0 -or $large[0] -eq [IntPtr]::Zero) { exit 2 }
# 番号指定で取れたアイコン
$icon = [System.Drawing.Icon]::FromHandle($large[0])
`;
	} else {
		scriptHead = `
# 失敗したら止める。警告で続行しない
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# 関連付けからアイコンを取るファイル
$p = '${escapedPath}'
# 関連付けアイコン。無いときは null
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p)
# 関連付けアイコンが無い。PNG は作らず終了コード 2
if ($null -eq $icon) { exit 2 }
`;
	}

	// PNG 化までを行う PowerShell の末尾。先頭の取得方法とは独立
	const scriptTail = `
# 書き出す一辺。単位は px
$size = ${outputSize}
# 透過 PNG の描画先
$bmp = New-Object System.Drawing.Bitmap $size, $size
# 描画コンテキスト
$g = [System.Drawing.Graphics]::FromImage($bmp)
# 縮小しても輪郭が荒れにくい補間
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
# 縁を滑らかにする
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$g.DrawIcon($icon, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
# PNG のバイト列を受けるメモリ
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
`;

	try {
		// PowerShell の標準出力。空なら抽出失敗
		const stdout = await runPowerShellUtf8(scriptHead + scriptTail, 15000);
		// PNG の Base64。前後空白を含む生の出力
		const base64 = stdout;

		// Base64 が空である
		if (!base64) {
			return null;
		}

		// レンダラーへ渡す Data URL
		const dataUrl = `data:image/png;base64,${base64}`;

		iconCache.set(cacheKey, dataUrl);
		return dataUrl;
	} catch (error) {
		logger.warn('PowerShell icon extraction failed', {
			// 抽出できなかったファイル
			path: filePath,
			// 指定番号。関連アイコンのときは null
			iconIndex: iconIndex ?? null,
			// 失敗理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
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
	// 対象ファイルがディスク上に無い
	if (!rawPathExists(filePath)) {
		return null;
	}

	// ショートカットは Electron の getFileIcon を使わない
	if (path.extname(filePath).toLowerCase() === '.lnk') {
		return null;
	}

	// 画像ファイルは別経路で読む
	if (isImageIconFile(filePath)) {
		return null;
	}

	// パスと更新時刻からなるキャッシュキー
	const cacheKey = `electron:${filePath}:${getFileMtime(filePath)}`;

	// 同じファイルの結果がメモリにある
	if (iconCache.has(cacheKey)) {
		return iconCache.get(cacheKey) ?? null;
	}

	try {
		// OS が返す大きいアイコン
		const image   = await app.getFileIcon(filePath, { size: 'large' });
		// PNG の Data URL
		const dataUrl = image.toDataURL();

		iconCache.set(cacheKey, dataUrl);
		return dataUrl;
	} catch (error) {
		logger.warn('Electron icon extraction failed', {
			// 抽出できなかったファイル
			path: filePath,
			// 失敗理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
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
	// 対象ファイルがディスク上に無い
	if (!rawPathExists(request.path)) {
		return null;
	}

	// Electron API で取る
	if (request.method === 'electron') {
		return tryGetFileIconElectron(request.path);
	}

	// 画像ファイルとして読む
	if (request.method === 'image') {
		return tryGetImageFileDataUrl(request.path);
	}

	// 番号が指定されている
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
	// ----------------------------------------------
	// メモリとディスクのキャッシュを見る
	// ----------------------------------------------
	// 正規化済みパス。空なら取得しない
	const normalized = normalizeExecutablePath(filePath);

	// パスが空である
	if (!normalized) {
		return null;
	}

	// パスと更新時刻からなる解決済みキャッシュのキー
	const resolvedCacheKey = buildResolvedIconCacheKey(normalized, getFileMtime(normalized));

	// 同じファイルの Data URL がメモリにある
	if (iconCache.has(resolvedCacheKey)) {
		return iconCache.get(resolvedCacheKey) ?? null;
	}

	// ディスクに残っている Data URL。無ければ null
	const cachedOnDisk = readIconFromDiskCache(resolvedCacheKey);

	// ディスクキャッシュがヒットした
	if (cachedOnDisk) {
		iconCache.set(resolvedCacheKey, cachedOnDisk);
		return cachedOnDisk;
	}

	// ----------------------------------------------
	// 画像か、実行ファイルのアイコンを抽出する
	// ----------------------------------------------
	// 画像ファイルである
	if (isImageIconFile(normalized)) {
		// 画像から得た Data URL。失敗時は null
		const imageDataUrl = await tryGetImageFileDataUrl(normalized);

		// 画像の Data URL を得られた
		if (imageDataUrl) {
			return rememberResolvedIcon(resolvedCacheKey, imageDataUrl);
		}
	}

	// 優先順の抽出候補
	const requests = buildIconRequests(normalized);

	for (const request of requests) {
		// この候補の Data URL。失敗時は null
		const dataUrl = await tryIconRequest(request);

		// 候補から Data URL を得られた
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
	// ----------------------------------------------
	// 拡張子に応じて製品情報を取る
	// ----------------------------------------------
	// 正規化済みパス。空なら製品情報を取れない
	const normalized            = normalizeExecutablePath(filePath);
	// 取得できないときの空の製品情報
	const fallback: ProductInfo = {
		// ファイル説明。取れないときは空
		fileDescription: '',
		// 製品名。取れないときは空
		productName: ''
	};

	// パスが空、またはディスク上に無い
	if (!normalized || !rawPathExists(normalized)) {
		return fallback;
	}

	// 拡張子。小文字
	const ext = path.extname(normalized).toLowerCase();

	// ショートカットである
	if (ext === '.lnk') {
		try {
			// ショートカットの中身
			const link   = shell.readShortcutLink(normalized);
			// リンク先。未設定は空
			const target = normalizeExecutablePath(link.target);

			// リンク先があり、存在し、かつ exe である
			if (target && rawPathExists(target) && path.extname(target).toLowerCase() === '.exe') {
				return getProductInfo(target);
			}
		} catch {
			// ショートカット名をフォールバック
		}

		return {
			// ショートカットのファイル名を説明の代わりに使う
			fileDescription: getBaseNameWithoutExt(normalized),
			// 製品名は不明
			productName: ''
		};
	}

	// exe 以外である
	if (ext !== '.exe') {
		return {
			// ファイル名を説明の代わりに使う
			fileDescription: getBaseNameWithoutExt(normalized),
			// 製品名は不明
			productName: ''
		};
	}

	// PowerShell の単一引用符を重ねたパス
	const escapedPath = normalized.replace(/'/g, "''");

	try {
		// VersionInfo の JSON。失敗時は catch へ落ちる
		const stdout = await runPowerShellUtf8(`(Get-Item -LiteralPath '${escapedPath}').VersionInfo | Select-Object FileDescription,ProductName | ConvertTo-Json -Compress`);

		// 解析した FileDescription と ProductName。欠落時は未設定
		const parsed = JSON.parse(stdout) as {
			FileDescription?: string;
			ProductName?: string;
		};

		return {
			// ファイル説明。空白だけなら空
			fileDescription: (parsed.FileDescription ?? '').trim(),
			// 製品名。空白だけなら空
			productName: (parsed.ProductName ?? '').trim()
		};
	} catch (error) {
		logger.warn('Product info extraction failed', {
			// 読めなかったファイル
			path: filePath,
			// 失敗理由。Error 以外は文字列化する
			error: error instanceof Error ? error.message : String(error)
		});

		return {
			// ファイル名を説明の代わりに使う
			fileDescription: getBaseNameWithoutExt(normalized),
			// 製品名は不明
			productName: ''
		};
	}
}

/**
 * アプリ名を自動取得する（優先順位: FileDescription > ProductName > ファイル名）
 * @param {string} filePath exe/lnk パス
 * @returns {Promise<string>} アプリ名
 */
export async function resolveAppName(filePath: string): Promise<string> {
	// 正規化済みパス。空なら名前を決められない
	const normalized = normalizeExecutablePath(filePath);

	// パスが空である
	if (!normalized) {
		return '';
	}

	// 拡張子。小文字
	const ext            = path.extname(normalized).toLowerCase();
	// ショートカットの表示名。lnk 以外は空
	const lnkDisplayName = ext === '.lnk' ? getBaseNameWithoutExt(normalized) : '';
	// ファイル説明と製品名。取れない項目は空
	const info           = await getProductInfo(normalized);

	// ファイル説明が製品名として使える
	if (isReadableProductText(info.fileDescription)) {
		return info.fileDescription;
	}

	// 製品名が使える
	if (isReadableProductText(info.productName)) {
		return info.productName;
	}

	// ショートカット名がある
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
	options?: { failureLogMode?: ShortcutReadFailureLogMode }
): Promise<{
	target: string;
	args: string;
	cwd: string;
	appUserModelId: string;
} | null> {
	// 正規化済みの lnk パス。空なら読めない
	const normalized = normalizeExecutablePath(lnkPath);

	// パスが空である
	if (!normalized) {
		return null;
	}

	try {
		// シェルが読んだショートカット
		const link = shell.readShortcutLink(normalized);

		return {
			// リンク先。未設定は空
			target: normalizeExecutablePath(link.target),
			// 引数。未設定は空
			args: link.args ?? '',
			// 作業ディレクトリ。未設定は空
			cwd: normalizeExecutablePath(link.cwd ?? ''),
			// AppUserModelID。未設定は空
			appUserModelId: link.appUserModelId ?? ''
		};
	} catch (error) {
		// ログへ出す失敗理由。Error 以外は文字列化する
		const message        = error instanceof Error ? error.message : String(error);
		// ログの出し方。未指定は毎回
		const failureLogMode = options?.failureLogMode ?? 'always';
		// 同じ失敗を一度だけにするためのキー
		const logKey         = `${normalized.toLowerCase()}\n${message}`;
		// always、または once かつ未出力である
		const shouldLog      = failureLogMode === 'always' || (failureLogMode === 'once' && !loggedShortcutReadFailures.has(logKey));

		// この失敗をログへ出す
		if (shouldLog) {
			loggedShortcutReadFailures.add(logKey);
			logger.warn('Shortcut read failed', {
				// 読めなかったショートカット
				path: normalized,
				// 失敗理由
				error: message
			});
		}

		return null;
	}
}
