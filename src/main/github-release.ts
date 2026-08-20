/** 最新 Release 取得 API（認証なし。tag_name のみ使う） */
export const GITHUB_LATEST_RELEASE_API_URL =
	'https://api.github.com/repos/TMSystems-Rights/Electron-Tms-Apps-Launcher-For-Release/releases/latest';

/** GitHub API へ付ける User-Agent */
const GITHUB_API_USER_AGENT = 'TMS-AppsLauncher';

/** API タイムアウト（ms） */
const GITHUB_API_TIMEOUT_MS = 15000;

/** 最新 Release JSON の必要項目 */
interface GitHubLatestReleaseResponse {
	tag_name?: unknown;
}

/**
 * バージョン文字列の v 有無を正規化する
 * @param {string} version バージョンまたは tag_name
 * @returns {string} 先頭 v を除いた値
 */
export function normalizeVersionTag(version: string): string {
	return version.trim().replace(/^v/iu, '');
}

/**
 * 正規化済みバージョンを数値配列にする
 * @param {string} version バージョン
 * @returns {number[]} major.minor.patch
 */
function parseVersionParts(version: string): number[] {
	const core  = normalizeVersionTag(version).split('-')[0] ?? '';
	const parts = core.split('.').slice(0, 3).map((part) => {
		const parsed = Number.parseInt(part, 10);

		return Number.isFinite(parsed) ? parsed : 0;
	});

	while (parts.length < 3) {
		parts.push(0);
	}

	return parts;
}

/**
 * バージョンを比較する
 * @param {string} left 左辺
 * @param {string} right 右辺
 * @returns {number} left が大きいと正、同じなら 0、小さいと負
 */
export function compareNormalizedVersions(left: string, right: string): number {
	const leftParts  = parseVersionParts(left);
	const rightParts = parseVersionParts(right);

	for (let index = 0; index < 3; index += 1) {
		const delta = leftParts[index] - rightParts[index];

		if (delta !== 0) {
			return delta;
		}
	}

	return 0;
}

/**
 * latest が current より新しいか判定する
 * @param {string} latestTag 最新 tag_name
 * @param {string} currentVersion 現在バージョン
 * @returns {boolean} 新しい版があれば true
 */
export function isNewerRelease(latestTag: string, currentVersion: string): boolean {
	return compareNormalizedVersions(latestTag, currentVersion) > 0;
}

/**
 * GitHub Releases JSON から tag_name を取り出す
 * @param {unknown} payload API 応答
 * @returns {string} tag_name
 */
export function parseLatestReleaseTag(payload: unknown): string {
	if (!payload || typeof payload !== 'object') {
		throw new Error('GitHub Releases API の応答が不正です。');
	}

	const tagName = (payload as GitHubLatestReleaseResponse).tag_name;

	if (typeof tagName !== 'string' || tagName.trim() === '') {
		throw new Error('GitHub Releases API の tag_name を取得できませんでした。');
	}

	return tagName.trim();
}

/**
 * 最新 Release の tag_name を取得する。asset は見ない。
 * @param {{ fetchImpl?: typeof fetch; url?: string }} [options] テスト用差し替え
 * @returns {Promise<string>} tag_name
 */
export async function fetchLatestReleaseTag(options?: {
	fetchImpl?: typeof fetch;
	url?: string;
}): Promise<string> {
	const fetchImpl = options?.fetchImpl ?? fetch;
	const url       = options?.url ?? GITHUB_LATEST_RELEASE_API_URL;
	const response  = await fetchImpl(url, {
		method : 'GET',
		headers: {
			Accept      : 'application/vnd.github+json',
			'User-Agent': GITHUB_API_USER_AGENT,
		},
		signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`GitHub Releases API が HTTP ${response.status} を返しました。`);
	}

	const payload = await response.json() as unknown;

	return parseLatestReleaseTag(payload);
}
