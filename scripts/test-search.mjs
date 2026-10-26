/**
 * 検索の正規化とハイライトを、renderer の search.js を VM で実行して検証する
 * ファイルは書かない。終了コード 0 は成功、アサーション失敗は 1
 * @file
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// リポジトリルート。search.js をここから読む
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 検証する search.js のソース。ファイルは書き換えない
const source  = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'main-view', 'search.js'), 'utf8');
// VM に渡すグローバル。Search はソースが TMS_AL へ足す
const context = {
	// search.js がメソッドを足す入れ物。初期は空
	TMS_AL: {}
};

vm.runInNewContext(source, context, {
	// スタックに出すファイル名。実パスではなく表示用
	filename: 'search.js'
});

// VM 上の検索関数。プレーンな値へ戻してから比較する
const { Normalize, BuildHighlightParts, Contains, ContainsApp, GetPathFileName, Matches, MatchesApp, MergeSearchGroups } = context.TMS_AL.Search;

/**
 * VMコンテキスト由来の値を通常のプレーン値へ変換する
 * @param {unknown} value 変換対象
 * @returns {unknown} プレーン値
 */
function toPlain(value) {
	return JSON.parse(JSON.stringify(value));
}

assert.equal(Normalize(' Ａ b　C '), 'abc');
assert.equal(Matches('abc', 'ab'), true);
assert.equal(Matches('acb', 'ab'), true);
assert.equal(Matches('bca', 'ab'), true);
assert.equal(Matches('AaA Tool', 'aaa'), true);
assert.equal(Matches('Aa Tool', 'aaa'), false);
assert.equal(Matches('Ｔｅａｍｓ', 'teams'), true);
assert.equal(Matches('Visual Studio Code', 'v c s'), true);
assert.equal(Matches('Visual Studio Code', 'xyz'), false);
assert.equal(Matches('anything', '   '), false);

assert.equal(Contains('Microsoft Teams', 'teams'), true);
assert.equal(Contains('ms-teams', 'teams'), true);
assert.equal(Contains('Microsoft Edge TMS', 'teams'), false);
assert.equal(Contains('TAME Sort Utility', 'teams'), false);
assert.equal(Matches('TAME Sort Utility', 'teams'), true);
assert.equal(Contains('Visual Studio Code', 'v c s'), false);
assert.equal(Contains('anything', '   '), false);

assert.deepEqual(toPlain(BuildHighlightParts('LaunchFDE.bat', 'launch')), [
	{ text: 'Launch', highlight: true, kind: 'partial' },
	{ text: 'FDE.bat', highlight: false }
]);
assert.deepEqual(toPlain(BuildHighlightParts('Code code', 'code')), [
	{ text: 'Code', highlight: true, kind: 'partial' },
	{ text: ' ', highlight: false },
	{ text: 'code', highlight: true, kind: 'partial' }
]);
assert.deepEqual(toPlain(BuildHighlightParts('Ｔｅａｍｓ', 'teams')), [{ text: 'Ｔｅａｍｓ', highlight: true, kind: 'partial' }]);
assert.deepEqual(toPlain(BuildHighlightParts('Visual Studio Code', 'v c s')), [
	{ text: 'V', highlight: true, kind: 'character' },
	{ text: 'i', highlight: false },
	{ text: 's', highlight: true, kind: 'character' },
	{ text: 'ual Studio ', highlight: false },
	{ text: 'C', highlight: true, kind: 'character' },
	{ text: 'ode', highlight: false }
]);
assert.deepEqual(toPlain(BuildHighlightParts('TAME Sort Utility', 'teams')), [
	{ text: 'T', highlight: true, kind: 'character' },
	{ text: 'A', highlight: true, kind: 'character' },
	{ text: 'M', highlight: true, kind: 'character' },
	{ text: 'E', highlight: true, kind: 'character' },
	{ text: ' ', highlight: false },
	{ text: 'S', highlight: true, kind: 'character' },
	{ text: 'ort Utility', highlight: false }
]);
assert.deepEqual(toPlain(BuildHighlightParts('Other.exe', 'teams')), [{ text: 'Other.exe', highlight: false }]);

