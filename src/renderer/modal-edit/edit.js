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
		const pathEl = document.getElementById('tmsAlEditAppPath');

		if (!pathEl) {
			return TMS_AL_COMMON.Const.BLANK;
		}

		const normalized = TMS_AL_COMMON.Funcs.StripExecutablePathQuotes(pathEl.value);

		if (normalized !== pathEl.value) {
			pathEl.value = normalized;
		}

		return normalized;
	},

	/**
	 * モーダルを初期化する
	 * @returns {void}
	 */
	Init: function () {
		const btnSave       = document.getElementById('tmsAlBtnEditSave');
		const btnCancel     = document.getElementById('tmsAlBtnEditCancel');
		const btnBrowse     = document.getElementById('tmsAlBtnEditBrowsePath');
		const btnIconCustom = document.getElementById('tmsAlBtnEditIconCustom');
		const btnIconAuto   = document.getElementById('tmsAlBtnEditIconAuto');
		const btnBackdrop   = document.getElementById('tmsAlModalEditBackdrop');
		const inputPath     = document.getElementById('tmsAlEditAppPath');

		if (btnSave) {
			btnSave.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.Save();
			});
		}

		if (btnCancel) {
			btnCancel.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.Close();
			});
		}

		if (btnBackdrop) {
			btnBackdrop.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.Close();
			});
		}

		if (btnBrowse) {
			btnBrowse.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.BrowsePath();
			});
		}

		if (btnIconCustom) {
			btnIconCustom.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.SelectCustomIcon();
			});
		}

		if (btnIconAuto) {
			btnIconAuto.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.ResetIconToAuto();
			});
		}

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
			const modal = document.getElementById('tmsAlModalEdit');

			if (!modal || modal.hidden) {
				return;
			}

			if (event.key === 'Escape') {
				TMS_AL.ScreenModalEdit.Close();
			}

			if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
				event.preventDefault();
				TMS_AL.ScreenModalEdit.Save();
			}
		});
	},

	/**
	 * 新規モードで開く
	 * @returns {void}
	 */
	OpenNew: function () {
		TMS_AL.ScreenModalEdit._mode           = 'new';
		TMS_AL.ScreenModalEdit._editingAppId   = null;
		TMS_AL.ScreenModalEdit._iconMode       = 'auto';
		TMS_AL.ScreenModalEdit._customIconPath = TMS_AL_COMMON.Const.BLANK;

		const titleEl = document.getElementById('tmsAlModalEditTitle');

		if (titleEl) {
			titleEl.textContent = 'アプリを追加';
		}

		TMS_AL.ScreenModalEdit.ResetForm();
		TMS_AL.ScreenModalEdit.PopulateGroupDropdown();
		TMS_AL.ScreenModalEdit.Show();
	},

	/**
	 * 編集モードで開く
	 * @param {string} appId アプリID
	 * @returns {void}
	 */
	OpenEdit: function (appId) {
		const data = TMS_AL.ScreenMain._data;
		const app  = data?.apps.find((item) => item.id === appId);

		if (!app) {
			return;
		}

		TMS_AL.ScreenModalEdit._mode           = 'edit';
		TMS_AL.ScreenModalEdit._editingAppId   = appId;
		TMS_AL.ScreenModalEdit._iconMode       = app.iconMode;
		TMS_AL.ScreenModalEdit._customIconPath = app.customIconPath;

		const titleEl = document.getElementById('tmsAlModalEditTitle');
		const nameEl  = document.getElementById('tmsAlEditAppName');
		const pathEl  = document.getElementById('tmsAlEditAppPath');
		const groupEl = document.getElementById('tmsAlEditGroupId');

		if (titleEl) {
			titleEl.textContent = 'アプリを編集';
		}

		if (nameEl) {
			nameEl.value = app.name;
		}

		if (pathEl) {
			pathEl.value = app.path;
		}

		TMS_AL.ScreenModalEdit.PopulateGroupDropdown(app.groupId);

		if (groupEl) {
			groupEl.value = app.groupId;
		}

		TMS_AL.ScreenModalEdit.UpdatePathWarning(app.path);
		TMS_AL.ScreenModalEdit.UpdateIconPreview(app.path);
		TMS_AL.ScreenModalEdit.Show();
	},

	/**
	 * フォームをリセットする
	 * @returns {void}
	 */
	ResetForm: function () {
		const nameEl = document.getElementById('tmsAlEditAppName');
		const pathEl = document.getElementById('tmsAlEditAppPath');
		const warnEl = document.getElementById('tmsAlEditPathWarn');

		if (nameEl) {
			nameEl.value = TMS_AL_COMMON.Const.BLANK;
		}

		if (pathEl) {
			pathEl.value = TMS_AL_COMMON.Const.BLANK;
		}

		if (warnEl) {
			warnEl.hidden = true;
		}

		TMS_AL.ScreenModalEdit.UpdateIconPreview(TMS_AL_COMMON.Const.BLANK);
	},

	/**
	 * グループドロップダウンを構築する
	 * @param {string} [selectedGroupId=''] 選択グループID
	 * @returns {void}
	 */
	PopulateGroupDropdown: function (selectedGroupId) {
		const groupEl = document.getElementById('tmsAlEditGroupId');
		const data    = TMS_AL.ScreenMain._data;

		if (!groupEl || !data) {
			return;
		}

		const sorted = TMS_AL.ScreenMain.GetGroupsForDropdown();

		groupEl.innerHTML = '';

		for (const group of sorted) {
			const option       = document.createElement('option');
			option.value       = group.id;
			option.textContent = group.name;
			groupEl.appendChild(option);
		}

		if (selectedGroupId) {
			groupEl.value = selectedGroupId;
			return;
		}

		const uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();

		if (uncategorized) {
			groupEl.value = uncategorized.id;
		}
	},

	/**
	 * モーダルを表示する
	 * @returns {void}
	 */
	Show: function () {
		const modal = document.getElementById('tmsAlModalEdit');

		if (modal) {
			modal.hidden = false;
		}

		const pathEl = document.getElementById('tmsAlEditAppPath');

		if (pathEl) {
			pathEl.focus();
		}
	},

	/**
	 * モーダルを閉じる
	 * @returns {void}
	 */
	Close: function () {
		const modal = document.getElementById('tmsAlModalEdit');

		if (modal) {
			modal.hidden = true;
		}

		TMS_AL.ScreenModalEdit._mode         = null;
		TMS_AL.ScreenModalEdit._editingAppId = null;
	},

	/**
	 * 実行パス入力欄にドラッグ＆ドロップを設定する
	 * @param {HTMLInputElement} inputPath 実行パス入力欄
	 * @returns {void}
	 */
	InitPathDropTarget: function (inputPath) {
		const dropTarget = inputPath.closest('.tms-al-form-row__path-row') ?? inputPath;
		let dragDepth    = 0;

		/**
		 * @param {DragEvent} event
		 * @returns {boolean}
		 */
		const isFileDrag = (event) => event.dataTransfer?.types?.includes('Files') === true;

		dropTarget.addEventListener('dragenter', (event) => {
			if (!isFileDrag(event)) {
				return;
			}

			event.preventDefault();
			dragDepth += 1;
			dropTarget.classList.add('tms-al-form-row__path-row--dragover');
		});

		dropTarget.addEventListener('dragover', (event) => {
			if (!isFileDrag(event)) {
				return;
			}

			event.preventDefault();

			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
		});

		dropTarget.addEventListener('dragleave', (event) => {
			if (!isFileDrag(event)) {
				return;
			}

			dragDepth = Math.max(0, dragDepth - 1);

			if (dragDepth === 0) {
				dropTarget.classList.remove('tms-al-form-row__path-row--dragover');
			}
		});

		dropTarget.addEventListener('drop', async (event) => {
			if (!isFileDrag(event)) {
				return;
			}

			event.preventDefault();
			dragDepth = 0;
			dropTarget.classList.remove('tms-al-form-row__path-row--dragover');

			const filePath = TMS_AL.ScreenModalEdit.ExtractDroppedFilePath(event);

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
		const files = event.dataTransfer?.files;

		if (files && files.length > 0) {
			const filePath = window.launcherApi.getPathForFile(files[0]);

			if (!TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
				return filePath;
			}
		}

		const uriList = event.dataTransfer?.getData('text/uri-list')
			|| event.dataTransfer?.getData('text/plain')
			|| TMS_AL_COMMON.Const.BLANK;

		return TMS_AL.ScreenModalEdit.FileUriToPath(uriList);
	},

	/**
	 * file:// URI を Windows パスに変換する
	 * @param {string} uriList URI 文字列
	 * @returns {string} ファイルパス
	 */
	FileUriToPath: function (uriList) {
		const uri = uriList.split('\n').map((line) => line.trim()).find((line) => line.startsWith('file://'));

		if (!uri) {
			return TMS_AL_COMMON.Const.BLANK;
		}

		try {
			let filePath = decodeURIComponent(new URL(uri).pathname);

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
		const pathEl = document.getElementById('tmsAlEditAppPath');

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
		const selected = await window.launcherApi.openExecutableDialog();

		if (!selected) {
			return;
		}

		await TMS_AL.ScreenModalEdit.ApplyPathValue(selected);
	},

	/**
	 * パス変更のデバウンス
	 * @returns {void}
	 */
	SchedulePathUpdate: function () {
		if (TMS_AL.ScreenModalEdit._pathUpdateTimer) {
			clearTimeout(TMS_AL.ScreenModalEdit._pathUpdateTimer);
		}

		TMS_AL.ScreenModalEdit._pathUpdateTimer = setTimeout(async () => {
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
		const normalized = TMS_AL_COMMON.Funcs.StripExecutablePathQuotes(filePath);

		TMS_AL.ScreenModalEdit.UpdatePathWarning(normalized);

		if (TMS_AL.ScreenModalEdit._iconMode === 'auto') {
			await TMS_AL.ScreenModalEdit.UpdateIconPreview(normalized);
		}

		const nameEl = document.getElementById('tmsAlEditAppName');

		if (nameEl && TMS_AL_COMMON.Funcs.IsEmpty(nameEl.value) && !TMS_AL_COMMON.Funcs.IsEmpty(normalized)) {
			const resolved = await window.launcherApi.resolveAppName(normalized);
			nameEl.value   = resolved;
		}
	},

	/**
	 * パス警告表示を更新する
	 * @param {string} filePath 実行パス
	 * @returns {void}
	 */
	UpdatePathWarning: function (filePath) {
		const warnEl = document.getElementById('tmsAlEditPathWarn');

		if (!warnEl) {
			return;
		}

		if (TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
			warnEl.hidden = true;
			return;
		}

		window.launcherApi.isValidExecutablePath(filePath).then((valid) => {
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
		const imgEl      = document.getElementById('tmsAlEditIconPreview');
		const fallbackEl = document.getElementById('tmsAlEditIconFallback');

		if (!imgEl || !fallbackEl) {
			return;
		}

		let iconPath = filePath;

		if (TMS_AL.ScreenModalEdit._iconMode === 'custom' && TMS_AL.ScreenModalEdit._customIconPath) {
			iconPath = TMS_AL.ScreenModalEdit._customIconPath;
		}

		if (TMS_AL_COMMON.Funcs.IsEmpty(iconPath)) {
			imgEl.hidden      = true;
			fallbackEl.hidden = false;
			return;
		}

		const dataUrl = await window.launcherApi.getIcon(iconPath);

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
		const selected = await window.launcherApi.openImageDialog();

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

		const path = TMS_AL.ScreenModalEdit.NormalizePathInput();

		await TMS_AL.ScreenModalEdit.UpdateIconPreview(path);

		const nameEl = document.getElementById('tmsAlEditAppName');

		if (nameEl && !TMS_AL_COMMON.Funcs.IsEmpty(path)) {
			nameEl.value = await window.launcherApi.resolveAppName(path);
		}
	},

	/**
	 * 保存処理
	 * @returns {Promise<void>}
	 */
	Save: async function () {
		const data    = TMS_AL.ScreenMain._data;
		const nameEl  = document.getElementById('tmsAlEditAppName');
		const pathEl  = document.getElementById('tmsAlEditAppPath');
		const groupEl = document.getElementById('tmsAlEditGroupId');

		if (!data || !pathEl || !groupEl) {
			return;
		}

		let appPath = TMS_AL.ScreenModalEdit.NormalizePathInput();
		let appName = nameEl?.value.trim() ?? TMS_AL_COMMON.Const.BLANK;
		let groupId = groupEl.value;

		if (TMS_AL_COMMON.Funcs.IsEmpty(appPath)) {
			TMS_AL_COMMON.Ui.ShowToast('実行パスを入力してください。', 'warn');
			return;
		}

		if (pathEl) {
			pathEl.value = appPath;
		}

		if (TMS_AL_COMMON.Funcs.IsEmpty(appName)) {
			appName = await window.launcherApi.resolveAppName(appPath);
		}

		const uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();

		if (TMS_AL_COMMON.Funcs.IsEmpty(groupId) && uncategorized) {
			groupId = uncategorized.id;
		}

		if (TMS_AL.ScreenModalEdit._mode === 'new') {
			const maxOrder = data.apps
				.filter((app) => app.groupId === groupId)
				.reduce((max, app) => Math.max(max, app.order), -1);

			data.apps.push({
				id            : `a-${TMS_AL_COMMON.Funcs.GenerateUuid()}`,
				name          : appName,
				path          : appPath,
				args          : TMS_AL_COMMON.Const.BLANK,
				workingDir    : TMS_AL_COMMON.Const.BLANK,
				iconMode      : TMS_AL.ScreenModalEdit._iconMode,
				customIconPath: TMS_AL.ScreenModalEdit._customIconPath,
				groupId       : groupId,
				order         : maxOrder + 1,
			});
		} else if (TMS_AL.ScreenModalEdit._mode === 'edit' && TMS_AL.ScreenModalEdit._editingAppId) {
			const app = data.apps.find((item) => item.id === TMS_AL.ScreenModalEdit._editingAppId);

			if (app) {
				app.name           = appName;
				app.path           = appPath;
				app.iconMode       = TMS_AL.ScreenModalEdit._iconMode;
				app.customIconPath = TMS_AL.ScreenModalEdit._customIconPath;
				app.groupId        = groupId;
			}
		}

		const saved = await TMS_AL.ScreenMain.SaveData();

		if (saved) {
			TMS_AL.ScreenModalEdit.Close();
			await TMS_AL.ScreenMain.Render();
		}
	},
};

TMS_AL.ScreenModalEdit.Init();
