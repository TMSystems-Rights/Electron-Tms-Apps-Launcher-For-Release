/**
 * アプリ名の部分一致と、結果文字列のハイライト位置を計算する
 * 検索対象の一覧は呼び出し側が渡し、このファイルは登録データを保存しない
 * @file
 */
'use strict';

Object.assign(TMS_AL, {
	// 検索の正規化と一致判定。登録データは持たない
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
			// 比較用に正規化したアプリ名。空入力は空文字になる
			const normalizedName  = TMS_AL.Search.Normalize(appName);
			// 比較用に正規化した検索文字列。空なら一致させない
			const normalizedQuery = TMS_AL.Search.Normalize(query);

			// 検索文字列が空なら部分一致しない
			if (!normalizedQuery) {
				return false;
			}

			return normalizedName.includes(normalizedQuery);
		},

		/**
		 * 部分一致した連続文字列を表示用パーツへ分割する
		 * @param {string} value 表示文字列
		 * @param {string} query 検索文字列
		 * @returns {{ text: string; highlight: boolean; kind?: 'partial' | 'character' }[]} 表示用パーツ
		 */
		BuildHighlightParts: function (value, query) {
			// 表示する元文字列。null や未指定は空文字
			const text            = String(value ?? '');
			// 空白を除いて正規化した検索文字列。空なら分割しない
			const normalizedQuery = TMS_AL.Search.Normalize(query);

			// 表示文字列か検索文字列が空なら強調しない。どちらか欠けると全文をそのまま返す
			if (!text || !normalizedQuery) {
				return [
					{
						// 分割しない全文。空でもそのまま返す
						text,
						// 一致箇所が無いので強調しない
						highlight: false
					}
				];
			}

			// ----------------------------------------------
			// 正規化後の比較文字。空白は入れない
			const valueChars = [];
			// 比較文字から元文字列の範囲へ戻す対応。要素が無いときは連続一致を探さない
			const charMap    = [];
			// 元文字列上の読み位置。単位は UTF-16 コード単位。先頭は 0
			let offset       = 0;

			// 元文字列の 1 文字。サロゲートペアも 1 文字として扱う
			for (const char of text) {
				// この文字の開始位置。単位は UTF-16 コード単位
				const start           = offset;
				offset               += char.length;
				// この 1 文字を正規化した比較文字。空白だけなら空になり、対応表にも積まない
				const normalizedChars = Array.from(char.normalize('NFKC').toLocaleLowerCase().replace(/\s/gu, ''));

				// 正規化で増えた比較文字。元の範囲は同じ start と end を共有する
				for (const normalizedChar of normalizedChars) {
					valueChars.push(normalizedChar);
					charMap.push({
						// 元文字列での開始位置。単位は UTF-16 コード単位
						start,
						// この元文字の直後。正規化で比較文字が増えても範囲は一つ
						end: offset
					});
				}
			}

			// ----------------------------------------------
			// 検索文字列の比較文字。この順の連続が部分一致
			const queryChars = Array.from(normalizedQuery);
			// 見つかった強調範囲。空のときは文字単位の一致へ落とす
			const ranges     = [];

			// 連続一致を試し始める比較文字の位置。末尾が検索文字数に足りない位置は試さない
			for (let index = 0; index <= valueChars.length - queryChars.length;) {
				// この位置からの連続一致。途中で 1 文字でも違えば false
				let matched = true;

				// 検索側の何文字目か。0 から検索文字数の手前まで
				for (let queryIndex = 0; queryIndex < queryChars.length; queryIndex += 1) {
					// 比較文字が 1 文字でも違うとその位置は連続一致ではない
					if (valueChars[index + queryIndex] !== queryChars[queryIndex]) {
						matched = false;
						break;
					}
				}

				// 連続一致しなかった位置は 1 文字だけ進めてやり直す
				if (!matched) {
					index += 1;
					continue;
				}

				ranges.push({
					// 元文字列での開始位置。一致の先頭文字
					start: charMap[index].start,
					// 元文字列での終了位置。一致した最後の文字の直後
					end: charMap[index + queryChars.length - 1].end,
					// 連続した部分一致。文字単位のばらばら一致とは分ける
					kind: 'partial'
				});
				index += queryChars.length;
			}

			// 連続一致が一つも無いときだけ、文字の出現回数でばらばらに強調する
			if (ranges.length === 0) {
				// 検索文字ごとに、まだ消費していない個数。0 になった文字はもう強調しない
				const remainingCounts = new Map();

				// 検索側の 1 文字。同じ文字は必要個数だけ数える
				for (const char of queryChars) {
					remainingCounts.set(char, (remainingCounts.get(char) ?? 0) + 1);
				}

				// アプリ名側の比較文字位置。先頭から必要個数だけ消費する
				for (let index = 0; index < valueChars.length; index += 1) {
					// この位置の比較文字
					const char      = valueChars[index];
					// この文字の残り必要数。マップに無いときは 0
					const remaining = remainingCounts.get(char) ?? 0;

					// 必要数が残っていない文字は強調しない
					if (remaining < 1) {
						continue;
					}

					ranges.push({
						// 元文字列での開始位置。この 1 文字
						start: charMap[index].start,
						// 元文字列での終了位置。この 1 文字の直後
						end: charMap[index].end,
						// 連続ではない 1 文字一致
						kind: 'character'
					});
					remainingCounts.set(char, remaining - 1);
				}

				// 消費しきれなかった検索文字の残り個数。1 以上が一つでもあると全体不一致
				for (const remaining of remainingCounts.values()) {
					// 検索文字がアプリ名に足りないときは強調せず全文を返す
					if (remaining > 0) {
						return [
							{
								// 一致しなかった全文
								text,
								// 強調しない
								highlight: false
							}
						];
					}
				}
			}

			// ----------------------------------------------
			// 組み立て中の表示パーツ。強調と非強調を交互に積む
			const parts = [];
			// 次に未出力の元文字列位置。単位は UTF-16 コード単位。先頭は 0
			let cursor  = 0;

			// 強調する範囲。開始位置の昇順
			for (const range of ranges) {
				// 直前の強調の終わりから、この強調の手前まで非強調として出す
				if (cursor < range.start) {
					parts.push({
						// 強調しない区間の文字列
						text: text.slice(cursor, range.start),
						// 強調しない
						highlight: false
					});
				}

				parts.push({
					// 強調する区間の文字列
					text: text.slice(range.start, range.end),
					// 強調する
					highlight: true,
					// 連続一致か、1 文字ずつの一致か
					kind: range.kind
				});
				cursor = range.end;
			}

			// 最後の強調の後ろに文字が残っていれば、非強調として足す
			if (cursor < text.length) {
				parts.push({
					// 末尾の非強調文字列
					text: text.slice(cursor),
					// 強調しない
					highlight: false
				});
			}

			return parts;
		},

		/**
		 * 実行パスから検索対象にするファイル名を取得する
		 * @param {string} filePath 実行パス
		 * @returns {string} ファイル名
		 */
		GetPathFileName: function (filePath) {
			// 両端の空白とダブルクォートを除いたパス。空入力は空文字
			const trimmedPath    = String(filePath ?? '')
				.trim()
				.replace(/^"+|"+$/gu, '');
			// 末尾の区切りを除いたパス。区切りだけだったときは空文字
			const normalizedPath = trimmedPath.replace(/[\\/]+$/gu, '');

			// パスが空ならファイル名は空文字
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
			// 実行パスから取り出したファイル名。パスが空なら空文字で、名前側だけの判定になる
			const pathFileName = TMS_AL.Search.GetPathFileName(appPath);

			return TMS_AL.Search.Contains(appName, query) || TMS_AL.Search.Contains(pathFileName, query);
		},

		/**
		 * 部分一致グループとそれ以外を結合し、必要なら仕切りを挿入する
		 * @param {object[]} partialItems 部分一致の検索結果（DOM順）
		 * @param {object[]} otherItems 部分一致以外の検索結果（DOM順）
		 * @returns {({ appId: string; groupId: string; label: string }|{ type: 'separator' })[]} 表示順の検索結果
		 */
		MergeSearchGroups: function (partialItems, otherItems) {
			// 部分一致を先頭に並べた結果。このあと仕切りと文字一致を足す
			const results = partialItems.slice();

			// 部分一致とそれ以外が両方あるときだけ仕切りを入れる。どちらかが空なら境目は不要
			if (partialItems.length > 0 && otherItems.length > 0) {
				results.push({
					// アプリ行ではない境目
					type: 'separator'
				});
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
			// 比較用に正規化したアプリ名。空入力は空文字
			const normalizedName  = TMS_AL.Search.Normalize(appName);
			// 比較用に正規化した検索文字列。空なら一致させない
			const normalizedQuery = TMS_AL.Search.Normalize(query);

			// 検索文字列が空なら一致しない
			if (!normalizedQuery) {
				return false;
			}

			// アプリ名に含まれる文字の残り個数。同じ文字は出現回数だけ入る
			const counts = new Map();

			// アプリ名側の 1 文字。出現回数を数える
			for (const char of normalizedName) {
				counts.set(char, (counts.get(char) ?? 0) + 1);
			}

			// ----------------------------------------------
			// 検索側の 1 文字。必要個数をアプリ名側から消費する
			for (const char of normalizedQuery) {
				// この文字の残り個数。アプリ名に無いときは 0
				const remaining = counts.get(char) ?? 0;

				// 必要数が残っていない文字があれば不一致
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
			// 実行パスから取り出したファイル名。パスが空なら空文字で、名前側だけの判定になる
			const pathFileName = TMS_AL.Search.GetPathFileName(appPath);

			return TMS_AL.Search.Matches(appName, query) || TMS_AL.Search.Matches(pathFileName, query);
		}
	}
});
