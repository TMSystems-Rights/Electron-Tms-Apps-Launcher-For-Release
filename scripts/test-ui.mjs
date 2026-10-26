/**
 * ランチャー画面の表示と操作を Electron 上で検証する
 * 一時 userData 以外の保存データは変更しない。終了コード 0 は成功、失敗は 1
 * @file
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from '../dist/main/ipc.js';

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

// リポジトリルート。dist の画面と preload をここから読む
const rootDir     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// このテスト専用の userData。本番の保存データは変えない
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-app-launcher-ui-'));
// launcher-data.json を置く data。userData の直下
const dataDir     = path.join(userDataDir, 'data');

app.setPath('userData', userDataDir);
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
	path.join(dataDir, 'launcher-data.json'),
	JSON.stringify(
		{
			schemaVersion: 1,
			settings: {
				toggleInitialState: 'expandAll',
				groupExpandedStates: { 'g-dev': false, 'g-chat': true },
				window: { width: 760, height: 720 },
				appearance: 'light',
				launchBehavior: 'stay',
				rememberWindowSizeOnLaunch: false,
				paneCount: 2,
				uncategorizedPane: 'left'
			},
			groups: [
				{ id: 'g-dev', name: '開発', order: 0, isUncategorized: false, pane: 'left' },
				{ id: 'g-chat', name: '連絡', order: 0, isUncategorized: false, pane: 'right' }
			],
			apps: [
				{ id: 'a-code', name: 'Visual Studio Code', path: 'C:\\Tools\\Code.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-dev', order: 0 },
				{ id: 'a-edge', name: 'TAME Sort Utility', path: 'C:\\Program Files\\TameSort.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-dev', order: 1 },
				{ id: 'a-teams', name: 'Microsoft Teams', path: 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ms-teams.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-chat', order: 0 },
				{ id: 'a-teams-short', name: 'ms-teams', path: 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\ms-teams.exe', args: '', workingDir: '', iconMode: 'auto', customIconPath: '', groupId: 'g-chat', order: 1 }
			]
		},
		null,
		2
	),
	'utf8'
);

app.whenReady()
	.then(async () => {
		registerIpcHandlers();

		// 画面を載せる非表示ウィンドウ。テストが終わったら破棄する
		const win = new BrowserWindow({
			// テスト中はウィンドウを出さない
			show: false,
			// ランチャー本体と同じタイトルバーなし
			titleBarStyle: 'hidden',
			// 描画プロセスの隔離。preload だけが launcherApi を渡す
			webPreferences: {
				// ビルド済み preload
				preload: path.join(rootDir, 'dist', 'preload', 'preload.js'),
				// ページから Node を直接触らせない
				contextIsolation: true,
				// レンダラーをサンドボックスにする
				sandbox: true
			}
		});

		await win.loadFile(path.join(rootDir, 'dist', 'renderer', 'index.html'));
		await new Promise((resolve) => setTimeout(resolve, 1200));

		// ページ内の操作結果。期待と違うときは passed が false
		const result = await win.webContents.executeJavaScript(`(async () => {
		// 検索入力。文字単位の検索から始める
		const input = document.getElementById('tmsAlSearchInput');
		// 検索結果リスト。オプションと仕切りをここから読む
		const results = document.getElementById('tmsAlSearchResults');
		input.value = 'v c s';
		input.dispatchEvent(new Event('input', { bubbles: true }));

		// 先頭の検索結果。該当なしのときは null
		const option = results.querySelector('[role="option"]');
		// 文字単位検索の初期表示
		const initial = {
			// オプション全体の文字。グループ名、アプリ名、ファイル名が連結される
			resultText: option?.textContent,
			// 行ごとの文字。1 行目が名前、2 行目がファイル名
			lineTexts: [...option?.querySelectorAll('.tms-al-search__option-line') ?? []].map((line) => line.textContent),
			// 1 文字強調の個数。v c s なら 3
			characterHighlights: option?.querySelectorAll('.tms-al-search__highlight--character').length,
			// 選択できる結果件数。仕切りは含まない
			resultCount: results.querySelectorAll('[role="option"]').length,
		};
		// 検索から起動したアプリ ID。クリックと Enter の両方
		const launchIds = [];
		// 起動呼び出し。管理者起動かどうかも残す
		const launchCalls = [];
		TMS_AL.ScreenMain.LaunchApp = async (appId, options) => {
			launchIds.push(appId);
			launchCalls.push({ appId, runAsAdmin: options?.runAsAdmin === true });
		};
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		option?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
		// 検索操作だけで起動した ID。このあとコンテキストメニュー分は混ぜない
		const searchLaunchIds = launchIds.slice();

		await TMS_AL.ScreenMain.HandleAppContextMenuAction('a-code', 'runAsAdmin');
		// 最後の起動呼び出し。管理者起動であることを見る
		const contextAction = launchCalls[launchCalls.length - 1];

		// 開発グループ。検索プレビューで開く
		const group = document.querySelector('[data-group-id="g-dev"]');
		// Visual Studio Code の行。プレビュー強調の対象
		const row = document.querySelector('[data-app-id="a-code"]');
		// 検索プレビュー中の見た目と、保存している開閉
		const preview = {
			// プレビューでグループが開いているか
			groupExpanded: group?.classList.contains('tms-al-group--expanded'),
			// 行が検索プレビュー強調か
			rowHighlighted: row?.classList.contains('tms-al-app-row--search-preview'),
			// 保存上の開閉。プレビューでは変えないので false のまま
			persistedState: TMS_AL.ScreenMain._groupExpanded['g-dev'],
		};

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		// Escape 後の検索欄と、プレビューで開いたグループ
		const cleared = {
			// 検索文字。空になっているはず
			inputValue: input.value,
			// 結果リストが隠れているか
			resultsHidden: results.hidden,
			// プレビューで開いたグループが閉じ戻ったか
			groupExpanded: group?.classList.contains('tms-al-group--expanded'),
		};

		input.value = 'teams';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		// teams 検索。部分一致 2 件と、仕切りの向こうの文字一致 1 件
		const teamsSearch = {
			// 各オプションの全文
			labels: [...results.querySelectorAll('[role="option"]')].map((option) => option.textContent),
			// 各オプションの行テキスト
			lineTexts: [...results.querySelectorAll('[role="option"]')].map((option) => (
				[...option.querySelectorAll('.tms-al-search__option-line')].map((line) => line.textContent)
			)),
			// 連続部分一致の強調個数。文字一致の件は 0
			partialHighlightCounts: [...results.querySelectorAll('[role="option"]')].map((option) => (
				option.querySelectorAll('.tms-al-search__highlight:not(.tms-al-search__highlight--character)').length
			)),
			// 1 文字強調の個数。部分一致の件は 0
			characterHighlightCounts: [...results.querySelectorAll('[role="option"]')].map((option) => (
				option.querySelectorAll('.tms-al-search__highlight--character').length
			)),
			// 部分一致と文字一致の境目があるか
			hasSeparator: results.querySelector('.tms-al-search__separator') !== null,
			// 選択できる結果件数
			resultCount: results.querySelectorAll('[role="option"]').length,
		};

		// すべて折りたたむボタン。グローバル Escape のフォーカス先
		const btnCollapseAll = document.getElementById('tmsAlBtnCollapseAll');
		btnCollapseAll?.focus();
		btnCollapseAll?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		// 検索欄以外の Escape で検索だけ消え、フォーカスはボタンに残る
		const globalCleared = {
			// 検索文字。空になっているはず
			inputValue: input.value,
			// 結果リストが隠れているか
			resultsHidden: results.hidden,
			// Escape 後もフォーカスが残る要素 ID
			activeElementId: document.activeElement?.id,
		};

		// すべて展開するボタン。ウィンドウフォーカスでは検索へ移る
		const btnExpandAll = document.getElementById('tmsAlBtnExpandAll');
		btnExpandAll?.focus();
		window.dispatchEvent(new Event('focus'));
		await new Promise((resolve) => setTimeout(resolve, 20));
		// ウィンドウフォーカス後のフォーカス先。モーダルが無いので検索欄
		const windowFocus = {
			// フォーカスされた要素 ID
			activeElementId: document.activeElement?.id,
		};

		// 設定モーダル。開いているあいだは検索へフォーカスを移さない
		const settingsModal = document.getElementById('tmsAlModalSettings');
		// 設定を閉じるボタン。モーダル表示中のフォーカス先
		const settingsClose = document.getElementById('tmsAlBtnSettingsClose');
		settingsModal.hidden = false;
		settingsClose?.focus();
		window.dispatchEvent(new Event('focus'));
		await new Promise((resolve) => setTimeout(resolve, 20));
		// モーダルを開いたままウィンドウフォーカスしたときのフォーカス先
		const modalWindowFocus = {
			// 検索欄へ移らず、閉じるボタンのまま
			activeElementId: document.activeElement?.id,
		};
		settingsModal.hidden = true;

		TMS_AL.ScreenMain.ApplyRunningApps({ appIds: ['a-code'] });
		await TMS_AL.ScreenMain.Render();
		// 再描画後の Visual Studio Code 行。起動中表示が残るか
		const rerenderedRow = document.querySelector('[data-app-id="a-code"]');
		// 再描画後の起動中表示
		const running = {
			// 起動中クラスが付いているか
			classApplied: rerenderedRow?.classList.contains('tms-al-app-row--running'),
			// 起動中ドットが見えているか。hidden でない
			dotVisible: !rerenderedRow?.querySelector('.tms-al-app-row__running-state')?.hidden,
		};

		// 右クリックで受け取った呼び出し。本番メニューは出さない
		const contextEvents = [];
		TMS_AL.ScreenMain.OpenAppContextMenu = async (appId, event) => {
			event.preventDefault();
			contextEvents.push({ appId, defaultPrevented: event.defaultPrevented });
		};
		rerenderedRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		// 右クリックがメニューハンドラへ届いたか
		const contextMenu = {
			// 受け取った回数。1 のはず
			count: contextEvents.length,
			// 右クリックしたアプリ ID
			appId: contextEvents[0]?.appId,
			// 既定のメニューを抑止したか
			defaultPrevented: contextEvents[0]?.defaultPrevented,
		};

		// 開発グループ。追加ボタンで開閉が変わらないことを見る
		const groupDev = document.querySelector('[data-group-id="g-dev"]');
		// 連絡グループ。追加ボタンの所属先
		const groupChat = document.querySelector('[data-group-id="g-chat"]');
		// 開発グループの追加ボタン
		const addFromDevBtn = groupDev?.querySelector('[data-action="add-app"]');
		// 連絡グループの追加ボタン
		const addFromChatBtn = groupChat?.querySelector('[data-action="add-app"]');
		// クリック前の開発グループの開閉。追加では変わらないはず
		const groupDevExpandedBefore = groupDev?.classList.contains('tms-al-group--expanded');
		addFromChatBtn?.click();
		// 連絡グループから開いた新規モーダル
		const addFromChat = {
			// 登録モーダルが見えているか
			modalVisible: !document.getElementById('tmsAlModalEdit')?.hidden,
			// 見出し。新規なので追加
			title: document.getElementById('tmsAlModalEditTitle')?.textContent,
			// 事前選択されたグループ ID
			groupId: document.getElementById('tmsAlEditGroupId')?.value,
		};
		TMS_AL.ScreenModalEdit.Close();
		addFromDevBtn?.click();
		// 開発グループから開いた新規モーダル。開閉は変えない
		const addFromDev = {
			// 登録モーダルが見えているか
			modalVisible: !document.getElementById('tmsAlModalEdit')?.hidden,
			// 事前選択されたグループ ID
			groupId: document.getElementById('tmsAlEditGroupId')?.value,
			// 追加クリックでグループ開閉が変わったか。変わらないはず
			groupToggled: groupDev?.classList.contains('tms-al-group--expanded') !== groupDevExpandedBefore,
		};
		TMS_AL.ScreenModalEdit.Close();
		document.getElementById('tmsAlBtnAdd')?.click();
		// フッターの追加。グループは未指定
		const addFromFooter = {
			// 登録モーダルが見えているか
			modalVisible: !document.getElementById('tmsAlModalEdit')?.hidden,
			// 見出し。新規なので追加
			title: document.getElementById('tmsAlModalEditTitle')?.textContent,
		};
		TMS_AL.ScreenModalEdit.Close();

		await TMS_AL.Theme.Apply('dark');
		return {
			// 文字単位検索の初期表示
			initial,
			// 検索操作で起動したアプリ ID
			launchIds: searchLaunchIds,
			// 管理者起動の最後の呼び出し
			contextAction,
			// 検索プレビューの見た目
			preview,
			// Escape で検索を消したあと
			cleared,
			// teams 検索の並びと強調
			teamsSearch,
			// 検索欄以外での Escape
			globalCleared,
			// モーダルが無いときのウィンドウフォーカス
			windowFocus,
			// 設定モーダルを開いたときのウィンドウフォーカス
			modalWindowFocus,
			// 再描画後の起動中表示
			running,
			// 右クリックがメニューへ届いたか
			contextMenu,
			// 連絡グループからの追加
			addFromChat,
			// 開発グループからの追加
			addFromDev,
			// フッターからの追加
			addFromFooter,
			// ダークテーマのクラスが body に付いたか
			darkTheme: document.body.classList.contains('tms-al-theme-dark'),
		};
	})()`);

		// 期待した表示と操作がすべて揃ったか。一つでも欠けると失敗
		const passed =
			result.initial.resultText === '開発：Visual Studio CodeCode.exe' &&
			JSON.stringify(result.initial.lineTexts) === JSON.stringify(['開発：Visual Studio Code', 'Code.exe']) &&
			result.initial.characterHighlights === 3 &&
			result.initial.resultCount === 1 &&
			JSON.stringify(result.launchIds) === JSON.stringify(['a-code', 'a-code']) &&
			result.contextAction.appId === 'a-code' &&
			result.contextAction.runAsAdmin &&
			result.preview.groupExpanded &&
			result.preview.rowHighlighted &&
			result.preview.persistedState === false &&
			result.cleared.inputValue === '' &&
			result.cleared.resultsHidden &&
			!result.cleared.groupExpanded &&
			result.teamsSearch.labels[0] === '連絡：Microsoft Teamsms-teams.exe' &&
			result.teamsSearch.labels[1] === '連絡：ms-teamsms-teams.exe' &&
			result.teamsSearch.labels[2] === '開発：TAME Sort UtilityTameSort.exe' &&
			JSON.stringify(result.teamsSearch.lineTexts[0]) === JSON.stringify(['連絡：Microsoft Teams', 'ms-teams.exe']) &&
			JSON.stringify(result.teamsSearch.lineTexts[1]) === JSON.stringify(['連絡：ms-teams', 'ms-teams.exe']) &&
			JSON.stringify(result.teamsSearch.lineTexts[2]) === JSON.stringify(['開発：TAME Sort Utility', 'TameSort.exe']) &&
			JSON.stringify(result.teamsSearch.partialHighlightCounts) === JSON.stringify([2, 2, 0]) &&
			JSON.stringify(result.teamsSearch.characterHighlightCounts) === JSON.stringify([0, 0, 10]) &&
			result.teamsSearch.hasSeparator &&
			result.teamsSearch.resultCount === 3 &&
			result.globalCleared.inputValue === '' &&
			result.globalCleared.resultsHidden &&
			result.globalCleared.activeElementId === 'tmsAlBtnCollapseAll' &&
			result.windowFocus.activeElementId === 'tmsAlSearchInput' &&
			result.modalWindowFocus.activeElementId === 'tmsAlBtnSettingsClose' &&
			result.running.classApplied &&
			result.running.dotVisible &&
			result.contextMenu.count === 1 &&
			result.contextMenu.appId === 'a-code' &&
			result.contextMenu.defaultPrevented &&
			result.addFromChat.modalVisible &&
			result.addFromChat.title === 'アプリを追加' &&
			result.addFromChat.groupId === 'g-chat' &&
			result.addFromDev.modalVisible &&
			result.addFromDev.groupId === 'g-dev' &&
			!result.addFromDev.groupToggled &&
			result.addFromFooter.modalVisible &&
			result.addFromFooter.title === 'アプリを追加' &&
			result.darkTheme;

		// 期待と違うときは結果 JSON 付きで失敗させる
		if (!passed) {
			throw new Error(`UI integration test failed: ${JSON.stringify(result)}`);
		}

		console.log('UI integration tests passed');
		win.destroy();
		app.quit();
	})
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});
