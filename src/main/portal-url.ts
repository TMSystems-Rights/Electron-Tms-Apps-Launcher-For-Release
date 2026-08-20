/** 公式ポータルの実行環境 */
export type PortalEnvironment = 'development' | 'production';

/** パッケージ版で開発ポータルへ誘導する環境変数名 */
export const PORTAL_ENV_VARIABLE_NAME = 'TMS_APPS_LAUNCHER_PORTAL_ENV';

/** 開発環境の公式ページ */
export const DEVELOPMENT_PORTAL_URL = 'https://cjac3.info/030_tms-portal/#apps';

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
 * @param {PortalEnvironment} environment 環境
 * @returns {string} 公式ページ URL
 */
export function getOfficialPortalUrl(environment: PortalEnvironment): string {
	if (environment === 'development') {
		return DEVELOPMENT_PORTAL_URL;
	}

	return PRODUCTION_PORTAL_URL;
}

/**
 * shell.openExternal 直前の許可判定。HTTPS・ホスト・パス・ハッシュを検証する。
 * @param {string} urlString 開こうとしている URL
 * @returns {boolean} 許可するなら true
 */
export function isAllowedOfficialPortalUrl(urlString: string): boolean {
	if (typeof urlString !== 'string' || urlString.length === 0) {
		return false;
	}

	let url: URL;

	try {
		url = new URL(urlString);
	} catch {
		return false;
	}

	if (url.protocol !== 'https:') {
		return false;
	}

	if (url.username !== '' || url.password !== '') {
		return false;
	}

	if (url.search !== '') {
		return false;
	}

	if (url.hash !== '' && url.hash !== ALLOWED_HASH) {
		return false;
	}

	if (url.hostname === 'cjac3.info') {
		return url.pathname === '/030_tms-portal/' || url.pathname === '/030_tms-portal';
	}

	if (url.hostname === 'tm-systems.jp') {
		return url.pathname === '/' || url.pathname === '';
	}

	return false;
}
