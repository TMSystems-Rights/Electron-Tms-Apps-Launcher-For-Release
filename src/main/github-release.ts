/**
 * 公開リポジトリの最新 Release タグを取得し、現在の版より新しいかを比較する
 * asset のダウンロードはせず、タグ名だけを返す
 * @file
 */
/** 最新 Release 取得 API（認証なし。tag_name のみ使う） */
export const GITHUB_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/TMSystems-Rights/Electron-Tms-Apps-Launcher-For-Release/releases/latest';

/** GitHub API へ付ける User-Agent */
const GITHUB_API_USER_AGENT = 'TMS-AppsLauncher';

/** API タイムアウト（ms） */
const GITHUB_API_TIMEOUT_MS = 15000;

/** 最新 Release JSON のうち、比較に使う項目だけ */
interface GitHubLatestReleaseResponse {
	/** タグ名。応答に無いときは未設定 */
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
	// ----------------------------------------------
	// 先頭 v を外しハイフン以降を捨てた本体。空なら各桁は 0
	// ----------------------------------------------
	const core  = normalizeVersionTag(version).split('-')[0] ?? '';
	// 最大 3 桁。数値にできない桁は 0。単位は major, minor, patch
	const parts = core
		.split('.')
		.slice(0, 3)
		.map((part) => {
			// 10 進にできないときと空文字は 0
			const parsed = Number.parseInt(part, 10);

			return Number.isFinite(parsed) ? parsed : 0;
		});

	// ----------------------------------------------
	// 3 桁未満は末尾を 0 で埋める。比較側は常に 3 要素
	// ----------------------------------------------
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
	// ----------------------------------------------
	// 左辺を 3 桁へ。足りない桁と不正な桁は 0
	// ----------------------------------------------
	const leftParts  = parseVersionParts(left);
	// 右辺も同じ桁数。空文字の桁は 0。単位は major, minor, patch
	const rightParts = parseVersionParts(right);

	// ----------------------------------------------
	// 添字 0 から 2。単位は major, minor, patch の桁
	// ----------------------------------------------
	for (let index = 0; index < 3; index += 1) {
		// その桁の差。0 は同値。正なら左が大きい
		const delta = leftParts[index] - rightParts[index];

		// 差が 0 でない桁だけで結果を返す。0 は次の桁へ進む
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
	// ----------------------------------------------
	// null か undefined、またはオブジェクトでない。どちらかで応答不正。両方妥当なら次へ進む
	// ----------------------------------------------
	if (!payload || typeof payload !== 'object') {
		throw new Error('GitHub Releases API の応答が不正です。');
	}

	// ----------------------------------------------
	// tag_name が応答に無いときは undefined。比較に使えない
	// ----------------------------------------------
	const tagName = (payload as GitHubLatestReleaseResponse).tag_name;

	// ----------------------------------------------
	// 文字列でないか、空白だけか。どちらかで tag を確定できない
	// ----------------------------------------------
	if (typeof tagName !== 'string' || tagName.trim() === '') {
		throw new Error('GitHub Releases API の tag_name を取得できませんでした。');
	}

	return tagName.trim();
}

/**
 * 最新 Release の tag_name を取得する。asset は見ない
 * @param {{ fetchImpl?: typeof fetch; url?: string }} [options] テスト用差し替え
 * @returns {Promise<string>} tag_name
 */
export async function fetchLatestReleaseTag(options?: { fetchImpl?: typeof fetch; url?: string }): Promise<string> {
	// ----------------------------------------------
	// 未指定時はグローバル fetch。テストだけ実装を差し替える
	// ----------------------------------------------
	const fetchImpl = options?.fetchImpl ?? fetch;
	// 未指定時は公開リポジトリの latest。空の差し替え URL は使わない
	const url       = options?.url ?? GITHUB_LATEST_RELEASE_API_URL;
	// HTTP 応答。ok でないときは本文を見ない
	const response  = await fetchImpl(url, {
		// 取得のみ。作成や削除はしない
		method: 'GET',
		// Accept と User-Agent。どちらも無いと JSON 以外や拒否になり得る
		headers: {
			// Release の JSON を求める。違う Accept だと別形式になることがある
			Accept: 'application/vnd.github+json',
			// 認証なし API 向けの識別名。空だと拒否されることがある
			'User-Agent': GITHUB_API_USER_AGENT
		},
		// 15 秒で中断。単位は ms。超過は reject
		signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS)
	});

	// ----------------------------------------------
	// 2xx 以外は tag にしない。status だけを理由にする
	// ----------------------------------------------
	if (!response.ok) {
		throw new Error(`GitHub Releases API が HTTP ${response.status} を返しました。`);
	}

	// ----------------------------------------------
	// JSON から tag_name を取り出す。形が違うと例外
	// ----------------------------------------------
	const payload = (await response.json()) as unknown;

	return parseLatestReleaseTag(payload);
}
