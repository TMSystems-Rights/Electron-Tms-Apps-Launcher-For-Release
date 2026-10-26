/**
 * ウィンドウサイズの下限とタイトルバー色を決める
 * BrowserWindow の生成は main.ts が行い、このファイルは数値と色だけを返す
 * @file
 */
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

/** ペイン数から決めるウィンドウサイズの下限と上限。単位は px */
export interface WindowSizeLimitValues {
	/** これより狭くしない幅 */
	minWidth: number;
	/** これより低くしない高さ */
	minHeight: number;
	/** 作業領域に収まる最大幅 */
	maxWidth: number;
	/** 作業領域に収まる最大高さ */
	maxHeight: number;
}

/** カスタムタイトルバー高さ（titleBarOverlay） */
export const TITLE_BAR_OVERLAY_HEIGHT = 48;

/** Windows DWM レジストリキー */
const DWM_REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\DWM';

/** タイトルバーのアクティブ時と非アクティブ時の色。#RRGGBB */
export interface WindowChromeColors {
	/** フォーカスがあるときのタイトルバー背景 */
	activeBackground: string;
	/** フォーカスがあるときのタイトル文字 */
	activeText: string;
	/** フォーカスが無いときのタイトルバー背景 */
	inactiveBackground: string;
	/** フォーカスが無いときのタイトル文字 */
	inactiveText: string;
}

/**
 * CSS/Chromium で扱いやすい #RRGGBB へ正規化する
 * @param {string | undefined} color 色
 * @returns {string | null} 正規化した色
 */