assert.equal(GetPathFileName('C:\\Program Files\\Microsoft VS Code\\Code.exe'), 'Code.exe');
assert.equal(GetPathFileName('C:/Tools/ms-teams.exe'), 'ms-teams.exe');
assert.equal(GetPathFileName('"C:\\Tools\\quoted-app.exe"'), 'quoted-app.exe');
assert.equal(GetPathFileName('C:\\Tools\\Trailing\\'), 'Trailing');

assert.equal(MatchesApp('Launch Helper', 'C:\\Program Files\\Microsoft VS Code\\Code.exe', 'code'), true);
assert.equal(MatchesApp('Launch Helper', 'C:\\Tools\\TAME Sort Utility.exe', 'teams'), true);
assert.equal(MatchesApp('Launch Helper', 'C:\\Tools\\Other.exe', 'teams'), false);
assert.equal(MatchesApp('anything', 'C:\\Tools\\anything.exe', '   '), false);
assert.equal(ContainsApp('Launch Helper', 'C:\\Program Files\\Microsoft VS Code\\Code.exe', 'code.exe'), true);
assert.equal(ContainsApp('Launch Helper', 'C:\\Tools\\ms-teams.exe', 'teams'), true);
assert.equal(ContainsApp('Launch Helper', 'C:\\Tools\\TAME Sort Utility.exe', 'teams'), false);

// 部分一致側の 1 件。仕切りより前に残る
const partialA = [
	{
		// 部分一致したアプリ ID
		appId: 'a-teams',
		// 所属グループ ID。仕切り判定には使わない
		groupId: 'g1',
		// 表示ラベル。グループ名とアプリ名
		label: 'MS365：Microsoft Teams'
	}
];
// もう 1 件の部分一致。複数件でも仕切りは 1 本
const partialB = [
	{
		// 短い名前の部分一致
		appId: 'a-short',
		// partialA と同じグループ
		groupId: 'g1',
		// ファイル名に近い表示ラベル
		label: 'MS365：ms-teams'
	}
];
// 文字の出現だけで一致した件。部分一致の後ろに置く
const otherA   = [
	{
		// 部分一致ではないアプリ ID
		appId: 'a-edge',
		// 別グループ
		groupId: 'g2',
		// 連続文字列 teams は含まないラベル
		label: 'Web：Microsoft Edge TMS'
	}
];

// 部分一致だけ。仕切りは入らない
const mergedPartialOnly = MergeSearchGroups(partialA, []);
// 文字一致だけ。仕切りは入らない
const mergedOtherOnly   = MergeSearchGroups([], otherA);
// 両方あるとき仕切りが 1 本入る
const mergedBoth        = MergeSearchGroups(partialA, otherA);
// 部分一致が複数でも仕切りは 1 本
const mergedMulti       = MergeSearchGroups([...partialA, ...partialB], otherA);

assert.equal(mergedPartialOnly.length, 1);
assert.equal(mergedPartialOnly[0].appId, 'a-teams');
assert.equal(mergedOtherOnly.length, 1);
assert.equal(mergedOtherOnly[0].appId, 'a-edge');
assert.equal(mergedBoth.length, 3);
assert.equal(mergedBoth[0].appId, 'a-teams');
assert.equal(mergedBoth[1].type, 'separator');
assert.equal(mergedBoth[2].appId, 'a-edge');
assert.equal(mergedMulti.length, 4);
assert.equal(mergedMulti[0].appId, 'a-teams');
assert.equal(mergedMulti[1].appId, 'a-short');
assert.equal(mergedMulti[2].type, 'separator');
assert.equal(mergedMulti[3].appId, 'a-edge');

console.log('Search tests passed');
