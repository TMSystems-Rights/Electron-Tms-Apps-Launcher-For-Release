'use strict';

Object.assign(TMS_AL, {
	Search: {
		/**
		 * 検索比較用文字列へ正規化する
		 * @param {string} value 入力文字列
		 * @returns {string} 正規化済み文字列
		 */
		Normalize: function (value) {
			return String(value ?? '')
				.normalize('NFKC')
				.toLocaleLowerCase()
				.replace(/\s/gu, '');
		},

		/**
		 * 正規化後のアプリ名に検索文字列が部分一致するか判定する
		 * @param {string} appName アプリ名
		 * @param {string} query 検索文字列
		 * @returns {boolean} 部分一致時true
		 */
		Contains: function (appName, query) {
			const normalizedName  = TMS_AL.Search.Normalize(appName);
			const normalizedQuery = TMS_AL.Search.Normalize(query);

			if (!normalizedQuery) {
				return false;
			}

			return normalizedName.includes(normalizedQuery);
		},

		/**
		 * 部分一致した連続文字列を表示用パーツへ分割する
		 * @param {string} value 表示文字列
		 * @param {string} query 検索文字列
		 * @returns {{ text: string; highlight: boolean }[]} 表示用パーツ
		 */
		BuildHighlightParts: function (value, query) {
			const text            = String(value ?? '');
			const normalizedQuery = TMS_AL.Search.Normalize(query);

			if (!text || !normalizedQuery) {
				return [{ text, highlight: false }];
			}

			const valueChars = [];
			const charMap    = [];
			let offset       = 0;

			for (const char of text) {
				const start           = offset;
				offset               += char.length;
				const normalizedChars = Array.from(
					char.normalize('NFKC')
						.toLocaleLowerCase()
						.replace(/\s/gu, ''),
				);

				for (const normalizedChar of normalizedChars) {
					valueChars.push(normalizedChar);
					charMap.push({ start, end: offset });
				}
			}

			const queryChars = Array.from(normalizedQuery);
			const ranges     = [];

			for (let index = 0; index <= valueChars.length - queryChars.length;) {
				let matched = true;

				for (let queryIndex = 0; queryIndex < queryChars.length; queryIndex += 1) {
					if (valueChars[index + queryIndex] !== queryChars[queryIndex]) {
						matched = false;
						break;
					}
				}

				if (!matched) {
					index += 1;
					continue;
				}

				ranges.push({
					start: charMap[index].start,
					end  : charMap[index + queryChars.length - 1].end,
				});
				index += queryChars.length;
			}

			if (ranges.length === 0) {
				return [{ text, highlight: false }];
			}

			const parts = [];
			let cursor  = 0;

			for (const range of ranges) {
				if (cursor < range.start) {
					parts.push({ text: text.slice(cursor, range.start), highlight: false });
				}

				parts.push({ text: text.slice(range.start, range.end), highlight: true });
				cursor = range.end;
			}

			if (cursor < text.length) {
				parts.push({ text: text.slice(cursor), highlight: false });
			}

			return parts;
		},

		/**
		 * 実行パスから検索対象にするファイル名を取得する
		 * @param {string} filePath 実行パス
		 * @returns {string} ファイル名
		 */
		GetPathFileName: function (filePath) {
			const trimmedPath    = String(filePath ?? '')
				.trim()
				.replace(/^"+|"+$/gu, '');
			const normalizedPath = trimmedPath.replace(/[\\/]+$/gu, '');

			if (!normalizedPath) {
				return '';
			}

			return normalizedPath.split(/[\\/]/u).pop() ?? '';
		},

		/**
		 * アプリ名または実行パスのファイル名に検索文字列が部分一致するか判定する
		 * @param {string} appName アプリ名
		 * @param {string} appPath 実行パス
		 * @param {string} query 検索文字列
		 * @returns {boolean} 部分一致時true
		 */
		ContainsApp: function (appName, appPath, query) {
			const pathFileName = TMS_AL.Search.GetPathFileName(appPath);

			return TMS_AL.Search.Contains(appName, query)
				|| TMS_AL.Search.Contains(pathFileName, query);
		},

		/**
		 * 部分一致グループとそれ以外を結合し、必要なら仕切りを挿入する
		 * @param {object[]} partialItems 部分一致の検索結果（DOM順）
		 * @param {object[]} otherItems 部分一致以外の検索結果（DOM順）
		 * @returns {({ appId: string; groupId: string; label: string }|{ type: 'separator' })[]} 表示順の検索結果
		 */
		MergeSearchGroups: function (partialItems, otherItems) {
			const results = partialItems.slice();

			if (partialItems.length > 0 && otherItems.length > 0) {
				results.push({ type: 'separator' });
			}

			return results.concat(otherItems);
		},

		/**
		 * 各文字が必要数だけアプリ名に含まれるか判定する
		 * @param {string} appName アプリ名
		 * @param {string} query 検索文字列
		 * @returns {boolean} 一致時true
		 */
		Matches: function (appName, query) {
			const normalizedName  = TMS_AL.Search.Normalize(appName);
			const normalizedQuery = TMS_AL.Search.Normalize(query);

			if (!normalizedQuery) {
				return false;
			}

			const counts = new Map();

			for (const char of normalizedName) {
				counts.set(char, (counts.get(char) ?? 0) + 1);
			}

			for (const char of normalizedQuery) {
				const remaining = counts.get(char) ?? 0;

				if (remaining < 1) {
					return false;
				}

				counts.set(char, remaining - 1);
			}

			return true;
		},

		/**
		 * 各文字が必要数だけアプリ名または実行パスのファイル名に含まれるか判定する
		 * @param {string} appName アプリ名
		 * @param {string} appPath 実行パス
		 * @param {string} query 検索文字列
		 * @returns {boolean} 一致時true
		 */
		MatchesApp: function (appName, appPath, query) {
			const pathFileName = TMS_AL.Search.GetPathFileName(appPath);

			return TMS_AL.Search.Matches(appName, query)
				|| TMS_AL.Search.Matches(pathFileName, query);
		},
	},
});