function normalizeRgbColor(color: string | undefined): string | null {
	// ----------------------------------------------
	// # 任意の 6 桁。後ろの 2 桁アルファは捨てる。undefined や空は null
	// ----------------------------------------------
	const match = color?.trim().match(/^#?([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/u);

	// ----------------------------------------------
	// 6 桁の 16 進が無い。短い色や名前色は使わない
	// ----------------------------------------------
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
	// sRGB を相対輝度用に直した配列。順は R, G, B。解析できない桁は NaN になり得る
	const rgb = [1, 3, 5].map((index) => {
		// 2 桁 hex を 0 から 1。解析できないときは NaN
		const channel = parseInt(color.slice(index, index + 2), 16) / 255;

		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});

	return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
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
	// ----------------------------------------------
	// Windows 以外にこの設定は無い。無効として false。不明の null ではない
	// ----------------------------------------------
	if (process.platform !== 'win32') {
		return false;
	}

	try {
		// ----------------------------------------------
		// reg query の標準出力。失敗は catch で null。空だと値行に一致しない
		// ----------------------------------------------
		const output = execFileSync('reg.exe', ['query', DWM_REGISTRY_KEY, '/v', 'ColorPrevalence'], {
			// レジストリ出力の文字コード
			encoding: 'utf8',
			// 応答待ちの上限。単位は ms。超過は catch で null
			timeout: 1000,
			// コンソールを出さない
			windowsHide: true
		});
		// ColorPrevalence の 16 進。行の形が違うときは null で設定不明
		const match  = output.match(/ColorPrevalence\s+REG_DWORD\s+0x([0-9a-f]+)/iu);

		// 値の行が無い。有効か無効か決めない
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
function resolveFallbackWindowChromeColors(appearance: 'system' | 'dark' | 'light'): WindowChromeColors {
	// ----------------------------------------------
	// dark 指定か、system かつ OS がダーク。system のときは OS がダークであることも必要
	// ----------------------------------------------
	const isDark = appearance === 'dark' || (appearance === 'system' && nativeTheme.shouldUseDarkColors);

	// ----------------------------------------------
	// ダークパレット。単位は #RRGGBB。light 指定はこの分岐に入らない
	// ----------------------------------------------
	if (isDark) {
		return {
			// フォーカス中のタイトルバー背景
			activeBackground: '#2d2d2d',
			// フォーカス中のタイトル文字
			activeText: '#f0f0f0',
			// 非フォーカスのタイトルバー背景
			inactiveBackground: '#1f1f1f',
			// 非フォーカスのタイトル文字
			inactiveText: '#8a8a8a'
		};
	}

	return {
		// フォーカス中のタイトルバー背景
		activeBackground: '#ffffff',
		// フォーカス中のタイトル文字
		activeText: '#1a1a1a',
		// 非フォーカスのタイトルバー背景。ライトではアクティブと同じ
		inactiveBackground: '#ffffff',
		// 非フォーカスのタイトル文字。背景より薄い
		inactiveText: '#555555'
	};
}

/**
 * Windows のタイトルバー設定に合わせた色を返す
 * @param {'system' | 'dark' | 'light'} [appearance='system'] 外観設定
 * @returns {WindowChromeColors} クローム色
 */
export function resolveWindowChromeColors(appearance: 'system' | 'dark' | 'light' = 'system'): WindowChromeColors {
	// アクセントが取れないときの色。ダークとライトで中身が違う
	const fallback = resolveFallbackWindowChromeColors(appearance);

	// Windows 以外はアクセントを読まない
	if (process.platform !== 'win32') {
		return fallback;
	}

	try {
		// ----------------------------------------------
		// システムアクセント。#RRGGBB にできないときは null
		// ----------------------------------------------
		const accentColor      = normalizeRgbColor(systemPreferences.getAccentColor());
		// 1 なら true、0 なら false、読めないときは null。null は無効確定ではない
		const accentEnabled    = readWindowsTitleBarAccentEnabled();
		// 色があり、かつ無効と分かっていない。両方が必要。どちらか欠けるとフォールバック
		const activeBackground = accentColor && accentEnabled !== false ? accentColor : fallback.activeBackground;

		return {
			// タイトルバー背景。単位は #RRGGBB
			activeBackground,
			// 背景がフォールバックのままならその文字色。アクセントに変えたときだけ輝度から決める
			activeText: activeBackground === fallback.activeBackground ? fallback.activeText : resolveReadableTextColor(activeBackground),
			// 非フォーカス背景は OS アクセントを使わない
			inactiveBackground: fallback.inactiveBackground,
			// 非フォーカス文字もフォールバックのまま
			inactiveText: fallback.inactiveText
		};
	} catch (error) {
		logger.warn('Failed to resolve window chrome colors', {
			// Error でなければ文字列化。メッセージが空のときもある
			error: error instanceof Error ? error.message : String(error)
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
	// 1 から 3 へ収めたペイン数。小数は四捨五入。0 以下や未指定は 1。単位は個
	const count = Math.max(1, Math.min(3, Math.round(paneCount)));

	return MIN_PANE_WIDTH * count;
}

/**
 * 外観設定に合わせた titleBarOverlay を返す
 * @param {'system' | 'dark' | 'light'} [appearance='system'] 外観設定
 * @param {boolean} [focused=true] フォーカス中なら true
 * @returns {TitleBarOverlay} オーバーレイ設定
 */
export function resolveTitleBarOverlay(appearance: 'system' | 'dark' | 'light' = 'system', focused = true): TitleBarOverlay {
	// 外観から決めた #RRGGBB。取得失敗時はフォールバック色
	const colors = resolveWindowChromeColors(appearance);

	return {
		// フォーカス中はアクティブ背景、外れているときは非アクティブ。単位は #RRGGBB
		color: focused ? colors.activeBackground : colors.inactiveBackground,
		// 同じ条件の文字色。背景と対になる
		symbolColor: focused ? colors.activeText : colors.inactiveText,
		// タイトルバー高さ。単位は px。フォーカスでは変えない
		height: TITLE_BAR_OVERLAY_HEIGHT
	};
}

/**
 * titleBarOverlay をウィンドウに反映する（Windows のみ）
 * @param {BrowserWindow} win ウィンドウ
 * @param {'system' | 'dark' | 'light'} [appearance='system'] 外観設定
 * @param {boolean} [focused] フォーカス中なら true
 */
export function applyTitleBarOverlay(win: BrowserWindow, appearance: 'system' | 'dark' | 'light' = 'system', focused = win.isFocused()): void {
	// ----------------------------------------------
	// フォーカスに合わせた色。非フォーカスは inactive 側
	// ----------------------------------------------
	const overlay = resolveTitleBarOverlay(appearance, focused);
	// color が未設定のときの背景。単位は #RRGGBB。通常は overlay.color が入る
	const bgColor = overlay.color ?? '#ffffff';

	try {
		win.setBackgroundColor(bgColor);
	} catch (error) {
		logger.warn('Failed to apply window background color', {
			// Error でなければ文字列化。メッセージが空のときもある
			error: error instanceof Error ? error.message : String(error)
		});
	}

	// ----------------------------------------------
	// 非 Windows はオーバーレイ API が無い。背景色は反映済み
	// ----------------------------------------------
	if (process.platform !== 'win32') {
		return;
	}

	try {
		win.setTitleBarOverlay(overlay);
	} catch (error) {
		logger.warn('Failed to apply title bar overlay', {
			// Error でなければ文字列化。メッセージが空のときもある
			error: error instanceof Error ? error.message : String(error)
		});
	}
}

/**
 * ディスプレイの作業領域に基づくウィンドウサイズ制限を取得する
 * @param {BrowserWindow | null | undefined} [win] 対象ウィンドウ
 * @param {PaneCount | number} [paneCount=1] ペイン数
 * @returns {WindowSizeLimitValues} 制限値
 */
export function getWindowSizeLimits(win?: BrowserWindow | null, paneCount: PaneCount | number = 1): WindowSizeLimitValues {
	// ウィンドウが無いときはプライマリ。あるときはその表示面の作業領域
	const display           = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
	// 作業領域の幅と高さ。単位は px。タスクバーは含まない
	const { width, height } = display.workAreaSize;
	// ペイン数から決めた最小幅。単位は px。範囲外のペイン数は 1 から 3 へ丸まる
	const minWidth          = getMinWindowWidthForPaneCount(paneCount);

	return {
		// これより狭くしない幅。単位は px
		minWidth,
		// これより低くしない高さ。単位は px。固定 480
		minHeight: MIN_WINDOW_HEIGHT,
		// 作業領域の幅が上限。単位は px。0 にはならない
		maxWidth: width,
		// 作業領域の高さが上限。単位は px
		maxHeight: height
	};
}

/**
 * ウィンドウサイズを最小値・最大値の範囲に丸める
 * @param {number} width 幅
 * @param {number} height 高さ
 * @param {WindowSizeLimitValues} [limits] 制限値
 * @returns {{ width: number; height: number }} 丸め後サイズ
 */
export function clampWindowSize(width: number, height: number, limits: WindowSizeLimitValues = getWindowSizeLimits()): { width: number; height: number } {
	return {
		// 最小以上、最大以下へ丸めた幅。単位は px。NaN は丸めの結果が NaN のまま
		width: Math.min(limits.maxWidth, Math.max(limits.minWidth, Math.round(width))),
		// 同じ範囲へ丸めた高さ。単位は px
		height: Math.min(limits.maxHeight, Math.max(limits.minHeight, Math.round(height)))
	};
}
