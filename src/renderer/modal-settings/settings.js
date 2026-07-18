'use strict';

/**
 * 設定モーダル
 * @namespace TMS_AL
 */
TMS_AL.ScreenModalSettings = {
	/** @type {string} */
	_dataDir: '',

	/** @type {string} */
	_defaultDataDir: '',

	/** @type {import('../../main/types').LauncherSettings | null} */
	_defaultSettings: null,

	/** @type {{ minWidth: number; minHeight: number; maxWidth: number; maxHeight: number }} */
	_windowLimits: {
		minWidth : 360,
		minHeight: 480,
		maxWidth : 1920,
		maxHeight: 1080,
	},

	/** @type {ReturnType<typeof setTimeout> | null} */
	_applyTimer: null,

	/** @type {boolean} */
	_isApplying: false,

	/**
	 * モーダルを初期化する
	 * @returns {void}
	 */
	Init: function () {
		const btnClose      = document.getElementById('tmsAlBtnSettingsClose');
		const btnResetAll   = document.getElementById('tmsAlBtnSettingsResetAll');
		const btnBrowseDir    = document.getElementById('tmsAlBtnSettingsBrowseDataDir');
		const btnUseCurrentSize = document.getElementById('tmsAlBtnSettingsUseCurrentSize');
		const btnCheckUpdate    = document.getElementById('tmsAlBtnSettingsCheckUpdate');
		const backdrop        = document.getElementById('tmsAlModalSettingsBackdrop');
		const inputDataDir  = document.getElementById('tmsAlSettingsDataDir');

		if (btnClose) {
			btnClose.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.Close();
			});
		}

		if (btnResetAll) {
			btnResetAll.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.ResetAll();
			});
		}

		if (btnBrowseDir) {
			btnBrowseDir.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.BrowseDataDir();
			});
		}

		if (btnUseCurrentSize) {
			btnUseCurrentSize.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.UseCurrentWindowSize();
			});
		}

		if (btnCheckUpdate) {
			btnCheckUpdate.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.CheckForUpdates();
			});
		}

		if (backdrop) {
			backdrop.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.Close();
			});
		}

		const settingInputs = [
			'tmsAlSettingsToggleInitial',
			'tmsAlSettingsAppearance',
			'tmsAlSettingsLaunchBehavior',
		];

		const rememberWindowSizeEl = document.getElementById('tmsAlSettingsRememberWindowSize');
		const paneCountEl          = document.getElementById('tmsAlSettingsPaneCount');
		const uncategorizedPaneEl  = document.getElementById('tmsAlSettingsUncategorizedPane');

		if (rememberWindowSizeEl instanceof HTMLInputElement) {
			rememberWindowSizeEl.addEventListener('change', () => {
				TMS_AL.ScreenModalSettings.ScheduleApply();
			});
		}

		if (paneCountEl instanceof HTMLSelectElement) {
			paneCountEl.addEventListener('change', () => {
				TMS_AL.ScreenModalSettings.UpdateUncategorizedPaneSectionVisibility();
				TMS_AL.ScreenModalSettings.UpdateUncategorizedPaneOptions();
				TMS_AL.ScreenModalSettings.ScheduleApply();
			});
		}

		if (uncategorizedPaneEl instanceof HTMLSelectElement) {
			uncategorizedPaneEl.addEventListener('change', () => {
				TMS_AL.ScreenModalSettings.ScheduleApply();
			});
		}

		for (const id of settingInputs) {
			const el = document.getElementById(id);

			if (el) {
				el.addEventListener('change', () => {
					TMS_AL.ScreenModalSettings.ScheduleApply();
				});

				el.addEventListener('input', () => {
					TMS_AL.ScreenModalSettings.ScheduleApply();
				});
			}
		}

		const windowSizeInputs = [
			'tmsAlSettingsWindowWidth',
			'tmsAlSettingsWindowHeight',
		];

		for (const id of windowSizeInputs) {
			const el = document.getElementById(id);

			if (el) {
				el.addEventListener('change', () => {
					TMS_AL.ScreenModalSettings.ScheduleApply();
				});
			}
		}

		if (inputDataDir instanceof HTMLInputElement) {
			inputDataDir.addEventListener('change', () => {
				TMS_AL.ScreenModalSettings.ApplyDataDirChange();
			});
		}

		const resetButtons = document.querySelectorAll('[data-settings-reset]');

		for (const button of resetButtons) {
			button.addEventListener('click', () => {
				const field = button.getAttribute('data-settings-reset');

				if (field) {
					TMS_AL.ScreenModalSettings.ResetField(field);
				}
			});
		}

		document.addEventListener('keydown', (event) => {
			const modal = document.getElementById('tmsAlModalSettings');

			if (!modal || modal.hidden) {
				return;
			}

			if (event.key === 'Escape') {
				TMS_AL.ScreenModalSettings.Close();
			}
		});
	},

	/**
	 * モーダルを開く
	 * @returns {Promise<void>}
	 */
	Open: async function () {
		await TMS_AL.ScreenModalSettings.LoadMeta();
		await TMS_AL.ScreenModalSettings.RefreshWindowLimits();
		if (!TMS_AL.ScreenMain._data?.settings.rememberWindowSizeOnLaunch) {
			await TMS_AL.ScreenModalSettings.NormalizeStoredWindowSize();
		}
		TMS_AL.ScreenModalSettings.LoadForm();
		TMS_AL.ScreenModalSettings.Show();
	},

	/**
	 * 設定メタ情報を読み込む
	 * @returns {Promise<void>}
	 */
	LoadMeta: async function () {
		const config          = await window.launcherApi.getConfig();
		const defaultSettings = await window.launcherApi.getDefaultSettings();
		const paneCount       = TMS_AL.ScreenMain._data?.settings.paneCount ?? 1;
		const windowLimits    = await window.launcherApi.getWindowLimits(paneCount);

		TMS_AL.ScreenModalSettings._dataDir         = config.dataDir;
		TMS_AL.ScreenModalSettings._defaultDataDir  = config.defaultDataDir;
		TMS_AL.ScreenModalSettings._defaultSettings = defaultSettings;
		TMS_AL.ScreenModalSettings._windowLimits    = windowLimits;
	},

	/**
	 * ウィンドウサイズ制限を再取得する
	 * @returns {Promise<void>}
	 */
	RefreshWindowLimits: async function () {
		const paneCount = TMS_AL.ScreenMain._data?.settings.paneCount ?? 1;

		TMS_AL.ScreenModalSettings._windowLimits = await window.launcherApi.getWindowLimits(paneCount);
	},

	/**
	 * ウィンドウサイズ入力欄の min/max を更新する
	 * @returns {void}
	 */
	UpdateWindowSizeInputLimits: function () {
		const limits   = TMS_AL.ScreenModalSettings._windowLimits;
		const widthEl  = document.getElementById('tmsAlSettingsWindowWidth');
		const heightEl = document.getElementById('tmsAlSettingsWindowHeight');

		if (widthEl instanceof HTMLInputElement) {
			widthEl.min = String(limits.minWidth);
			widthEl.max = String(limits.maxWidth);
		}

		if (heightEl instanceof HTMLInputElement) {
			heightEl.min = String(limits.minHeight);
			heightEl.max = String(limits.maxHeight);
		}
	},

	/**
	 * 保存済みウィンドウサイズが範囲外なら補正する
	 * @returns {Promise<void>}
	 */
	NormalizeStoredWindowSize: async function () {
		const data = TMS_AL.ScreenMain._data;

		if (!data) {
			return;
		}

		const limits = TMS_AL.ScreenModalSettings._windowLimits;
		const width  = Math.min(limits.maxWidth, Math.max(limits.minWidth, data.settings.window.width));
		const height = Math.min(limits.maxHeight, Math.max(limits.minHeight, data.settings.window.height));

		if (width === data.settings.window.width && height === data.settings.window.height) {
			return;
		}

		data.settings.window.width  = width;
		data.settings.window.height = height;

		await TMS_AL.ScreenMain.SaveData(true);
		await window.launcherApi.setWindowSize(width, height);
		TMS_AL_COMMON.Ui.ShowToast('範囲外のウィンドウサイズを補正しました。', 'warn');
	},

	/**
	 * フォームに現在値を反映する
	 * @returns {void}
	 */
	LoadForm: function () {
		const data = TMS_AL.ScreenMain._data;

		if (!data) {
			return;
		}

		const toggleEl     = document.getElementById('tmsAlSettingsToggleInitial');
		const widthEl      = document.getElementById('tmsAlSettingsWindowWidth');
		const heightEl     = document.getElementById('tmsAlSettingsWindowHeight');
		const appearanceEl = document.getElementById('tmsAlSettingsAppearance');
		const launchEl     = document.getElementById('tmsAlSettingsLaunchBehavior');
		const dataDirEl    = document.getElementById('tmsAlSettingsDataDir');
		const rememberEl   = document.getElementById('tmsAlSettingsRememberWindowSize');
		const paneCountEl  = document.getElementById('tmsAlSettingsPaneCount');
		const uncategorizedEl = document.getElementById('tmsAlSettingsUncategorizedPane');

		if (toggleEl instanceof HTMLSelectElement) {
			toggleEl.value = data.settings.toggleInitialState;
		}

		if (rememberEl instanceof HTMLInputElement) {
			rememberEl.checked = data.settings.rememberWindowSizeOnLaunch;
		}

		if (paneCountEl instanceof HTMLSelectElement) {
			paneCountEl.value = String(data.settings.paneCount ?? 1);
		}

		if (uncategorizedEl instanceof HTMLSelectElement) {
			uncategorizedEl.value = data.settings.uncategorizedPane ?? 'left';
		}

		TMS_AL.ScreenModalSettings.UpdateWindowSizeSectionVisibility();
		TMS_AL.ScreenModalSettings.UpdateUncategorizedPaneSectionVisibility();
		TMS_AL.ScreenModalSettings.UpdateUncategorizedPaneOptions();

		if (widthEl instanceof HTMLInputElement) {
			widthEl.value = String(data.settings.window.width);
		}

		if (heightEl instanceof HTMLInputElement) {
			heightEl.value = String(data.settings.window.height);
		}

		TMS_AL.ScreenModalSettings.UpdateWindowSizeInputLimits();

		if (appearanceEl instanceof HTMLSelectElement) {
			appearanceEl.value = data.settings.appearance;
		}

		if (launchEl instanceof HTMLSelectElement) {
			launchEl.value = data.settings.launchBehavior;
		}

		if (dataDirEl instanceof HTMLInputElement) {
			dataDirEl.value = TMS_AL.ScreenModalSettings._dataDir;
		}
	},

	/**
	 * ウィンドウサイズセクションの表示を切り替える
	 * @returns {void}
	 */
	UpdateWindowSizeSectionVisibility: function () {
		const data    = TMS_AL.ScreenMain._data;
		const section = document.getElementById('tmsAlSettingsWindowSizeSection');

		if (!section || !data) {
			return;
		}

		section.hidden = data.settings.rememberWindowSizeOnLaunch;
	},

	/**
	 * 未分類ペイン設定セクションの表示を切り替える
	 * @returns {void}
	 */
	UpdateUncategorizedPaneSectionVisibility: function () {
		const data        = TMS_AL.ScreenMain._data;
		const section     = document.getElementById('tmsAlSettingsUncategorizedPaneSection');
		const paneCountEl = document.getElementById('tmsAlSettingsPaneCount');

		if (!section) {
			return;
		}

		const paneCount = paneCountEl instanceof HTMLSelectElement
			? Number(paneCountEl.value)
			: (data?.settings.paneCount ?? 1);

		section.hidden = paneCount <= 1;
	},

	/**
	 * 未分類ペイン選択肢をペイン数に合わせて更新する
	 * @returns {void}
	 */
	UpdateUncategorizedPaneOptions: function () {
		const paneCountEl     = document.getElementById('tmsAlSettingsPaneCount');
		const uncategorizedEl = document.getElementById('tmsAlSettingsUncategorizedPane');

		if (!(paneCountEl instanceof HTMLSelectElement) || !(uncategorizedEl instanceof HTMLSelectElement)) {
			return;
		}

		const paneCount  = Number(paneCountEl.value) === 3 ? 3 : Number(paneCountEl.value) === 2 ? 2 : 1;
		const centerOpt  = uncategorizedEl.querySelector('[data-pane-option="center"]');

		if (centerOpt instanceof HTMLOptionElement) {
			centerOpt.hidden = paneCount < 3;
		}

		if (paneCount < 3 && uncategorizedEl.value === 'center') {
			uncategorizedEl.value = 'left';
		}
	},

	/**
	 * トグルスイッチの値を取得する
	 * @param {string} id 要素ID
	 * @param {boolean} fallback フォールバック値
	 * @returns {boolean} 値
	 */
	ReadCheckboxValue: function (id, fallback) {
		const el = document.getElementById(id);

		if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') {
			return fallback;
		}

		return el.checked;
	},

	/**
	 * モーダルを表示する
	 * @returns {void}
	 */
	Show: function () {
		const modal = document.getElementById('tmsAlModalSettings');

		if (modal) {
			modal.hidden = false;
		}
	},

	/**
	 * 未反映の dataDir 入力を適用する
	 * @returns {Promise<void>}
	 */
	FlushPendingDataDirChange: async function () {
		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

		if (!(dataDirEl instanceof HTMLInputElement)) {
			return;
		}

		const newDir = dataDirEl.value.trim();

		if (TMS_AL_COMMON.Funcs.IsEmpty(newDir) || newDir === TMS_AL.ScreenModalSettings._dataDir) {
			return;
		}

		await TMS_AL.ScreenModalSettings.ApplyDataDirChange();
	},

	/**
	 * 更新を手動確認する
	 * @returns {Promise<void>}
	 */
	CheckForUpdates: async function () {
		const btn = document.getElementById('tmsAlBtnSettingsCheckUpdate');

		if (btn instanceof HTMLButtonElement) {
			btn.disabled = true;
		}

		try {
			const result = await window.launcherApi.checkForUpdates();

			if (result.status === 'not-packaged') {
				TMS_AL_COMMON.Ui.ShowToast('開発版では更新確認できません。', 'warn');
				return;
			}

			if (result.status === 'not-available') {
				TMS_AL_COMMON.Ui.ShowToast('最新バージョンです。', 'info');
				return;
			}

			if (result.status === 'available') {
				TMS_AL_COMMON.Ui.ShowToast(
					`新しいバージョン v${result.version ?? ''} が見つかりました。ダウンロードを開始します。`,
					'info',
				);
				return;
			}

			if (result.status === 'error') {
				return;
			}
		} catch (error) {
			TMS_AL_COMMON.Ui.ShowToast(
				`更新確認に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
				'error',
			);
		} finally {
			if (btn instanceof HTMLButtonElement) {
				btn.disabled = false;
			}
		}
	},

	/**
	 * モーダルを閉じる
	 * @returns {Promise<void>}
	 */
	Close: async function () {
		await TMS_AL.ScreenModalSettings.FlushPendingDataDirChange();

		const modal = document.getElementById('tmsAlModalSettings');

		if (modal) {
			modal.hidden = true;
		}
	},

	/**
	 * 設定反映をデバウンスする
	 * @returns {void}
	 */
	ScheduleApply: function () {
		if (TMS_AL.ScreenModalSettings._applyTimer) {
			clearTimeout(TMS_AL.ScreenModalSettings._applyTimer);
		}

		TMS_AL.ScreenModalSettings._applyTimer = setTimeout(() => {
			TMS_AL.ScreenModalSettings.ApplySettings();
		}, 300);
	},

	/**
	 * 数値入力を取得する
	 * @param {string} id 要素ID
	 * @param {number} fallback フォールバック値
	 * @returns {number} 数値
	 */
	ReadNumberInput: function (id, fallback) {
		const el = document.getElementById(id);

		if (!(el instanceof HTMLInputElement)) {
			return fallback;
		}

		const value = Number(el.value);

		return Number.isFinite(value) ? value : fallback;
	},

	/**
	 * ウィンドウサイズ入力値を検証・丸める
	 * @param {string} id 要素ID
	 * @param {number} fallback フォールバック値
	 * @returns {{ raw: number; clamped: number; isValid: boolean }} 検証結果
	 */
	ReadWindowSizeInput: function (id, fallback) {
		const raw    = TMS_AL.ScreenModalSettings.ReadNumberInput(id, fallback);
		const limits = TMS_AL.ScreenModalSettings._windowLimits;
		const isWidth = id === 'tmsAlSettingsWindowWidth';
		const min    = isWidth ? limits.minWidth : limits.minHeight;
		const max    = isWidth ? limits.maxWidth : limits.maxHeight;
		const clamped = Math.min(max, Math.max(min, raw));

		return {
			raw,
			clamped,
			isValid: Number.isFinite(raw) && raw >= min && raw <= max,
		};
	},

	/**
	 * 現在表示中のウィンドウサイズを設定する
	 * @returns {Promise<void>}
	 */
	UseCurrentWindowSize: async function () {
		const size = await window.launcherApi.getWindowSize();

		if (!size) {
			return;
		}

		const widthEl  = document.getElementById('tmsAlSettingsWindowWidth');
		const heightEl = document.getElementById('tmsAlSettingsWindowHeight');

		if (widthEl instanceof HTMLInputElement) {
			widthEl.value = String(size.width);
		}

		if (heightEl instanceof HTMLInputElement) {
			heightEl.value = String(size.height);
		}

		await TMS_AL.ScreenModalSettings.ApplySettings();
	},

	/**
	 * select 値を取得する
	 * @param {string} id 要素ID
	 * @param {string} fallback フォールバック値
	 * @returns {string} 値
	 */
	ReadSelectValue: function (id, fallback) {
		const el = document.getElementById(id);

		if (!(el instanceof HTMLSelectElement)) {
			return fallback;
		}

		return el.value || fallback;
	},

	/**
	 * 設定を読み取って反映する
	 * @returns {Promise<void>}
	 */
	ApplySettings: async function () {
		const data = TMS_AL.ScreenMain._data;

		if (!data || TMS_AL.ScreenModalSettings._isApplying) {
			return;
		}

		TMS_AL.ScreenModalSettings._isApplying = true;

		try {
			const previous = {
				toggleInitialState        : data.settings.toggleInitialState,
				windowWidth               : data.settings.window.width,
				windowHeight              : data.settings.window.height,
				appearance                : data.settings.appearance,
				launchBehavior            : data.settings.launchBehavior,
				rememberWindowSizeOnLaunch: data.settings.rememberWindowSizeOnLaunch,
				paneCount                 : data.settings.paneCount,
				uncategorizedPane         : data.settings.uncategorizedPane,
			};

			data.settings.toggleInitialState = /** @type {'expandAll' | 'collapseAll'} */ (
				TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsToggleInitial', previous.toggleInitialState)
			);
			data.settings.rememberWindowSizeOnLaunch = TMS_AL.ScreenModalSettings.ReadCheckboxValue(
				'tmsAlSettingsRememberWindowSize',
				previous.rememberWindowSizeOnLaunch,
			);
			const paneCountValue = Number(
				TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsPaneCount', String(previous.paneCount)),
			);
			data.settings.paneCount = paneCountValue === 2 || paneCountValue === 3 ? paneCountValue : 1;
			data.settings.uncategorizedPane = /** @type {'left' | 'center' | 'right'} */ (
				TMS_AL.ScreenModalSettings.ReadSelectValue(
					'tmsAlSettingsUncategorizedPane',
					previous.uncategorizedPane,
				)
			);

			if (!data.settings.rememberWindowSizeOnLaunch) {
				const limits = TMS_AL.ScreenModalSettings._windowLimits;
				const widthInput  = TMS_AL.ScreenModalSettings.ReadWindowSizeInput(
					'tmsAlSettingsWindowWidth',
					previous.windowWidth,
				);
				const heightInput = TMS_AL.ScreenModalSettings.ReadWindowSizeInput(
					'tmsAlSettingsWindowHeight',
					previous.windowHeight,
				);

				if (!widthInput.isValid || !heightInput.isValid) {
					TMS_AL_COMMON.Ui.ShowToast(
						`ウィンドウサイズは ${limits.minWidth}～${limits.maxWidth} × ${limits.minHeight}～${limits.maxHeight} の範囲で指定してください。`,
						'warn',
					);
				}

				data.settings.window.width  = widthInput.clamped;
				data.settings.window.height = heightInput.clamped;
			}

			data.settings.appearance = /** @type {'system' | 'dark' | 'light'} */ (
				TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsAppearance', previous.appearance)
			);
			data.settings.launchBehavior = /** @type {'stay' | 'minimize' | 'close'} */ (
				TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsLaunchBehavior', previous.launchBehavior)
			);

			TMS_AL.ScreenModalSettings.LoadForm();

			const saved = await TMS_AL.ScreenMain.SaveData(true);

			if (!saved) {
				return;
			}

			if (data.settings.appearance !== previous.appearance) {
				await window.launcherApi.applyTheme(data.settings.appearance);
				await TMS_AL.Theme.Apply(data.settings.appearance);
			}

			if (data.settings.paneCount !== previous.paneCount) {
				await window.launcherApi.applyLayoutSettings(data.settings.paneCount);
				await TMS_AL.ScreenModalSettings.RefreshWindowLimits();
				TMS_AL.ScreenModalSettings.UpdateWindowSizeInputLimits();
			}

			if (
				!data.settings.rememberWindowSizeOnLaunch
				&& (
					data.settings.window.width !== previous.windowWidth
					|| data.settings.window.height !== previous.windowHeight
				)
			) {
				await window.launcherApi.setWindowSize(
					data.settings.window.width,
					data.settings.window.height,
				);
			}

			if (
				data.settings.toggleInitialState !== previous.toggleInitialState
				|| data.settings.paneCount !== previous.paneCount
				|| data.settings.uncategorizedPane !== previous.uncategorizedPane
			) {
				if (data.settings.toggleInitialState !== previous.toggleInitialState) {
					data.settings.groupExpandedStates = {};
					TMS_AL.ScreenMain.InitGroupExpandedState({ clearSaved: true });
				}

				await TMS_AL.ScreenMain.Render();
			}
		} finally {
			TMS_AL.ScreenModalSettings._isApplying = false;
		}
	},

	/**
	 * dataDir 変更を反映する
	 * @returns {Promise<void>}
	 */
	ApplyDataDirChange: async function () {
		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

		if (!(dataDirEl instanceof HTMLInputElement)) {
			return;
		}

		const newDir = dataDirEl.value.trim();

		if (TMS_AL_COMMON.Funcs.IsEmpty(newDir) || newDir === TMS_AL.ScreenModalSettings._dataDir) {
			dataDirEl.value = TMS_AL.ScreenModalSettings._dataDir;
			return;
		}

		const result = await window.launcherApi.migrateDataDir(newDir);

		if (!result.success) {
			dataDirEl.value = TMS_AL.ScreenModalSettings._dataDir;
			TMS_AL_COMMON.Ui.ShowToast(`データ保存先の変更に失敗しました: ${result.error ?? ''}`, 'error');
			return;
		}

		TMS_AL.ScreenModalSettings._dataDir = result.dataDir ?? newDir;
		dataDirEl.value = TMS_AL.ScreenModalSettings._dataDir;

		const loadResult = await window.launcherApi.loadData();

		if (loadResult.success && loadResult.data) {
			TMS_AL.ScreenMain._data = loadResult.data;
			TMS_AL.ScreenMain.InitGroupExpandedState();
			await TMS_AL.Theme.Apply(loadResult.data.settings.appearance);
			await TMS_AL.ScreenMain.Render();
		}

		TMS_AL_COMMON.Ui.ShowToast('データ保存先を変更しました。', 'info');
	},

	/**
	 * dataDir 参照ダイアログ
	 * @returns {Promise<void>}
	 */
	BrowseDataDir: async function () {
		const selected = await window.launcherApi.openDirectoryDialog();

		if (!selected) {
			return;
		}

		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

		if (dataDirEl instanceof HTMLInputElement) {
			dataDirEl.value = selected;
		}

		await TMS_AL.ScreenModalSettings.ApplyDataDirChange();
	},

	/**
	 * 単一項目を既定値に戻す
	 * @param {string} field 項目名
	 * @returns {Promise<void>}
	 */
	ResetField: async function (field) {
		const defaults = TMS_AL.ScreenModalSettings._defaultSettings;
		const data     = TMS_AL.ScreenMain._data;

		if (!defaults || !data) {
			return;
		}

		switch (field) {
			case 'toggleInitialState':
				data.settings.toggleInitialState = defaults.toggleInitialState;
				break;
			case 'window':
				data.settings.window.width = defaults.window.width;
				data.settings.window.height = defaults.window.height;
				break;
			case 'rememberWindowSizeOnLaunch':
				data.settings.rememberWindowSizeOnLaunch = defaults.rememberWindowSizeOnLaunch;
				break;
			case 'paneCount':
				data.settings.paneCount = defaults.paneCount;
				break;
			case 'uncategorizedPane':
				data.settings.uncategorizedPane = defaults.uncategorizedPane;
				break;
			case 'appearance':
				data.settings.appearance = defaults.appearance;
				break;
			case 'launchBehavior':
				data.settings.launchBehavior = defaults.launchBehavior;
				break;
			case 'dataDir':
				await TMS_AL.ScreenModalSettings.ResetDataDir();
				return;
			default:
				return;
		}

		TMS_AL.ScreenModalSettings.LoadForm();
		await TMS_AL.ScreenModalSettings.ApplySettings();
	},

	/**
	 * dataDir を既定値に戻す
	 * @returns {Promise<void>}
	 */
	ResetDataDir: async function () {
		const defaultDir = TMS_AL.ScreenModalSettings._defaultDataDir;

		if (defaultDir === TMS_AL.ScreenModalSettings._dataDir) {
			return;
		}

		const ok = TMS_AL_COMMON.Ui.Confirm(
			`データ保存先を既定の場所に戻します。\n${defaultDir}\n\nよろしいですか？`,
		);

		if (!ok) {
			return;
		}

		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

		if (dataDirEl instanceof HTMLInputElement) {
			dataDirEl.value = defaultDir;
		}

		await TMS_AL.ScreenModalSettings.ApplyDataDirChange();
	},

	/**
	 * すべての設定を既定値に戻す
	 * @returns {Promise<void>}
	 */
	ResetAll: async function () {
		const defaults = TMS_AL.ScreenModalSettings._defaultSettings;
		const data     = TMS_AL.ScreenMain._data;

		if (!defaults || !data) {
			return;
		}

		const needsDataDirReset = TMS_AL.ScreenModalSettings._dataDir !== TMS_AL.ScreenModalSettings._defaultDataDir;
		let message = 'すべての設定を既定値に戻します。よろしいですか？';

		if (needsDataDirReset) {
			message = 'すべての設定を既定値に戻します。データ保存先も既定の場所に戻ります。よろしいですか？';
		}

		const ok = TMS_AL_COMMON.Ui.Confirm(message);

		if (!ok) {
			return;
		}

		data.settings = structuredClone(defaults);
		TMS_AL.ScreenModalSettings.LoadForm();
		await TMS_AL.ScreenModalSettings.ApplySettings();

		if (needsDataDirReset) {
			const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

			if (dataDirEl instanceof HTMLInputElement) {
				dataDirEl.value = TMS_AL.ScreenModalSettings._defaultDataDir;
			}

			await TMS_AL.ScreenModalSettings.ApplyDataDirChange();
		}
	},
};

TMS_AL.ScreenModalSettings.Init();
