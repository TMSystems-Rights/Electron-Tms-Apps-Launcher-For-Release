import { execFileSync } from 'node:child_process';
import type { BrowserWindow, TitleBarOverlay } from 'electron';
import { nativeTheme, screen, systemPreferences } from 'electron';
import { logger } from './logger';
import type { PaneCount } from './types';

/** 1ペインあたりの最小幅 */
export const MIN_PANE_WIDTH = 360;

/** ウィンドウ最小幅（1ペイン） */
export const MIN_WINDOW_WIDTH = MIN_PANE_WIDTH;

/** ウィンドウ最小幅（2ペイン） */
export const MIN_WINDOW_WIDTH_DUAL = MIN_PANE_WIDTH * 2;

/** ウィンドウ最小幅（3ペイン） */
export const MIN_WINDOW_WIDTH_TRIPLE = MIN_PANE_WIDTH * 3;

/** 2ペイン表示に必要なビューポート幅（後方互換） */
export const DUAL_PANE_VIEW_MIN_WIDTH = MIN_WINDOW_WIDTH_DUAL;

/** ウィンドウ最小高さ */
export const MIN_WINDOW_HEIGHT = 480;

/** ウィンドウ既定幅 */
export const DEFAULT_WINDOW_WIDTH = 480;

/** ウィンドウ既定高さ */
export const DEFAULT_WINDOW_HEIGHT = 720;

/** ウィンドウサイズ制限 */
export interface WindowSizeLimitValues {
	minWidth: number;
	minHeight: number;
	maxWidth: number;
	maxHeight: number;
}

/** カスタムタイトルバー高さ（titleBarOverlay） */
export const TITLE_BAR_OVERLAY_HEIGHT = 48;

/** Windows DWM レジストリキー */
const DWM_REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\DWM';

/** ウィンドウクローム色 */
export interface WindowChromeColors {
	activeBackground: string;
	activeText: string;
	inactiveBackground: string;
	inactiveText: string;
}

/**
 * CSS/Chromium で扱いやすい #RRGGBB へ正規化する
 * @param {string | undefined} color 色
 * @returns {string | null} 正規化した色
 */
