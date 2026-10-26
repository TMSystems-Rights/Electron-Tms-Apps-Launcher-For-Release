/**
 * アプリの登録と編集の入力を受け、保存を launcherApi へ依頼する
 * パスの存在確認は main に任せ、このファイルは入力中の値だけを持つ
 * @file
 */
'use strict';

/**
 * 登録・編集モーダル
 * @namespace TMS_AL
 */
TMS_AL.ScreenModalEdit = {
	/** @type {'new' | 'edit' | null} */
	_mode: null,

	/** @type {string | null} */
	_editingAppId: null,

	/** @type {'auto' | 'custom'} */
	_iconMode: 'auto',

	/** @type {string} */
	_customIconPath: '',

	/** 保存デバウンスタイマー */
	_pathUpdateTimer: null,

	/**
	 * 実行パス入力欄を正規化する（両端ダブルクォート除去）
	 * @returns {string} 正規化後パス
	 */
	NormalizePathInput: function () {
		// 実行パス欄。無いときは空文字で、呼び出し側は保存できない
		const pathEl = document.getElementById('tmsAlEditAppPath');

		// 入力欄が無いと正規化できない
		if (!pathEl) {
			return TMS_AL_COMMON.Const.BLANK;
		}

		// 両端のダブルクォートを除いたパス。空入力は空文字
		const normalized = TMS_AL_COMMON.Funcs.StripExecutablePathQuotes(pathEl.value);

		// 表示中の文字列と違うときだけ欄を書き換える。同じならキャレットを動かさない
		if (normalized !== pathEl.value) {
			pathEl.value = normalized;
		}

		return normalized;
	},

	/**
	 * モーダルを初期化する
	 */
	Init: function () {
		// 保存ボタン。無いときはクリックで保存できない
		const btnSave       = document.getElementById('tmsAlBtnEditSave');
		// キャンセルボタン。無いときはクリックで閉じられない
		const btnCancel     = document.getElementById('tmsAlBtnEditCancel');
		// 実行パスの参照ボタン。無いときはダイアログを開けない
		const btnBrowse     = document.getElementById('tmsAlBtnEditBrowsePath');
		// カスタムアイコン選択ボタン。無いときは画像を選べない
		const btnIconCustom = document.getElementById('tmsAlBtnEditIconCustom');
		// 自動アイコンへ戻すボタン。無いときは手動か戻せない
		const btnIconAuto   = document.getElementById('tmsAlBtnEditIconAuto');
		// 背景。無いときは背景クリックで閉じられない
		const btnBackdrop   = document.getElementById('tmsAlModalEditBackdrop');
		// 実行パス欄。無いときは入力監視とドロップを付けない
		const inputPath     = document.getElementById('tmsAlEditAppPath');

		// 保存ボタンがあるときだけ保存クリックを受ける
		if (btnSave) {
			btnSave.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.Save();
			});
		}

		// キャンセルボタンがあるときだけ閉じるクリックを受ける
		if (btnCancel) {
			btnCancel.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.Close();
			});
		}

		// 背景があるときだけ背景クリックで閉じる
		if (btnBackdrop) {
			btnBackdrop.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.Close();
			});
		}

		// 参照ボタンがあるときだけファイルダイアログを開く
		if (btnBrowse) {
			btnBrowse.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.BrowsePath();
			});
		}

		// カスタムアイコンボタンがあるときだけ画像選択を開く
		if (btnIconCustom) {
			btnIconCustom.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.SelectCustomIcon();
			});
		}

		// 自動アイコンボタンがあるときだけ抽出アイコンへ戻す
		if (btnIconAuto) {
			btnIconAuto.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.ResetIconToAuto();
			});
		}

		// 実行パス欄があるときだけ入力、貼り付け、ドロップを受ける
		if (inputPath) {
			inputPath.addEventListener('input', () => {
				TMS_AL.ScreenModalEdit.SchedulePathUpdate();
			});

			inputPath.addEventListener('paste', () => {
				setTimeout(() => {
					TMS_AL.ScreenModalEdit.NormalizePathInput();
					TMS_AL.ScreenModalEdit.SchedulePathUpdate();
				}, 0);
			});

			TMS_AL.ScreenModalEdit.InitPathDropTarget(inputPath);
		}

		document.addEventListener('keydown', (event) => {
			// 登録モーダル。無い、または非表示ならこのキーはモーダル向けではない
			const modal = document.getElementById('tmsAlModalEdit');

			// モーダルが無い、または隠れているときは何もしない。どちらか一方で足りる
			if (!modal || modal.hidden) {
				return;
			}

			// Escape は編集を捨てて閉じる
			if (event.key === 'Escape') {
				TMS_AL.ScreenModalEdit.Close();
			}

			// Enter であり、かつ対象がテキスト入力のときだけ保存する。ボタン上の Enter は保存にしない
			if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
				event.preventDefault();
				TMS_AL.ScreenModalEdit.Save();
			}
		});
	},

	/**
	 * 新規モードで開く
	 * @param {string} [groupId] 事前選択する所属グループID
	 */
	OpenNew: function (groupId) {
		TMS_AL.ScreenModalEdit._mode           = 'new';
		TMS_AL.ScreenModalEdit._editingAppId   = null;
		TMS_AL.ScreenModalEdit._iconMode       = 'auto';
		TMS_AL.ScreenModalEdit._customIconPath = TMS_AL_COMMON.Const.BLANK;

		// 見出し要素。無いときは文言を変えない
		const titleEl = document.getElementById('tmsAlModalEditTitle');

		// 見出しがあるときだけ新規用の文言にする
		if (titleEl) {
			titleEl.textContent = 'アプリを追加';
		}

		TMS_AL.ScreenModalEdit.ResetForm();
		TMS_AL.ScreenModalEdit.PopulateGroupDropdown(groupId);
		TMS_AL.ScreenModalEdit.Show();
	},

	/**
	 * 編集モードで開く
	 * @param {string} appId アプリID
	 */
	OpenEdit: function (appId) {
		// 表示中の保存データ。未読込なら編集できない
		const data = TMS_AL.ScreenMain._data;
		// 編集対象のアプリ。ID が無いときは開かない
		const app  = data?.apps.find((item) => item.id === appId);

		// 対象アプリが無いときはモーダルを開かない
		if (!app) {
			return;
		}

		TMS_AL.ScreenModalEdit._mode           = 'edit';
		TMS_AL.ScreenModalEdit._editingAppId   = appId;
		TMS_AL.ScreenModalEdit._iconMode       = app.iconMode;
		TMS_AL.ScreenModalEdit._customIconPath = app.customIconPath;

		// ----------------------------------------------
		// 見出し。無いときは文言を変えない
		const titleEl = document.getElementById('tmsAlModalEditTitle');
		// アプリ名欄。無いときは名前を埋めない
		const nameEl  = document.getElementById('tmsAlEditAppName');
		// 実行パス欄。無いときはパスを埋めない
		const pathEl  = document.getElementById('tmsAlEditAppPath');
		// 所属グループ欄。無いときは選択を埋めない
		const groupEl = document.getElementById('tmsAlEditGroupId');

		// 見出しがあるときだけ編集用の文言にする
		if (titleEl) {
			titleEl.textContent = 'アプリを編集';
		}

		// 名前欄があるときだけ現在の名前を入れる
		if (nameEl) {
			nameEl.value = app.name;
		}

		// パス欄があるときだけ現在のパスを入れる
		if (pathEl) {
			pathEl.value = app.path;
		}

		TMS_AL.ScreenModalEdit.PopulateGroupDropdown(app.groupId);

		// グループ欄があるときだけ所属を選ぶ。選択肢の構築より後でないと値が残らない
		if (groupEl) {
			groupEl.value = app.groupId;
		}

		TMS_AL.ScreenModalEdit.UpdatePathWarning(app.path);
		TMS_AL.ScreenModalEdit.UpdateIconPreview(app.path);
		TMS_AL.ScreenModalEdit.Show();
	},

	/**
	 * フォームをリセットする
	 */
	ResetForm: function () {
		// アプリ名欄。無いときは空にできない
		const nameEl = document.getElementById('tmsAlEditAppName');
		// 実行パス欄。無いときは空にできない
		const pathEl = document.getElementById('tmsAlEditAppPath');
		// パス警告。無いときは非表示にできない
		const warnEl = document.getElementById('tmsAlEditPathWarn');

		// 名前欄があるときだけ空にする
		if (nameEl) {
			nameEl.value = TMS_AL_COMMON.Const.BLANK;
		}

		// パス欄があるときだけ空にする
		if (pathEl) {
			pathEl.value = TMS_AL_COMMON.Const.BLANK;
		}

		// 警告要素があるときだけ隠す
		if (warnEl) {
			warnEl.hidden = true;
		}

		TMS_AL.ScreenModalEdit.UpdateIconPreview(TMS_AL_COMMON.Const.BLANK);
	},

	/**
	 * グループドロップダウンを構築する
	 * @param {string} [selectedGroupId=''] 選択グループID
	 */
	PopulateGroupDropdown: function (selectedGroupId) {
		// 所属グループの select。無いと選択肢を作れない
		const groupEl = document.getElementById('tmsAlEditGroupId');
		// 表示中の保存データ。未読込ならグループが無い
		const data    = TMS_AL.ScreenMain._data;

		// 選択欄か保存データが無いと選択肢を作れない。どちらか欠けると何もしない
		if (!groupEl || !data) {
			return;
		}

		// プルダウン用の並び。未分類が先頭
		const sorted = TMS_AL.ScreenMain.GetGroupsForDropdown();

		groupEl.innerHTML = '';

		// ドロップダウンに出すグループ。並び順は GetGroupsForDropdown の結果
		for (const group of sorted) {
			// 1 件分の option。value はグループ ID
			const option       = document.createElement('option');
			option.value       = group.id;
			option.textContent = group.name;
			groupEl.appendChild(option);
		}

		// 呼び出し側がグループ ID を渡したときはそれを選んで終わる。空なら未分類へ落とす
		if (selectedGroupId) {
			groupEl.value = selectedGroupId;
			return;
		}

		// 未分類グループ。保存データに無いときは選択を変えない
		const uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();

		// 未分類があるときだけそれを既定選択にする
		if (uncategorized) {
			groupEl.value = uncategorized.id;
		}
	},

	/**
	 * モーダルを表示する
	 */
	Show: function () {
		// 登録モーダル。無いときは表示できない
		const modal = document.getElementById('tmsAlModalEdit');

		// モーダルがあるときだけ表示する
		if (modal) {
			modal.hidden = false;
		}

		// 実行パス欄。無いときはフォーカスしない
		const pathEl = document.getElementById('tmsAlEditAppPath');

		// パス欄があるときだけフォーカスする。新規でも編集でもパスから入れさせる
		if (pathEl) {
			pathEl.focus();
		}
	},

	/**
	 * モーダルを閉じる
	 */
	Close: function () {
		// 登録モーダル。無いときは非表示にできない
		const modal = document.getElementById('tmsAlModalEdit');

		// モーダルがあるときだけ隠す
		if (modal) {
			modal.hidden = true;
		}

		TMS_AL.ScreenModalEdit._mode         = null;
		TMS_AL.ScreenModalEdit._editingAppId = null;
	},

	/**
	 * 実行パス入力欄にドラッグ＆ドロップを設定する
	 * @param {HTMLInputElement} inputPath 実行パス入力欄
	 */
	InitPathDropTarget: function (inputPath) {
		// ドロップを受ける要素。パス行が無いときは入力欄そのもの
		const dropTarget = inputPath.closest('.tms-al-form-row__path-row') ?? inputPath;
		// 入った回数から出た回数を引いた深さ。0 のときだけ強調を外す。子要素の出入りでは外さない
		let dragDepth    = 0;

		/**
		 * @param {DragEvent} event
		 * @returns {boolean}
		 */
		const isFileDrag = (event) => event.dataTransfer?.types?.includes('Files') === true;

		dropTarget.addEventListener('dragenter', (event) => {
			// ファイル以外のドラッグはパス入力に使わない
			if (!isFileDrag(event)) {
				return;
			}

			event.preventDefault();
			dragDepth += 1;
			dropTarget.classList.add('tms-al-form-row__path-row--dragover');
		});

		dropTarget.addEventListener('dragover', (event) => {
			// ファイル以外はドロップを許可しない
			if (!isFileDrag(event)) {
				return;
			}

			event.preventDefault();

			// dataTransfer があるときだけコピー操作だと示す。無いとカーソルは変えられない
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
		});

		dropTarget.addEventListener('dragleave', (event) => {
			// ファイル以外の離脱では深さを変えない
			if (!isFileDrag(event)) {
				return;
			}

			dragDepth = Math.max(0, dragDepth - 1);

			// 入れ子の子から出ただけでは外さない。深さが 0 のときだけ強調を消す
			if (dragDepth === 0) {
				dropTarget.classList.remove('tms-al-form-row__path-row--dragover');
			}
		});

		dropTarget.addEventListener('drop', async (event) => {
			// ファイル以外のドロップはパスにしない
			if (!isFileDrag(event)) {
				return;
			}

			event.preventDefault();
			dragDepth = 0;
			dropTarget.classList.remove('tms-al-form-row__path-row--dragover');

			// ドロップから取り出したパス。取れないときは空文字
			const filePath = TMS_AL.ScreenModalEdit.ExtractDroppedFilePath(event);

			// パスが空なら入力欄を変えない
			if (TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
				return;
			}

			await TMS_AL.ScreenModalEdit.ApplyPathValue(filePath);
		});
	},

	/**
	 * ドロップイベントからファイルパスを取得する
	 * @param {DragEvent} event ドロップイベント
	 * @returns {string} ファイルパス（取得できない場合は空文字）
	 */
	ExtractDroppedFilePath: function (event) {
		// ドロップされたファイル一覧。dataTransfer が無いときは undefined
		const files = event.dataTransfer?.files;

		// ファイルが 1 件以上あるときだけ File からパスを取る。0 件なら URI 文字列へ落とす
		if (files && files.length > 0) {
			// Electron が File から解決したパス。解決できないときは空
			const filePath = window.launcherApi.getPathForFile(files[0]);

			// パスが取れたらそれを返す。空なら URI の解釈へ進む
			if (!TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
				return filePath;
			}
		}

		// file URI かプレーンテキスト。どちらも無いときは空文字で、パスにはならない
		const uriList = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain') || TMS_AL_COMMON.Const.BLANK;

		return TMS_AL.ScreenModalEdit.FileUriToPath(uriList);
	},

	/**
	 * file:// URI を Windows パスに変換する
	 * @param {string} uriList URI 文字列
	 * @returns {string} ファイルパス
	 */
	FileUriToPath: function (uriList) {
		// 最初の file:// 行。無いときは undefined で、パスにはできない
		const uri = uriList
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.startsWith('file://'));

		// file URI が無いときは空文字
		if (!uri) {
			return TMS_AL_COMMON.Const.BLANK;
		}

		try {
			// URL として解釈したパス。不正な URI は catch で空文字になる
			let filePath = decodeURIComponent(new URL(uri).pathname);

			// `/C:` のようにドライブ文字の前にスラッシュがあるときだけ、その 1 文字を除く
			if (/^\/[A-Za-z]:/.test(filePath)) {
				filePath = filePath.slice(1);
			}

			return filePath.replace(/\//g, '\\');
		} catch {
			return TMS_AL_COMMON.Const.BLANK;
		}
	},

	/**
	 * 実行パス入力欄にパスを反映する
	 * @param {string} filePath 実行パス
	 * @returns {Promise<void>}
	 */
	ApplyPathValue: async function (filePath) {
		// 実行パス欄。無いときは反映できない
		const pathEl = document.getElementById('tmsAlEditAppPath');

		// 入力欄が無いときは何もしない
		if (!pathEl) {
			return;
		}

		pathEl.value = TMS_AL_COMMON.Funcs.StripExecutablePathQuotes(filePath);
		await TMS_AL.ScreenModalEdit.OnPathChanged(pathEl.value);
	},

	/**
	 * 実行パス参照ダイアログ
	 * @returns {Promise<void>}
	 */
	BrowsePath: async function () {
		// ダイアログで選んだパス。キャンセル時は空扱いで反映しない
		const selected = await window.launcherApi.openExecutableDialog();

		// 選択が無いときは入力欄を変えない
		if (!selected) {
			return;
		}

		await TMS_AL.ScreenModalEdit.ApplyPathValue(selected);
	},

	/**
	 * パス変更のデバウンス
	 */
	SchedulePathUpdate: function () {
		// 前回の待機が残っているときだけ取り消す。連続入力では最後の 1 回だけ反映する
		if (TMS_AL.ScreenModalEdit._pathUpdateTimer) {
			clearTimeout(TMS_AL.ScreenModalEdit._pathUpdateTimer);
		}

		TMS_AL.ScreenModalEdit._pathUpdateTimer = setTimeout(async () => {
			// 両端クォートを除いた現在のパス。空なら警告と名前補完は空として扱う
			const path = TMS_AL.ScreenModalEdit.NormalizePathInput();

			await TMS_AL.ScreenModalEdit.OnPathChanged(path);
		}, 300);
	},

	/**
	 * パス変更時の処理
	 * @param {string} filePath 実行パス
	 * @returns {Promise<void>}
	 */
	OnPathChanged: async function (filePath) {
		// 両端クォートを除いたパス。警告とアイコンと名前補完はこれを使う
		const normalized = TMS_AL_COMMON.Funcs.StripExecutablePathQuotes(filePath);

		TMS_AL.ScreenModalEdit.UpdatePathWarning(normalized);

		// 自動アイコンのときだけプレビューをパスから取り直す。カスタム中は選択画像を維持する
		if (TMS_AL.ScreenModalEdit._iconMode === 'auto') {
			await TMS_AL.ScreenModalEdit.UpdateIconPreview(normalized);
		}

		// ----------------------------------------------
		// アプリ名欄。無いときは名前を自動で埋めない
		const nameEl = document.getElementById('tmsAlEditAppName');

		// 名前欄があり、名前が空で、かつパスがあるときだけアプリ名を補完する。どれか欠けると既存の名前を残す
		if (nameEl && TMS_AL_COMMON.Funcs.IsEmpty(nameEl.value) && !TMS_AL_COMMON.Funcs.IsEmpty(normalized)) {
			// パスから解決した表示名。解決できないときの文言は main 側に任せる
			const resolved = await window.launcherApi.resolveAppName(normalized);
			nameEl.value   = resolved;
		}
	},

	/**
	 * パス警告表示を更新する
	 * @param {string} filePath 実行パス
	 */
	UpdatePathWarning: function (filePath) {
		// パス警告の要素。無いときは表示を切り替えられない
		const warnEl = document.getElementById('tmsAlEditPathWarn');

		// 警告要素が無いときは何もしない
		if (!warnEl) {
			return;
		}

		// パスが空なら警告を出さない
		if (TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
			warnEl.hidden = true;
			return;
		}

		window.launcherApi.isValidExecutablePath(filePath).then((valid) => {
			// 実行ファイルとして不正なパスは警告を出す
			if (!valid) {
				warnEl.hidden = false;
				return;
			}

			window.launcherApi.pathExists(filePath).then((exists) => {
				warnEl.hidden = exists;
			});
		});
	},

	/**
	 * アイコンプレビューを更新する
	 * @param {string} filePath 実行パス
	 * @returns {Promise<void>}
	 */
	UpdateIconPreview: async function (filePath) {
		// プレビュー画像。無いとアイコンを出せない
		const imgEl      = document.getElementById('tmsAlEditIconPreview');
		// 画像が無いときの代替表示。無いと切り替えられない
		const fallbackEl = document.getElementById('tmsAlEditIconFallback');

		// 画像か代替表示が無いとプレビューを更新できない。どちらか欠けると何もしない
		if (!imgEl || !fallbackEl) {
			return;
		}

		// 表示に使うパス。カスタム指定が無ければ引数の実行パス
		let iconPath = filePath;

		// カスタムモードであり、かつカスタムパスがあるときだけ実行パスの代わりにその画像を使う。どちらか欠けると実行パスのまま
		if (TMS_AL.ScreenModalEdit._iconMode === 'custom' && TMS_AL.ScreenModalEdit._customIconPath) {
			iconPath = TMS_AL.ScreenModalEdit._customIconPath;
		}

		// 表示するパスが空なら画像を隠して代替表示にする
		if (TMS_AL_COMMON.Funcs.IsEmpty(iconPath)) {
			imgEl.hidden      = true;
			fallbackEl.hidden = false;
			return;
		}

		// 取得したアイコンの data URL。取れないときは空
		const dataUrl = await window.launcherApi.getIcon(iconPath);

		// data URL があるときだけ画像を出す
		if (dataUrl) {
			imgEl.src         = dataUrl;
			imgEl.hidden      = false;
			fallbackEl.hidden = true;
		} else {
			imgEl.hidden      = true;
			fallbackEl.hidden = false;
		}
	},

	/**
	 * カスタムアイコンを選択する
	 * @returns {Promise<void>}
	 */
	SelectCustomIcon: async function () {
		// 選んだ画像パス。キャンセル時は空で、現在のアイコンを維持する
		const selected = await window.launcherApi.openImageDialog();

		// 選択が無いときはモードもプレビューも変えない
		if (!selected) {
			return;
		}

		TMS_AL.ScreenModalEdit._iconMode       = 'custom';
		TMS_AL.ScreenModalEdit._customIconPath = selected;
		await TMS_AL.ScreenModalEdit.UpdateIconPreview(selected);
	},

	/**
	 * 自動抽出アイコンに戻す
	 * @returns {Promise<void>}
	 */
	ResetIconToAuto: async function () {
		TMS_AL.ScreenModalEdit._iconMode       = 'auto';
		TMS_AL.ScreenModalEdit._customIconPath = TMS_AL_COMMON.Const.BLANK;

		// 現在の実行パス。空ならプレビューは代替表示になる
		const path = TMS_AL.ScreenModalEdit.NormalizePathInput();

		await TMS_AL.ScreenModalEdit.UpdateIconPreview(path);

		// ----------------------------------------------
		// アプリ名欄。無いときは名前を取り直さない
		const nameEl = document.getElementById('tmsAlEditAppName');

		// 名前欄があり、かつパスが空でないときだけ表示名を取り直す。どちらか欠けると名前欄は触らない
		if (nameEl && !TMS_AL_COMMON.Funcs.IsEmpty(path)) {
			nameEl.value = await window.launcherApi.resolveAppName(path);
		}
	},

	/**
	 * 保存処理
	 * @returns {Promise<void>}
	 */
	Save: async function () {
		// 表示中の保存データ。未読込なら保存できない
		const data    = TMS_AL.ScreenMain._data;
		// アプリ名欄。無いときは空名として後でパスから補完する
		const nameEl  = document.getElementById('tmsAlEditAppName');
		// 実行パス欄。無いと保存できない
		const pathEl  = document.getElementById('tmsAlEditAppPath');
		// 所属グループ欄。無いと保存できない
		const groupEl = document.getElementById('tmsAlEditGroupId');

		// 保存データ、パス欄、グループ欄のどれかが無いと保存できない
		if (!data || !pathEl || !groupEl) {
			return;
		}

		// 両端クォートを除いた実行パス。空なら保存しない
		let appPath = TMS_AL.ScreenModalEdit.NormalizePathInput();
		// 前後空白を除いたアプリ名。欄が無い、または空なら後でパスから補完する
		let appName = nameEl?.value.trim() ?? TMS_AL_COMMON.Const.BLANK;
		// 選択中のグループ ID。空なら未分類へ落とす
		let groupId = groupEl.value;

		// 実行パスが空なら保存しない
		if (TMS_AL_COMMON.Funcs.IsEmpty(appPath)) {
			TMS_AL_COMMON.Ui.ShowToast('実行パスを入力してください。', 'warn');
			return;
		}

		// パス欄があるときだけ正規化後の値を書き戻す。上で欠けるとここまで来ない
		if (pathEl) {
			pathEl.value = appPath;
		}

		// アプリ名が空のときだけパスから表示名を補完する
		if (TMS_AL_COMMON.Funcs.IsEmpty(appName)) {
			appName = await window.launcherApi.resolveAppName(appPath);
		}

		// 未分類グループ。所属が空のときの受け皿。保存データに無いときは ID を空のままにする
		const uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();

		// 所属が空であり、かつ未分類があるときだけそこへ入れる。どちらか欠けると選択値のまま
		if (TMS_AL_COMMON.Funcs.IsEmpty(groupId) && uncategorized) {
			groupId = uncategorized.id;
		}

		// ----------------------------------------------
		// 新規モードのときだけアプリを 1 件足す
		if (TMS_AL.ScreenModalEdit._mode === 'new') {
			// 同じグループ内の最大 order。アプリが無いときは -1 で、追加分は 0 になる
			const maxOrder = data.apps.filter((app) => app.groupId === groupId).reduce((max, app) => Math.max(max, app.order), -1);

			data.apps.push({
				// 新規アプリ ID。既存とぶつからないよう UUID を付ける
				id: `a-${TMS_AL_COMMON.Funcs.GenerateUuid()}`,
				// 表示名。空だった場合はパスから補完済み
				name: appName,
				// 正規化済みの実行パス
				path: appPath,
				// 起動引数。このモーダルでは編集しないので空
				args: TMS_AL_COMMON.Const.BLANK,
				// 作業ディレクトリ。このモーダルでは編集しないので空
				workingDir: TMS_AL_COMMON.Const.BLANK,
				// auto か custom。プレビューで選んだモード
				iconMode: TMS_AL.ScreenModalEdit._iconMode,
				// カスタム画像のパス。自動のときは空
				customIconPath: TMS_AL.ScreenModalEdit._customIconPath,
				// 所属グループ ID。空選択は未分類へ寄せ済み
				groupId: groupId,
				// グループ内の末尾。既存が無いときは 0
				order: maxOrder + 1
			});
			// 編集モードであり、かつ編集対象 ID があるときだけ既存行を上書きする。どちらか欠けるとデータを変えない
		} else if (TMS_AL.ScreenModalEdit._mode === 'edit' && TMS_AL.ScreenModalEdit._editingAppId) {
			// 上書きするアプリ。ID が消えていれば何もしない
			const app = data.apps.find((item) => item.id === TMS_AL.ScreenModalEdit._editingAppId);

			// 対象がまだ一覧にあるときだけフィールドを書き換える
			if (app) {
				app.name           = appName;
				app.path           = appPath;
				app.iconMode       = TMS_AL.ScreenModalEdit._iconMode;
				app.customIconPath = TMS_AL.ScreenModalEdit._customIconPath;
				app.groupId        = groupId;
			}
		}

		// ----------------------------------------------
		// 保存の成否。失敗時はモーダルを開いたままにする
		const saved = await TMS_AL.ScreenMain.SaveData();

		// 保存できたときだけ閉じて一覧を描き直す
		if (saved) {
			TMS_AL.ScreenModalEdit.Close();
			await TMS_AL.ScreenMain.Render();
		}
	}
};

TMS_AL.ScreenModalEdit.Init();
