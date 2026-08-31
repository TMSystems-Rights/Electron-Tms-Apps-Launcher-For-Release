/** 公式ポータルの実行環境 */
export type PortalEnvironment = 'development' | 'production';

/** パッケージ版で開発ポータルへ誘導する環境変数名 */
export const PORTAL_ENV_VARIABLE_NAME = 'TMS_APPS_LAUNCHER_PORTAL_ENV';

/** 開発ポータル URL を渡す環境変数名（ソースには URL を埋め込まない） */
export const DEVELOPMENT_PORTAL_URL_VARIABLE_NAME = 'TMS_PORTAL_DEVELOPMENT_URL';

/** 本番環境の公式ページ */
export const PRODUCTION_PORTAL_URL = 'https://tm-systems.jp/#apps';

/** 許可するハッシュ */
const ALLOWED_HASH = '#apps';

/**
 * 実行環境から公式ポータル環境を解決する。
 * 未パッケージは常に development。パッケージ版は env が development のときだけ開発、それ以外は本番。
 * @param {{ isPackaged: boolean; envValue?: string }} options 判定材料
 * @returns {PortalEnvironment} 環境
 */
export function resolvePortalEnvironment(options: {
	isPackaged: boolean;
	envValue?: string;
}): PortalEnvironment {
	if (!options.isPackaged) {
		return 'development';
	}

	if (options.envValue === 'development') {
		return 'development';
	}

	return 'production';
}

/**
 * 環境名から公式ページ URL を返す。任意 URL は受け取らない。
 * 開発は developmentUrl。未設定・不正なら本番 URL。
 * @param {PortalEnvironment} environment 環境
 * @param {string} [developmentUrl] 開発 URL。省略時は環境変数を読む
 * @returns {string} 公式ページ URL
 */
export function getOfficialPortalUrl(environment: PortalEnvironment, developmentUrl?: string): string {
	if (environment !== 'development') {
		return PRODUCTION_PORTAL_URL;
	}

	const configured = normalizeDevelopmentPortalUrl(
		developmentUrl === undefined ? process.env[DEVELOPMENT_PORTAL_URL_VARIABLE_NAME] : developmentUrl,
	);

	return configured ?? PRODUCTION_PORTAL_URL;
}

/**
 * shell.openExternal 直前の許可判定。HTTPS・ホスト・パス・ハッシュを検証する。
 * @param {string} urlString 開こうとしている URL
 * @param {string} [developmentUrl] 開発 URL。省略時は環境変数を読む
 * @returns {boolean} 許可するなら true
 */
export function isAllowedOfficialPortalUrl(urlString: string, developmentUrl?: string): boolean {
	const url = parseOfficialPortalUrl(urlString);

	if (!url) {
		return false;
	}

	if (isProductionPortalUrl(url)) {
		return true;
	}

	const allowedDevelopment = parseOfficialPortalUrl(
		developmentUrl === undefined ? process.env[DEVELOPMENT_PORTAL_URL_VARIABLE_NAME] : developmentUrl,
	);

	if (!allowedDevelopment) {
		return false;
	}

	return officialPortalUrlsMatch(url, allowedDevelopment);
}

/**
 * 開発 URL を正規化する
 * @param {string | undefined} urlString 候補
 * @returns {string | undefined} 使ってよい URL
 */
export function normalizeDevelopmentPortalUrl(urlString: string | undefined): string | undefined {
	if (typeof urlString !== 'string') {
		return undefined;
	}

	const trimmed = urlString.trim();

	if (!parseOfficialPortalUrl(trimmed)) {
		return undefined;
	}

	return trimmed;
}

/**
 * HTTPS の公式ページとして構造が妥当か判定し、URL を返す
 * @param {string | undefined} urlString 候補
 * @returns {URL | undefined} 妥当なら URL
 */
function parseOfficialPortalUrl(urlString: string | undefined): URL | undefined {
	if (typeof urlString !== 'string' || urlString.trim().length === 0) {
		return undefined;
	}

	let url: URL;

	try {
		url = new URL(urlString.trim());
	} catch {
		return undefined;
	}

	if (url.protocol !== 'https:') {
		return undefined;
	}

	if (url.username !== '' || url.password !== '') {
		return undefined;
	}

	if (url.search !== '') {
		return undefined;
	}

	if (url.hash !== '' && url.hash !== ALLOWED_HASH) {
		return undefined;
	}

	return url;
}

/**
 * 本番公式ページか判定する
 * @param {URL} url URL
 * @returns {boolean} 本番なら true
 */
function isProductionPortalUrl(url: URL): boolean {
	return url.hostname === 'tm-systems.jp' && (url.pathname === '/' || url.pathname === '');
}

/**
 * ホストとパスが同じ公式ページか判定する
 * @param {URL} left 左
 * @param {URL} right 右
 * @returns {boolean} 同じなら true
 */
function officialPortalUrlsMatch(left: URL, right: URL): boolean {
	return left.hostname === right.hostname && normalizePath(left.pathname) === normalizePath(right.pathname);
}

/**
 * 末尾スラッシュを除いたパスにする
 * @param {string} pathname パス
 * @returns {string} 正規化パス
 */
function normalizePath(pathname: string): string {
	const trimmed = pathname.replace(/\/+$/u, '');

	return trimmed.length === 0 ? '/' : trimmed;
}