function normalizeRgbColor(color: string | undefined): string | null {
	const match = color?.trim().match(/^#?([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/u);

	if (!match) {
		return null;
	}

	return `#${match[1].toLowerCase()}`;
}

/**
 * 色の相対輝度を返す
 * @param {string} color #RRGGBB 色
 * @returns {number} 相対輝度
 */
function getRelativeLuminance(color: string): number {
	const rgb = [1, 3, 5].map((index) => {
		const channel = parseInt(color.slice(index, index + 2), 16) / 255;

		return channel <= 0.03928
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});

	return (0.2126 * (rgb[0] ?? 0)) + (0.7152 * (rgb[1] ?? 0)) + (0.0722 * (rgb[2] ?? 0));
}

/**
 * 背景色に対して読みやすい文字色を返す
 * @param {string} background #RRGGBB 背景色
 * @returns {string} 文字色
 */
function resolveReadableTextColor(background: string): string {
	return getRelativeLuminance(background) > 0.45 ? '#000000' : '#ffffff';
}

/**
 * Windows の「タイトルバーとウィンドウの境界線にアクセントカラーを表示する」設定を読む
 * @returns {boolean | null} 有効なら true、取得できない場合は null
 */
function readWindowsTitleBarAccentEnabled(): boolean | null {
	if (process.platform !== 'win32') {
		return false;
	}

	try {
		const output = execFileSync(
			'reg.exe',
			['query', DWM_REGISTRY_KEY, '/v', 'ColorPrevalence'],
			{
				encoding   : 'utf8',
				timeout    : 1000,
				windowsHide: true,
			},
		);
		const match  = output.match(/ColorPrevalence\s+REG_DWORD\s+0x([0-9a-f]+)/iu);

		if (!match) {
			return null;
		}

		return parseInt(match[1] ?? '0', 16) === 1;
	} catch {
		return null;
	}
}

/**
 * 現在の外観設定に合わせた既定クローム色を返す
 * @param {'system' | 'dark' | 'light'} appearance 外観設定
 * @returns {WindowChromeColors} クローム色
 */
function resolveFallbackWindowChromeColors(
	appearance: 'system' | 'dark' | 'light',
): WindowChromeColors {
	const isDark = appearance === 'dark'
		|| (appearance === 'system' && nativeTheme.shouldUseDarkColors);

	if (isDark) {
		return {
			activeBackground  : '#2d2d2d',
			activeText        : '#f0f0f0',
			inactiveBackground: '#1f1f1f',
			inactiveText      : '#8a8a8a',
		};
	}

	return {
		activeBackground  : '#ffffff',
		activeText        : '#1a1a1a',
		inactiveBackground: '#ffffff',
		inactiveText      : '#555555',
	};
}

/**
 * Windows のタイトルバー設定に合わせた色を返す
 * @param {'system' | 'dark' | 'light'} [appearance='system'] 外観設定
 * @returns {WindowChromeColors} クローム色
 */
export function resolveWindowChromeColors(
	appearance: 'system' | 'dark' | 'light' = 'system',
): WindowChromeColors {
	const fallback = resolveFallbackWindowChromeColors(appearance);

	if (process.platform !== 'win32') {
		return fallback;
	}

	try {
		const accentColor      = normalizeRgbColor(systemPreferences.getAccentColor());
		const accentEnabled    = readWindowsTitleBarAccentEnabled();
		const activeBackground = accentColor && accentEnabled !== false
			? accentColor
			: fallback.activeBackground;

		return {
			activeBackground,
			activeText: activeBackground === fallback.activeBackground
				? fallback.activeText
				: resolveReadableTextColor(activeBackground),
			inactiveBackground: fallback.inactiveBackground,
			inactiveText      : fallback.inactiveText,
		};
	} catch (error) {
		logger.warn('Failed to resolve window chrome colors', {
			error: error instanceof Error ? error.message : String(error),
		});
		return fallback;
	}
}

/**
 * ペイン数に応じたウィンドウ最小幅を返す
 * @param {number} paneCount ペイン数
 * @returns {number} 最小幅
 */
export function getMinWindowWidthForPaneCount(paneCount: number): number {
	const count = Math.max(1, Math.min(3, Math.round(paneCount)));

	return MIN_PANE_WIDTH * count;
}

/**
 * 外観設定に合わせた titleBarOverlay を返す
 * @param {'system' | 'dark' | 'light'} [appearance='system'] 外観設定
 * @param {boolean} [focused=true] フォーカス中なら true
 * @returns {TitleBarOverlay} オーバーレイ設定
 */
export function resolveTitleBarOverlay(
	appearance: 'system' | 'dark' | 'light' = 'system',
	focused = true,
): TitleBarOverlay {
	const colors = resolveWindowChromeColors(appearance);

	return {
		color: focused
			? colors.activeBackground
			: colors.inactiveBackground,
		symbolColor: focused
			? colors.activeText
			: colors.inactiveText,
		height     : TITLE_BAR_OVERLAY_HEIGHT,
	};
}

/**
 * titleBarOverlay をウィンドウに反映する（Windows のみ）
 * @param {BrowserWindow} win ウィンドウ
 * @param {'system' | 'dark' | 'light'} [appearance='system'] 外観設定
 * @param {boolean} [focused] フォーカス中なら true
 * @returns {void}
 */
export function applyTitleBarOverlay(
	win: BrowserWindow,
	appearance: 'system' | 'dark' | 'light' = 'system',
	focused = win.isFocused(),
): void {
	const overlay = resolveTitleBarOverlay(appearance, focused);
	const bgColor = overlay.color ?? '#ffffff';

	try {
		win.setBackgroundColor(bgColor);
	} catch (error) {
		logger.warn('Failed to apply window background color', {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	if (process.platform !== 'win32') {
		return;
	}

	try {
		win.setTitleBarOverlay(overlay);
	} catch (error) {
		logger.warn('Failed to apply title bar overlay', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * ディスプレイの作業領域に基づくウィンドウサイズ制限を取得する
 * @param {BrowserWindow | null | undefined} [win] 対象ウィンドウ
 * @param {PaneCount | number} [paneCount=1] ペイン数
 * @returns {WindowSizeLimitValues} 制限値
 */
export function getWindowSizeLimits(
	win?: BrowserWindow | null,
	paneCount: PaneCount | number = 1,
): WindowSizeLimitValues {
	const display           = win
		? screen.getDisplayMatching(win.getBounds())
		: screen.getPrimaryDisplay();
	const { width, height } = display.workAreaSize;
	const minWidth          = getMinWindowWidthForPaneCount(paneCount);

	return {
		minWidth,
		minHeight: MIN_WINDOW_HEIGHT,
		maxWidth : width,
		maxHeight: height,
	};
}

/**
 * ウィンドウサイズを最小値・最大値の範囲に丸める
 * @param {number} width 幅
 * @param {number} height 高さ
 * @param {WindowSizeLimitValues} [limits] 制限値
 * @returns {{ width: number; height: number }} 丸め後サイズ
 */
export function clampWindowSize(
	width: number,
	height: number,
	limits: WindowSizeLimitValues = getWindowSizeLimits(),
): { width: number; height: number } {
	return {
		width : Math.min(limits.maxWidth, Math.max(limits.minWidth, Math.round(width))),
		height: Math.min(limits.maxHeight, Math.max(limits.minHeight, Math.round(height))),
	};
}
