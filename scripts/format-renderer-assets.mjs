/**
 * src/renderer 配下の HTML と CSS の体裁を揃える
 * 対象ファイルは上書きする。対象外の拡張子は読まない。削除はしない
 * 終了コード 0 は成功、1 は --check で差分があったこと
 * @file
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import prettier from 'prettier';
import cssLanguageService from 'vscode-css-languageservice';

// CSS 言語サービスと、編集を文書へ適用する型。HTML の整形には使わない
const { getCSSLanguageService, TextDocument } = cssLanguageService;

// リポジトリのルート。このスクリプトの親ディレクトリ
const ROOT_DIR             = path.resolve(import.meta.dirname, '..');
// 整形する HTML と CSS のルート。この配下以外は読まない
const TARGET_DIR           = path.join(ROOT_DIR, 'src', 'renderer');
// --check のときは書き込まない。差分があれば終了コード 1。無いときは上書きする
const CHECK_MODE           = process.argv.includes('--check');
// VS Code 標準 CSS formatter と同じ言語サービス
const CSS_SERVICE          = getCSSLanguageService();
// HTML 用の Prettier 設定ファイル。CSS には使わない
const PRETTIER_CONFIG_PATH = path.join(ROOT_DIR, '.prettierrc.json');

/**
 * 対象ファイルを再帰的に取得する
 * @param {string} dir ディレクトリ
 * @returns {Promise<string[]>} 対象ファイル
 */
async function collectTargetFiles(dir) {
	// 直下のファイルと子ディレクトリ。再帰で HTML と CSS だけ集める
	const entries = await fs.readdir(dir, {
		// 名前だけでなくファイルかディレクトリかの区別も取る
		withFileTypes: true
	});
	// 集めた絶対パス。まだ無ければ空配列
	const files   = [];

	// 走査中の項目。ファイルとディレクトリの両方を含む
	for (const entry of entries) {
		// 項目の絶対パス。再帰と収集の両方で使う
		const fullPath = path.join(dir, entry.name);

		// ディレクトリなら中を再帰して結果へ足す。ファイル判定には進まない
		if (entry.isDirectory()) {
			files.push(...(await collectTargetFiles(fullPath)));
			continue;
		}

		// ファイルであり、拡張子が html か css のときだけ対象にする。どちらか欠けると捨てる
		if (entry.isFile() && ['.html', '.css'].includes(path.extname(entry.name).toLowerCase())) {
			files.push(fullPath);
		}
	}

	return files;
}

/**
 * HTML をユーザー設定相当の Prettier 設定で整形する
 * @param {string} filePath ファイルパス
 * @param {string} source 元テキスト
 * @returns {Promise<string>} 整形後テキスト
 */
async function formatHtml(filePath, source) {
	// 解決した Prettier 設定。設定ファイルが読めないときは null で、既定の整形になる
	const options = await prettier.resolveConfig(filePath, {
		// 使う Prettier 設定ファイル。見つからないときは null になる
		config: PRETTIER_CONFIG_PATH
	});

	return prettier.format(source, {
		// 解決した設定。null のときは Prettier の既定だけが残る
		...options,
		// パーサ選択に使うパス。拡張子の解釈は parser で上書きする
		filepath: filePath,
		// HTML として整形する
		parser: 'html'
	});
}

/**
 * CSS を VS Code 標準 CSS formatter 相当に整形する
 * @param {string} filePath ファイルパス
 * @param {string} source 元テキスト
 * @returns {string} 整形後テキスト
 */
function formatCss(filePath, source) {
	// 整形対象の CSS 文書。バージョン 0 は未編集の初期テキスト
	const document = TextDocument.create(`file:///${filePath.replace(/\\/g, '/')}`, 'css', 0, source);
	// 適用する編集。差分が無いときは空配列
	const edits    = CSS_SERVICE.format(document, undefined, {
		// インデント幅。スペースにはしない
		tabSize: 4,
		// タブでインデントする
		insertSpaces: false
	});

	return TextDocument.applyEdits(document, edits);
}

/**
 * ファイルを整形する
 * @param {string} filePath ファイルパス
 * @returns {Promise<boolean>} 変更が必要なら true
 */
async function formatFile(filePath) {
	// 元テキスト。整形結果との比較に使う
	const source    = await fs.readFile(filePath, 'utf8');
	// 小文字の拡張子。html 以外はこの関数では CSS として整形する
	const ext       = path.extname(filePath).toLowerCase();
	// 整形後テキスト。元と同じなら書き込み不要
	const formatted = ext === '.html' ? await formatHtml(filePath, source) : formatCss(filePath, source);

	// 内容が同じなら変更無し
	if (formatted === source) {
		return false;
	}

	// check でないときだけ上書きする。check は差分の有無だけ返す
	if (!CHECK_MODE) {
		await fs.writeFile(filePath, formatted, 'utf8');
	}

	return true;
}

// 整形対象の絶対パス。HTML と CSS 以外は含まない
const files        = await collectTargetFiles(TARGET_DIR);
// 内容が変わった相対パス。空なら差分なし
const changedFiles = [];

// ----------------------------------------------
// 対象の絶対パス。ログ用の相対パスはルートから切る
for (const filePath of files) {
	// 整形差分があるファイルだけ一覧に残す
	if (await formatFile(filePath)) {
		changedFiles.push(path.relative(ROOT_DIR, filePath));
	}
}

// ----------------------------------------------
// 一つでも差分があるときだけログを出し、check なら終了コード 1 にする
if (changedFiles.length > 0) {
	// check は未整形、通常実行は書き込み済み、の表示文言
	const action = CHECK_MODE ? 'needs formatting' : 'formatted';

	// 差分があった相対パス
	for (const filePath of changedFiles) {
		console.log(`${action}: ${filePath}`);
	}

	// check で差分があるときは失敗。書き込みモードでは終了コードを変えない
	if (CHECK_MODE) {
		process.exitCode = 1;
	}
} else {
	console.log('renderer HTML/CSS formatting is up to date');
}
