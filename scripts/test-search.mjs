import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source  = fs.readFileSync(
	path.join(rootDir, 'src', 'renderer', 'main-view', 'search.js'),
	'utf8',
);
const context = { TMS_AL: {} };

vm.runInNewContext(source, context, { filename: 'search.js' });

const {
	Normalize,
	Contains,
	ContainsApp,
	GetPathFileName,
	Matches,
	MatchesApp,
	MergeSearchGroups,
} = context.TMS_AL.Search;

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

const partialA = [{ appId: 'a-teams', groupId: 'g1', label: 'MS365：Microsoft Teams' }];
const partialB = [{ appId: 'a-short', groupId: 'g1', label: 'MS365：ms-teams' }];
const otherA   = [{ appId: 'a-edge', groupId: 'g2', label: 'Web：Microsoft Edge TMS' }];

const mergedPartialOnly = MergeSearchGroups(partialA, []);
const mergedOtherOnly   = MergeSearchGroups([], otherA);
const mergedBoth        = MergeSearchGroups(partialA, otherA);
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
