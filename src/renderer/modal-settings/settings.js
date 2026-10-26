/**
 * ペイン数、外観、保存先、更新確認を設定画面から変更する
 * 設定の永続化は launcherApi が行い、このファイルは編集中の値を持つ
 * @file
 */
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

	/** @type {boolean} */
	_isPortable: false,

	/** @type {import('../../main/types').LauncherSettings | null} */
	_defaultSettings: null,

	/** @type {{ minWidth: number; minHeight: number; maxWidth: number; maxHeight: number }} */
	_windowLimits: {
		// 幅の下限。単位は px。これより小さい値は補正する
		minWidth: 360,
		// 高さの下限。単位は px
		minHeight: 480,
		// 幅の上限。単位は px。これより大きい値は補正する
		maxWidth: 1920,
		// 高さの上限。単位は px
		maxHeight: 1080
	},

	/** @type {ReturnType<typeof setTimeout> | null} */
	_applyTimer: null,

	/** @type {boolean} */
	_isApplying: false,

	/**
	 * モーダルを初期化する
	 */
	Init: function () {
		// 閉じるボタン。無いときはクリックで閉じられない
		const btnClose = document.getElementById('tmsAlBtnSettingsClose');
		// 全項目を既定へ戻すボタン。無いときは一括リセットできない
		const btnResetAll = document.getElementById('tmsAlBtnSettingsResetAll');
		// 保存先の参照ボタン。無いときはフォルダダイアログを開けない
		const btnBrowseDir = document.getElementById('tmsAlBtnSettingsBrowseDataDir');
		// 現在のウィンドウサイズを採用するボタン。無いときはその操作ができない
		const btnUseCurrentSize = document.getElementById('tmsAlBtnSettingsUseCurrentSize');
		// 更新確認ボタン。無いときは手動確認できない
		const btnCheckUpdate = document.getElementById('tmsAlBtnSettingsCheckUpdate');
		// 背景。無いときは背景クリックで閉じられない
		const backdrop = document.getElementById('tmsAlModalSettingsBackdrop');
		// 保存先の入力欄。無いときはパス変更を監視しない
		const inputDataDir = document.getElementById('tmsAlSettingsDataDir');

		// 閉じるボタンがあるときだけ閉じるクリックを受ける
		if (btnClose) {
			btnClose.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.Close();
			});
		}

		// 一括リセットボタンがあるときだけ全項目を既定へ戻す
		if (btnResetAll) {
			btnResetAll.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.ResetAll();
			});
		}

		// 参照ボタンがあるときだけフォルダダイアログを開く
		if (btnBrowseDir) {
			btnBrowseDir.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.BrowseDataDir();
			});
		}

		// 現在サイズのボタンがあるときだけ表示中の寸法を入力欄へ入れる
		if (btnUseCurrentSize) {
			btnUseCurrentSize.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.UseCurrentWindowSize();
			});
		}

		// 更新確認ボタンがあるときだけ手動確認を始める
		if (btnCheckUpdate) {
			btnCheckUpdate.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.CheckForUpdates();
			});
		}

		// 背景があるときだけ背景クリックで閉じる
		if (backdrop) {
			backdrop.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.Close();
			});
		}

		// 変更のたびに反映する select の ID。ウィンドウ寸法とペイン数は別扱いにする
		const settingInputs = ['tmsAlSettingsToggleInitial', 'tmsAlSettingsAppearance', 'tmsAlSettingsLaunchBehavior'];

		// 起動時にサイズを覚えるチェック。無いときは change を受けない
		const rememberWindowSizeEl = document.getElementById('tmsAlSettingsRememberWindowSize');
		// ペイン数の select。無いときは未分類ペインの表示も更新しない
		const paneCountEl = document.getElementById('tmsAlSettingsPaneCount');
		// 未分類の配置先。無いときはその変更を反映できない
		const uncategorizedPaneEl = document.getElementById('tmsAlSettingsUncategorizedPane');

		// チェックボックスであるときだけ、覚える設定の変更を反映待ちにする
		if (rememberWindowSizeEl instanceof HTMLInputElement) {
			rememberWindowSizeEl.addEventListener('change', () => {
				TMS_AL.ScreenModalSettings.ScheduleApply();
			});
		}

		// ペイン数の select であるときだけ、数の変更で未分類の選択肢と反映を更新する
		if (paneCountEl instanceof HTMLSelectElement) {
			paneCountEl.addEventListener('change', () => {
				TMS_AL.ScreenModalSettings.UpdateUncategorizedPaneSectionVisibility();
				TMS_AL.ScreenModalSettings.UpdateUncategorizedPaneOptions();
				TMS_AL.ScreenModalSettings.ScheduleApply();
			});
		}

		// 未分類ペインの select であるときだけ、配置先の変更を反映待ちにする
		if (uncategorizedPaneEl instanceof HTMLSelectElement) {
			uncategorizedPaneEl.addEventListener('change', () => {
				TMS_AL.ScreenModalSettings.ScheduleApply();
			});
		}

		// 開閉初期値、外観、起動後動作の要素 ID
		for (const id of settingInputs) {
			// その設定の入力要素。無いときは監視しない
			const el = document.getElementById(id);

			// 要素があるときだけ change と input の両方で反映待ちにする
			if (el) {
				el.addEventListener('change', () => {
					TMS_AL.ScreenModalSettings.ScheduleApply();
				});

				el.addEventListener('input', () => {
					TMS_AL.ScreenModalSettings.ScheduleApply();
				});
			}
		}

		// 幅と高さ。change のときだけ反映し、入力途中の input では確定しない
		const windowSizeInputs = ['tmsAlSettingsWindowWidth', 'tmsAlSettingsWindowHeight'];

		// 幅または高さの要素 ID
		for (const id of windowSizeInputs) {
			// 寸法の入力欄。無いときは監視しない
			const el = document.getElementById(id);

			// 要素があるときだけ確定時に反映待ちにする
			if (el) {
				el.addEventListener('change', () => {
					TMS_AL.ScreenModalSettings.ScheduleApply();
				});
			}
		}

		// 保存先欄が入力要素のときだけ、確定で保存先の移行を始める
		if (inputDataDir instanceof HTMLInputElement) {
			inputDataDir.addEventListener('change', () => {
				TMS_AL.ScreenModalSettings.ApplyDataDirChange();
			});
		}

		// 項目ごとの既定へ戻すボタン。data-settings-reset が項目名
		const resetButtons = document.querySelectorAll('[data-settings-reset]');

		// リセットボタン 1 件。属性が空ならクリックしても戻さない
		for (const button of resetButtons) {
			button.addEventListener('click', () => {
				// 戻す項目名。属性が無いときは空文字ではなく null
				const field = button.getAttribute('data-settings-reset');

				// 項目名があるときだけその項目を既定へ戻す
				if (field) {
					TMS_AL.ScreenModalSettings.ResetField(field);
				}
			});
		}

		document.addEventListener('keydown', (event) => {
			// 設定モーダル。無い、または非表示ならこのキーは設定向けではない
			const modal = document.getElementById('tmsAlModalSettings');

			// モーダルが無い、または隠れているときは何もしない。どちらか一方で足りる
			if (!modal || modal.hidden) {
				return;
			}

			// Escape は未反映の保存先を確定してから閉じる
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
		// 起動時にサイズを覚えないときだけ、保存済み寸法を現在の範囲へ寄せる
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
		// 実行中の保存先とポータブル判定。画面を開くたびに取り直す
		const config = await window.launcherApi.getConfig();
		// 各項目の既定値。リセットの書き戻し先
		const defaultSettings = await window.launcherApi.getDefaultSettings();
		// サイズ制限を取るペイン数。未設定は 1
		const paneCount = TMS_AL.ScreenMain._data?.settings.paneCount ?? 1;
		// そのペイン数での幅と高さの範囲。単位は px
		const windowLimits = await window.launcherApi.getWindowLimits(paneCount);

		TMS_AL.ScreenModalSettings._dataDir = config.dataDir;
		TMS_AL.ScreenModalSettings._defaultDataDir = config.defaultDataDir;
		TMS_AL.ScreenModalSettings._isPortable = config.isPortable === true;
		TMS_AL.ScreenModalSettings._defaultSettings = defaultSettings;
		TMS_AL.ScreenModalSettings._windowLimits = windowLimits;
		TMS_AL.ScreenModalSettings.UpdateDataDirSectionVisibility();
	},

	/**
	 * ウィンドウサイズ制限を再取得する
	 * @returns {Promise<void>}
	 */
	RefreshWindowLimits: async function () {
		// 現在のペイン数。未設定は 1。ペイン数で下限と上限が変わる
		const paneCount = TMS_AL.ScreenMain._data?.settings.paneCount ?? 1;

		TMS_AL.ScreenModalSettings._windowLimits = await window.launcherApi.getWindowLimits(paneCount);
	},

	/**
	 * ウィンドウサイズ入力欄の min/max を更新する
	 */
	UpdateWindowSizeInputLimits: function () {
		// 現在の幅と高さの範囲。単位は px
		const limits = TMS_AL.ScreenModalSettings._windowLimits;
		// 幅の入力欄。input でないときは min/max を書けない
		const widthEl = document.getElementById('tmsAlSettingsWindowWidth');
		// 高さの入力欄。input でないときは min/max を書けない
		const heightEl = document.getElementById('tmsAlSettingsWindowHeight');

		// 幅欄が数値入力のときだけ下限と上限を付ける
		if (widthEl instanceof HTMLInputElement) {
			widthEl.min = String(limits.minWidth);
			widthEl.max = String(limits.maxWidth);
		}

		// 高さ欄が数値入力のときだけ下限と上限を付ける
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
		// 表示中の保存データ。未読込なら補正できない
		const data = TMS_AL.ScreenMain._data;

		// 保存データが無いときは何もしない
		if (!data) {
			return;
		}

		// 補正に使う範囲。単位は px
		const limits = TMS_AL.ScreenModalSettings._windowLimits;
		// 範囲へ寄せた幅。単位は px
		const width = Math.min(limits.maxWidth, Math.max(limits.minWidth, data.settings.window.width));
		// 範囲へ寄せた高さ。単位は px
		const height = Math.min(limits.maxHeight, Math.max(limits.minHeight, data.settings.window.height));

		// 幅と高さがどちらも保存値と同じときは書き戻さない。どちらかが違うと下で保存する
		if (width === data.settings.window.width && height === data.settings.window.height) {
			return;
		}

		data.settings.window.width = width;
		data.settings.window.height = height;

		await TMS_AL.ScreenMain.SaveData(true);
		await window.launcherApi.setWindowSize(width, height);
		TMS_AL_COMMON.Ui.ShowToast('範囲外のウィンドウサイズを補正しました。', 'warn');
	},

	/**
	 * フォームに現在値を反映する
	 */
	LoadForm: function () {
		// 表示中の保存データ。未読込ならフォームを埋められない
		const data = TMS_AL.ScreenMain._data;

		// 保存データが無いときは何もしない
		if (!data) {
			return;
		}

		// グループ開閉の初期値。select でないときは値を入れない
		const toggleEl = document.getElementById('tmsAlSettingsToggleInitial');
		// 幅の入力欄。単位は px
		const widthEl = document.getElementById('tmsAlSettingsWindowWidth');
		// 高さの入力欄。単位は px
		const heightEl = document.getElementById('tmsAlSettingsWindowHeight');
		// 外観。system / dark / light
		const appearanceEl = document.getElementById('tmsAlSettingsAppearance');
		// 起動後にランチャーを残すか最小化か終了か
		const launchEl = document.getElementById('tmsAlSettingsLaunchBehavior');
		// データ保存先のパス欄。ポータブル版では非表示のまま値だけ入れる
		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');
		// 起動時にウィンドウサイズを覚えるチェック
		const rememberEl = document.getElementById('tmsAlSettingsRememberWindowSize');
		// ペイン数。未設定の保存値は 1 として表示する
		const paneCountEl = document.getElementById('tmsAlSettingsPaneCount');
		// 未分類グループの配置先。未設定は左
		const uncategorizedEl = document.getElementById('tmsAlSettingsUncategorizedPane');

		// 開閉初期値が select のときだけ保存値を選ぶ
		if (toggleEl instanceof HTMLSelectElement) {
			toggleEl.value = data.settings.toggleInitialState;
		}

		// チェックボックスのときだけ、覚える設定のオンオフを合わせる
		if (rememberEl instanceof HTMLInputElement) {
			rememberEl.checked = data.settings.rememberWindowSizeOnLaunch;
		}

		// ペイン数の select のときだけ 1 / 2 / 3 を選ぶ
		if (paneCountEl instanceof HTMLSelectElement) {
			paneCountEl.value = String(data.settings.paneCount ?? 1);
		}

		// 未分類ペインの select のときだけ配置先を選ぶ。未設定は左
		if (uncategorizedEl instanceof HTMLSelectElement) {
			uncategorizedEl.value = data.settings.uncategorizedPane ?? 'left';
		}

		TMS_AL.ScreenModalSettings.UpdateWindowSizeSectionVisibility();
		TMS_AL.ScreenModalSettings.UpdateUncategorizedPaneSectionVisibility();
		TMS_AL.ScreenModalSettings.UpdateUncategorizedPaneOptions();

		// 幅欄が数値入力のときだけ保存値を文字列で入れる
		if (widthEl instanceof HTMLInputElement) {
			widthEl.value = String(data.settings.window.width);
		}

		// 高さ欄が数値入力のときだけ保存値を文字列で入れる
		if (heightEl instanceof HTMLInputElement) {
			heightEl.value = String(data.settings.window.height);
		}

		TMS_AL.ScreenModalSettings.UpdateWindowSizeInputLimits();

		// 外観が select のときだけ保存値を選ぶ
		if (appearanceEl instanceof HTMLSelectElement) {
			appearanceEl.value = data.settings.appearance;
		}

		// 起動後動作が select のときだけ保存値を選ぶ
		if (launchEl instanceof HTMLSelectElement) {
			launchEl.value = data.settings.launchBehavior;
		}

		// 保存先欄が入力要素のときだけ現在のパスを表示する
		if (dataDirEl instanceof HTMLInputElement) {
			dataDirEl.value = TMS_AL.ScreenModalSettings._dataDir;
		}
	},

	/**
	 * ウィンドウサイズセクションの表示を切り替える
	 */
	UpdateWindowSizeSectionVisibility: function () {
		// 表示中の保存データ。未読込なら表示を切り替えられない
		const data = TMS_AL.ScreenMain._data;
		// 幅と高さのセクション。無いときは何もしない
		const section = document.getElementById('tmsAlSettingsWindowSizeSection');

		// セクションか保存データが無いと表示を切り替えられない。どちらか欠けると何もしない
		if (!section || !data) {
			return;
		}

		section.hidden = data.settings.rememberWindowSizeOnLaunch;
	},

	/**
	 * ポータブル版ではデータ保存先 UI を非表示にする
	 */
	UpdateDataDirSectionVisibility: function () {
		// 保存先の行。無いときは表示を切り替えられない
		const row = document.getElementById('tmsAlSettingsDataDirRow');

		// 行が無いときは何もしない
		if (!row) {
			return;
		}

		row.hidden = TMS_AL.ScreenModalSettings._isPortable;
	},

	/**
	 * 未分類ペイン設定セクションの表示を切り替える
	 */
	UpdateUncategorizedPaneSectionVisibility: function () {
		// 表示中の保存データ。フォームの select が無いときのフォールバックに使う
		const data = TMS_AL.ScreenMain._data;
		// 未分類ペインのセクション。無いときは何もしない
		const section = document.getElementById('tmsAlSettingsUncategorizedPaneSection');
		// ペイン数の select。無いときは保存値で判定する
		const paneCountEl = document.getElementById('tmsAlSettingsPaneCount');

		// セクションが無いときは表示を切り替えられない
		if (!section) {
			return;
		}

		// 画面上のペイン数。select が無いときは保存値、それも無ければ 1
		const paneCount = paneCountEl instanceof HTMLSelectElement ? Number(paneCountEl.value) : (data?.settings.paneCount ?? 1);

		section.hidden = paneCount <= 1;
	},

	/**
	 * 未分類ペイン選択肢をペイン数に合わせて更新する
	 */
	UpdateUncategorizedPaneOptions: function () {
		// ペイン数の select。無いと選択肢を合わせられない
		const paneCountEl = document.getElementById('tmsAlSettingsPaneCount');
		// 未分類の配置先。無いと選択を戻せない
		const uncategorizedEl = document.getElementById('tmsAlSettingsUncategorizedPane');

		// どちらかが select でないと選択肢を更新できない
		if (!(paneCountEl instanceof HTMLSelectElement) || !(uncategorizedEl instanceof HTMLSelectElement)) {
			return;
		}

		// 2 または 3 以外は 1 ペインとして扱う
		const paneCount = Number(paneCountEl.value) === 3 ? 3 : Number(paneCountEl.value) === 2 ? 2 : 1;
		// 中央ペインの option。マークが無いときは中央を隠せない
		const centerOpt = uncategorizedEl.querySelector('[data-pane-option="center"]');

		// 中央の option があるときだけ、3 ペイン未満では隠す
		if (centerOpt instanceof HTMLOptionElement) {
			centerOpt.hidden = paneCount < 3;
		}

		// ペイン数が 3 未満であり、かつ未分類が中央のとき左へ戻す。どちらか欠けると選択を残す
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
		// 読む要素。checkbox でないときは fallback を返す
		const el = document.getElementById(id);

		// 入力要素でない、または checkbox でないときは fallback。どちらか一方で足りる
		if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') {
			return fallback;
		}

		return el.checked;
	},

	/**
	 * モーダルを表示する
	 */
	Show: function () {
		// 設定モーダル。無いときは表示できない
		const modal = document.getElementById('tmsAlModalSettings');

		// モーダルがあるときだけ表示する
		if (modal) {
			modal.hidden = false;
		}
	},

	/**
	 * 未反映の dataDir 入力を適用する
	 * @returns {Promise<void>}
	 */
	FlushPendingDataDirChange: async function () {
		// ポータブル版は保存先を変えられないので、未反映の入力も捨てる
		if (TMS_AL.ScreenModalSettings._isPortable) {
			return;
		}

		// 保存先の入力欄。input でないときは未反映分が無い
		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

		// 入力欄でないときは移行しない
		if (!(dataDirEl instanceof HTMLInputElement)) {
			return;
		}

		// 前後空白を除いた入力パス。空、または現在と同じなら移行しない
		const newDir = dataDirEl.value.trim();

		// 空、または現在の保存先と同じときは移行しない。どちらか一方で足りる
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
		// 更新確認ボタン。連打を止めるため、あるときだけ無効にする
		const btn = document.getElementById('tmsAlBtnSettingsCheckUpdate');

		// ボタンであるときだけ確認中は押せなくする
		if (btn instanceof HTMLButtonElement) {
			btn.disabled = true;
		}

		try {
			// 確認結果。開発版、最新、更新あり、失敗で分岐する
			const result = await window.launcherApi.checkForUpdates();

			// パッケージされていない開発起動では更新確認できない
			if (result.status === 'not-packaged') {
				TMS_AL_COMMON.Ui.ShowToast('開発版では更新確認できません。', 'warn');
				return;
			}

			// 公開済みの新しい版が無い
			if (result.status === 'not-available') {
				TMS_AL_COMMON.Ui.ShowToast('最新バージョンです。', 'info');
				return;
			}

			// 新しい版がある
			if (result.status === 'available') {
				// ポータブル版は自動ダウンロードせず、公式ページからの ZIP 取得を案内する
				if (result.mode === 'portable') {
					TMS_AL_COMMON.Ui.ShowToast(`新しいバージョン v${result.version ?? ''} が見つかりました。公式ページからポータブル ZIP 版をダウンロードしてください。`, 'info');
					return;
				}

				TMS_AL_COMMON.Ui.ShowToast(`新しいバージョン v${result.version ?? ''} が見つかりました。ダウンロードを開始します。`, 'info');
				return;
			}

			// 失敗ステータスはこの関数では追加のトーストを出さない
			if (result.status === 'error') {
				return;
			}
		} catch (error) {
			TMS_AL_COMMON.Ui.ShowToast(`更新確認に失敗しました: ${error instanceof Error ? error.message : String(error)}`, 'error');
		} finally {
			// ボタンであるときだけ、成功でも失敗でも再び押せるようにする
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

		// 設定モーダル。無いときは非表示にできない
		const modal = document.getElementById('tmsAlModalSettings');

		// モーダルがあるときだけ隠す
		if (modal) {
			modal.hidden = true;
		}
	},

	/**
	 * 設定反映をデバウンスする
	 */
	ScheduleApply: function () {
		// 前回の待機が残っているときだけ取り消す。連続変更では最後の 1 回だけ反映する
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
		// 数値欄。input でないときは fallback
		const el = document.getElementById(id);

		// 数値入力でないときは fallback
		if (!(el instanceof HTMLInputElement)) {
			return fallback;
		}

		// 欄の数値。空や不正な文字列は NaN になり fallback へ落とす
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
		// 欄の数値。読めないときは fallback。単位は px
		const raw = TMS_AL.ScreenModalSettings.ReadNumberInput(id, fallback);
		// 幅と高さの許容範囲。単位は px
		const limits = TMS_AL.ScreenModalSettings._windowLimits;
		// 幅欄かどうか。高さ欄は別の下限と上限を使う
		const isWidth = id === 'tmsAlSettingsWindowWidth';
		// この欄の下限。単位は px
		const min = isWidth ? limits.minWidth : limits.minHeight;
		// この欄の上限。単位は px
		const max = isWidth ? limits.maxWidth : limits.maxHeight;
		// 範囲へ寄せた値。単位は px。範囲外でも保存にはこれを使う
		const clamped = Math.min(max, Math.max(min, raw));

		return {
			// 欄に入っていた数値。不正なときは fallback が入っている
			raw,
			// 下限と上限の内側へ寄せた値。単位は px
			clamped,
			// 有限値であり、かつ下限以上、かつ上限以下。どれか欠けると警告対象
			isValid: Number.isFinite(raw) && raw >= min && raw <= max
		};
	},

	/**
	 * 現在表示中のウィンドウサイズを設定する
	 * @returns {Promise<void>}
	 */
	UseCurrentWindowSize: async function () {
		// いまのウィンドウ寸法。取れないときは null で、入力欄を変えない
		const size = await window.launcherApi.getWindowSize();

		// 寸法を読めないときは反映しない
		if (!size) {
			return;
		}

		// 幅の入力欄。単位は px
		const widthEl = document.getElementById('tmsAlSettingsWindowWidth');
		// 高さの入力欄。単位は px
		const heightEl = document.getElementById('tmsAlSettingsWindowHeight');

		// 幅欄が数値入力のときだけ現在の幅を入れる
		if (widthEl instanceof HTMLInputElement) {
			widthEl.value = String(size.width);
		}

		// 高さ欄が数値入力のときだけ現在の高さを入れる
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
		// 読む select。select でない、または値が空なら fallback
		const el = document.getElementById(id);

		// select でないときは fallback
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
		// 表示中の保存データ。未読込なら反映できない
		const data = TMS_AL.ScreenMain._data;

		// 保存データが無い、または反映の途中なら再入しない。どちらか一方で足りる
		if (!data || TMS_AL.ScreenModalSettings._isApplying) {
			return;
		}

		TMS_AL.ScreenModalSettings._isApplying = true;

		try {
			// 反映前の値。変わった項目だけ後続の適用に使う
			const previous = {
				// 変更前の開閉初期値
				toggleInitialState: data.settings.toggleInitialState,
				// 変更前の幅。単位は px
				windowWidth: data.settings.window.width,
				// 変更前の高さ。単位は px
				windowHeight: data.settings.window.height,
				// 変更前の外観
				appearance: data.settings.appearance,
				// 変更前の起動後動作
				launchBehavior: data.settings.launchBehavior,
				// 変更前の、起動時にサイズを覚えるか
				rememberWindowSizeOnLaunch: data.settings.rememberWindowSizeOnLaunch,
				// 変更前のペイン数
				paneCount: data.settings.paneCount,
				// 変更前の未分類ペイン
				uncategorizedPane: data.settings.uncategorizedPane
			};

			data.settings.toggleInitialState = /** @type {'expandAll' | 'collapseAll'} */ (TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsToggleInitial', previous.toggleInitialState));
			data.settings.rememberWindowSizeOnLaunch = TMS_AL.ScreenModalSettings.ReadCheckboxValue('tmsAlSettingsRememberWindowSize', previous.rememberWindowSizeOnLaunch);
			// 欄のペイン数。2 と 3 以外は 1 にする
			const paneCountValue = Number(TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsPaneCount', String(previous.paneCount)));
			data.settings.paneCount = paneCountValue === 2 || paneCountValue === 3 ? paneCountValue : 1;
			data.settings.uncategorizedPane = /** @type {'left' | 'center' | 'right'} */ (TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsUncategorizedPane', previous.uncategorizedPane));

			// 起動時にサイズを覚えないときだけ、幅と高さを入力値で更新する
			if (!data.settings.rememberWindowSizeOnLaunch) {
				// 警告文に出す範囲。単位は px
				const limits = TMS_AL.ScreenModalSettings._windowLimits;
				// 幅の検証結果。範囲外でも clamped は保存する
				const widthInput = TMS_AL.ScreenModalSettings.ReadWindowSizeInput('tmsAlSettingsWindowWidth', previous.windowWidth);
				// 高さの検証結果。範囲外でも clamped は保存する
				const heightInput = TMS_AL.ScreenModalSettings.ReadWindowSizeInput('tmsAlSettingsWindowHeight', previous.windowHeight);

				// 幅か高さが範囲外。どちらか一方でも警告する
				if (!widthInput.isValid || !heightInput.isValid) {
					TMS_AL_COMMON.Ui.ShowToast(`ウィンドウサイズは ${limits.minWidth}～${limits.maxWidth} × ${limits.minHeight}～${limits.maxHeight} の範囲で指定してください。`, 'warn');
				}

				data.settings.window.width = widthInput.clamped;
				data.settings.window.height = heightInput.clamped;
			}

			data.settings.appearance = /** @type {'system' | 'dark' | 'light'} */ (TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsAppearance', previous.appearance));
			data.settings.launchBehavior = /** @type {'stay' | 'minimize' | 'close'} */ (TMS_AL.ScreenModalSettings.ReadSelectValue('tmsAlSettingsLaunchBehavior', previous.launchBehavior));

			TMS_AL.ScreenModalSettings.LoadForm();

			// ----------------------------------------------
			// 保存の成否。失敗時はテーマもレイアウトも変えない
			const saved = await TMS_AL.ScreenMain.SaveData(true);

			// 保存できないときは画面側の適用へ進まない
			if (!saved) {
				return;
			}

			// ----------------------------------------------
			// 外観が変わったときだけテーマを適用する
			if (data.settings.appearance !== previous.appearance) {
				await window.launcherApi.applyTheme(data.settings.appearance);
				await TMS_AL.Theme.Apply(data.settings.appearance);
			}

			// ペイン数が変わったときだけレイアウトと、寸法の範囲を取り直す
			if (data.settings.paneCount !== previous.paneCount) {
				await window.launcherApi.applyLayoutSettings(data.settings.paneCount);
				await TMS_AL.ScreenModalSettings.RefreshWindowLimits();
				TMS_AL.ScreenModalSettings.UpdateWindowSizeInputLimits();
			}

			// サイズを覚えない設定であり、かつ幅か高さが変わったときだけリサイズする。覚えているときは入らない
			if (!data.settings.rememberWindowSizeOnLaunch && (data.settings.window.width !== previous.windowWidth || data.settings.window.height !== previous.windowHeight)) {
				await window.launcherApi.setWindowSize(data.settings.window.width, data.settings.window.height);
			}

			// 開閉初期値、ペイン数、未分類ペインのどれかが変わったとき一覧を描き直す
			if (data.settings.toggleInitialState !== previous.toggleInitialState || data.settings.paneCount !== previous.paneCount || data.settings.uncategorizedPane !== previous.uncategorizedPane) {
				// 開閉の初期値そのものが変わったときだけ、保存済みの開閉状態を捨てて初期値で作り直す
				if (data.settings.toggleInitialState !== previous.toggleInitialState) {
					data.settings.groupExpandedStates = {};
					TMS_AL.ScreenMain.InitGroupExpandedState({
						// 保存済みの開閉を捨て、新しい初期値だけで作り直す
						clearSaved: true
					});
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
		// ポータブル版は保存先を exe 隣に固定する
		if (TMS_AL.ScreenModalSettings._isPortable) {
			return;
		}

		// 保存先の入力欄。input でないときは移行できない
		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

		// 入力欄でないときは何もしない
		if (!(dataDirEl instanceof HTMLInputElement)) {
			return;
		}

		// 前後空白を除いた移行先。空、または現在と同じなら欄を現在値へ戻す
		const newDir = dataDirEl.value.trim();

		// 空、または現在の保存先と同じときは移行せず欄を戻す。どちらか一方で足りる
		if (TMS_AL_COMMON.Funcs.IsEmpty(newDir) || newDir === TMS_AL.ScreenModalSettings._dataDir) {
			dataDirEl.value = TMS_AL.ScreenModalSettings._dataDir;
			return;
		}

		// 移行結果。失敗時は error に理由が入る
		const result = await window.launcherApi.migrateDataDir(newDir);

		// 移行できなかったときは欄を元のパスへ戻して理由を出す
		if (!result.success) {
			dataDirEl.value = TMS_AL.ScreenModalSettings._dataDir;
			TMS_AL_COMMON.Ui.ShowToast(`データ保存先の変更に失敗しました: ${result.error ?? ''}`, 'error');
			return;
		}

		TMS_AL.ScreenModalSettings._dataDir = result.dataDir ?? newDir;
		dataDirEl.value = TMS_AL.ScreenModalSettings._dataDir;

		// ----------------------------------------------
		// 移行先から読み直したデータ。失敗時は画面の一覧は差し替えない
		const loadResult = await window.launcherApi.loadData();

		// 読み込みが成功し、かつデータがあるときだけ画面を差し替える。どちらか欠けると保存先変更の通知だけ出す
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
		// ポータブル版はフォルダ選択も保存先変更もしない
		if (TMS_AL.ScreenModalSettings._isPortable) {
			return;
		}

		// 選んだフォルダ。キャンセル時は空で、保存先を変えない
		const selected = await window.launcherApi.openDirectoryDialog();

		// 選択が無いときは入力欄を変えない
		if (!selected) {
			return;
		}

		// 保存先欄。input のときだけ選んだパスを入れてから移行する
		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

		// 入力欄であるときだけ選択パスを表示する
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
		// 既定値。未取得なら戻せない
		const defaults = TMS_AL.ScreenModalSettings._defaultSettings;
		// 表示中の保存データ。未読込なら戻せない
		const data = TMS_AL.ScreenMain._data;

		// 既定値か保存データが無いと戻せない。どちらか欠けると何もしない
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
		// ポータブル版の保存先は既定へ戻さない
		if (TMS_AL.ScreenModalSettings._isPortable) {
			return;
		}

		// 既定の保存先。現在と同じなら確認も移行もしない
		const defaultDir = TMS_AL.ScreenModalSettings._defaultDataDir;

		// すでに既定の場所なら何もしない
		if (defaultDir === TMS_AL.ScreenModalSettings._dataDir) {
			return;
		}

		// 確認の結果。キャンセルは false
		const ok = TMS_AL_COMMON.Ui.Confirm(`データ保存先を既定の場所に戻します。\n${defaultDir}\n\nよろしいですか？`);

		// キャンセルされたときは保存先を変えない
		if (!ok) {
			return;
		}

		// 保存先欄。input のときだけ既定パスを表示してから移行する
		const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

		// 入力欄であるときだけ既定パスを入れる
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
		// 既定値。未取得なら戻せない
		const defaults = TMS_AL.ScreenModalSettings._defaultSettings;
		// 表示中の保存データ。未読込なら戻せない
		const data = TMS_AL.ScreenMain._data;

		// 既定値か保存データが無いと戻せない。どちらか欠けると何もしない
		if (!defaults || !data) {
			return;
		}

		// ポータブルでなく、かつ現在の保存先が既定と違うときだけ保存先も戻す。どちらか欠けると設定だけ戻す
		const needsDataDirReset = !TMS_AL.ScreenModalSettings._isPortable && TMS_AL.ScreenModalSettings._dataDir !== TMS_AL.ScreenModalSettings._defaultDataDir;
		// 確認文。保存先も戻るときはその旨を含める
		let message = 'すべての設定を既定値に戻します。よろしいですか？';

		// 保存先も既定へ戻るときだけ、確認文を差し替える
		if (needsDataDirReset) {
			message = 'すべての設定を既定値に戻します。データ保存先も既定の場所に戻ります。よろしいですか？';
		}

		// 確認の結果。キャンセルは false
		const ok = TMS_AL_COMMON.Ui.Confirm(message);

		// キャンセルされたときは設定も保存先も変えない
		if (!ok) {
			return;
		}

		// ----------------------------------------------
		data.settings = structuredClone(defaults);
		TMS_AL.ScreenModalSettings.LoadForm();
		await TMS_AL.ScreenModalSettings.ApplySettings();

		// 保存先の復帰が必要なときだけ、設定の反映のあとでフォルダを移す
		if (needsDataDirReset) {
			// 保存先欄。input のときだけ既定パスを入れてから移行する
			const dataDirEl = document.getElementById('tmsAlSettingsDataDir');

			// 入力欄であるときだけ既定パスを表示する
			if (dataDirEl instanceof HTMLInputElement) {
				dataDirEl.value = TMS_AL.ScreenModalSettings._defaultDataDir;
			}

			await TMS_AL.ScreenModalSettings.ApplyDataDirChange();
		}
	}
};

TMS_AL.ScreenModalSettings.Init();
