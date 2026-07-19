'use strict';

/** アプリタイトル */
const APP_TITLE = 'TMS-AppsLauncher';

/** 管理者権限時のタイトル接尾辞 */
const ADMINISTRATOR_TITLE_SUFFIX = '（管理者権限）';

/** @type {RegExp} */
const CSS_COLOR_HEX_PATTERN = /^#[0-9a-f]{6}$/iu;

Object.assign(TMS_AL.Const, {
	/** テーマクラス: ダーク */
	THEME_CLASS_DARK : 'tms-al-theme-dark',
	/** テーマクラス: ライト */
	THEME_CLASS_LIGHT: 'tms-al-theme-light',
	/** ウィンドウフォーカスクラス */
	WINDOW_FOCUSED_CLASS: 'tms-al-window-focused',
	/** 1ペインあたりの最小幅 */
	PANE_MIN_WIDTH: 360,
});

Object.assign(TMS_AL.ComFnc, {
	/**
	 * launcherApi が利用可能か判定する
	 * @returns {boolean} 利用可能なら true
	 */
	IsApiAvailable: function () {
		return typeof window.launcherApi !== 'undefined';
	},

	/**
	 * エラーをログ出力する
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 * @returns {void}
	 */
	LogError: function (message, context) {
		if (TMS_AL.ComFnc.IsApiAvailable()) {
			window.launcherApi.writeLog('ERROR', message, context);
		}

		console.error(`${TMS_AL_COMMON.Const.LOG_PREFIX} ${message}`, context);
	},
});

Object.assign(TMS_AL.Theme, {
	/**
	 * CSS に渡せる色か判定する
	 * @param {string} color 色
	 * @returns {boolean} 有効なら true
	 */
	IsValidCssColor: function (color) {
		return CSS_COLOR_HEX_PATTERN.test(color ?? '');
	},

	/**
	 * テーマを body に反映する
	 * @param {'system' | 'dark' | 'light'} appearance 外観設定
	 * @returns {Promise<void>}
	 */
	Apply: async function (appearance) {
		const body = document.body;

		body.classList.remove(TMS_AL.Const.THEME_CLASS_DARK);
		body.classList.remove(TMS_AL.Const.THEME_CLASS_LIGHT);

		if (appearance === 'dark') {
			body.classList.add(TMS_AL.Const.THEME_CLASS_DARK);
			return;
		}

		if (appearance === 'light') {
			body.classList.add(TMS_AL.Const.THEME_CLASS_LIGHT);
			return;
		}

		const isDark = await window.launcherApi.shouldUseDarkColors();

		if (isDark) {
			body.classList.add(TMS_AL.Const.THEME_CLASS_DARK);
		}

		await TMS_AL.Theme.ApplyWindowChrome();
	},

	/**
	 * Windows のタイトルバー色をヘッダへ反映する
	 * @returns {Promise<void>}
	 */
	ApplyWindowChrome: async function () {
		const colors = await window.launcherApi.getWindowChromeColors();
		const body   = document.body;

		if (!colors || !body) {
			return;
		}

		const colorMap = {
			'--tms-al-titlebar-active-bg'     : colors.activeBackground,
			'--tms-al-titlebar-active-text'   : colors.activeText,
			'--tms-al-titlebar-inactive-bg'   : colors.inactiveBackground,
			'--tms-al-titlebar-inactive-text' : colors.inactiveText,
		};

		Object.entries(colorMap).forEach(([property, color]) => {
			if (TMS_AL.Theme.IsValidCssColor(color)) {
				body.style.setProperty(property, color);
			}
		});
	},

	/**
	 * ウィンドウフォーカス状態を body に反映する
	 * @param {boolean} focused フォーカス中なら true
	 * @returns {void}
	 */
	SetWindowFocus: function (focused) {
		document.documentElement.classList.toggle(TMS_AL.Const.WINDOW_FOCUSED_CLASS, focused);
		document.body.classList.toggle(TMS_AL.Const.WINDOW_FOCUSED_CLASS, focused);
	},

	/**
	 * ウィンドウフォーカス状態イベントを登録する
	 * @returns {void}
	 */
	BindWindowFocusEvents: function () {
		TMS_AL.Theme.SetWindowFocus(document.hasFocus());

		window.addEventListener('focus', () => {
			TMS_AL.Theme.SetWindowFocus(true);
		});
		window.addEventListener('blur', () => {
			TMS_AL.Theme.SetWindowFocus(false);
		});
		window.launcherApi.onWindowFocusChanged((focused) => {
			TMS_AL.Theme.SetWindowFocus(focused);
		});
	},
});

/** ドラッグ並べ替え（SortableJS 非依存・Electron 向け） */
Object.assign(TMS_AL.RowDrag, {
	/** @type {{ type: 'app' | 'group'; element: HTMLElement; handle: HTMLElement; pointerId: number; startX: number; startY: number; moved: boolean } | null} */
	_state: null,

	/** @type {boolean} */
	_suppressClick: false,

	/** @type {boolean} */
	_bound: false,

	/** @type {number} */
	_DRAG_THRESHOLD: 4,

	/** 並べ替え境界のヒステリシス帯（要素高さに対する比率） */
	_HYSTERESIS_RATIO: 0.3,

	/**
	 * ドラッグイベントを登録する
	 * @returns {void}
	 */
	Bind: function () {
		if (TMS_AL.RowDrag._bound) {
			return;
		}

		TMS_AL.RowDrag._bound = true;
		const opts            = { capture: true };

		document.addEventListener('pointerdown', TMS_AL.RowDrag._onPointerDown, opts);
		document.addEventListener('pointermove', TMS_AL.RowDrag._onPointerMove, opts);
		document.addEventListener('pointerup', TMS_AL.RowDrag._onPointerUp, opts);
		document.addEventListener('pointercancel', TMS_AL.RowDrag._onPointerUp, opts);
	},

	/**
	 * ドラッグ直後の click を抑止する
	 * @returns {boolean} 抑止した場合 true
	 */
	ConsumeClick: function () {
		if (!TMS_AL.RowDrag._suppressClick) {
			return false;
		}

		TMS_AL.RowDrag._suppressClick = false;

		return true;
	},

	/**
	 * @param {PointerEvent} event ポインターイベント
	 * @returns {void}
	 */
	_onPointerDown: function (event) {
		if (event.button !== 0 || !(event.target instanceof Element)) {
			return;
		}

		const appHandle = event.target.closest('.tms-al-app-row__drag');

		if (appHandle instanceof HTMLElement) {
			const row = appHandle.closest('.tms-al-app-row');

			if (row instanceof HTMLElement) {
				event.preventDefault();
				appHandle.setPointerCapture(event.pointerId);
				TMS_AL.RowDrag._state = {
					type      : 'app',
					element   : row,
					handle    : appHandle,
					pointerId : event.pointerId,
					startX    : event.clientX,
					startY    : event.clientY,
					moved     : false,
				};
				document.body.classList.add('tms-al-body--dragging');
			}

			return;
		}

		const groupHandle = event.target.closest('.tms-al-group__drag-handle');

		if (!(groupHandle instanceof HTMLElement)) {
			return;
		}

		const group = groupHandle.closest('.tms-al-group');

		if (!(group instanceof HTMLElement) || group.classList.contains('tms-al-group--fixed')) {
			return;
		}

		event.preventDefault();
		groupHandle.setPointerCapture(event.pointerId);
		TMS_AL.RowDrag._state = {
			type      : 'group',
			element   : group,
			handle    : groupHandle,
			pointerId : event.pointerId,
			startX    : event.clientX,
			startY    : event.clientY,
			moved     : false,
		};
		document.body.classList.add('tms-al-body--dragging');
	},

	/**
	 * @param {PointerEvent} event ポインターイベント
	 * @returns {void}
	 */
	_onPointerMove: function (event) {
		const state = TMS_AL.RowDrag._state;

		if (!state || event.pointerId !== state.pointerId) {
			return;
		}

		if (!state.moved) {
			const dx = Math.abs(event.clientX - state.startX);
			const dy = Math.abs(event.clientY - state.startY);

			if (dx < TMS_AL.RowDrag._DRAG_THRESHOLD && dy < TMS_AL.RowDrag._DRAG_THRESHOLD) {
				return;
			}

			state.moved = true;
			state.element.classList.add(
				state.type === 'app' ? 'tms-al-app-row--dragging' : 'tms-al-group--dragging',
			);
		}

		if (state.type === 'app') {
			TMS_AL.RowDrag._moveAppRow(state.element, event.clientX, event.clientY);
			return;
		}

		TMS_AL.RowDrag._moveGroup(state.element, event.clientX, event.clientY);
	},

	/**
	 * 座標下の要素からドラッグ対象を除外して closest する
	 * @param {number} clientX X 座標
	 * @param {number} clientY Y 座標
	 * @param {HTMLElement} dragging ドラッグ中要素
	 * @param {string} selector closest セレクタ
	 * @returns {HTMLElement | null} ヒット要素
	 */
	_elementFromPoint: function (clientX, clientY, dragging, selector) {
		for (const el of document.elementsFromPoint(clientX, clientY)) {
			if (!(el instanceof Element)) {
				continue;
			}

			if (dragging === el || dragging.contains(el)) {
				continue;
			}

			const match = el.closest(selector);

			if (match instanceof HTMLElement && !dragging.contains(match)) {
				return match;
			}
		}

		return null;
	},

	/**
	 * リスト内でドラッグ要素を配置する（境界プルプル防止）
	 * @param {HTMLElement} listEl 親リスト
	 * @param {HTMLElement} item ドラッグ要素
	 * @param {number} clientY Y 座標
	 * @param {string} itemSelector 行セレクタ
	 * @returns {void}
	 */
	_placeInList: function (listEl, item, clientY, itemSelector) {
		const peers = [...listEl.children].filter(
			(el) => el instanceof HTMLElement && el.matches(itemSelector) && el !== item,
		);

		if (peers.length === 0) {
			if (item.parentElement !== listEl) {
				listEl.appendChild(item);
			}

			return;
		}

		/** @type {HTMLElement | null} */
		let insertBeforeRef = null;

		for (const peer of peers) {
			const rect  = peer.getBoundingClientRect();
			const upper = rect.top + rect.height * (0.5 - TMS_AL.RowDrag._HYSTERESIS_RATIO / 2);
			const lower = rect.top + rect.height * (0.5 + TMS_AL.RowDrag._HYSTERESIS_RATIO / 2);

			if (clientY < upper) {
				insertBeforeRef = peer;
				break;
			}

			if (clientY <= lower) {
				if (item.nextElementSibling === peer || peer.nextElementSibling === item) {
					return;
				}

				insertBeforeRef = clientY < rect.top + rect.height / 2 ? peer : peer.nextElementSibling;
				break;
			}

			insertBeforeRef = peer.nextElementSibling instanceof HTMLElement ? peer.nextElementSibling : null;
		}

		if (item.nextElementSibling === insertBeforeRef) {
			return;
		}

		if (insertBeforeRef === null && item.parentElement === listEl && item.nextElementSibling === null) {
			return;
		}

		if (item.parentElement !== listEl) {
			listEl.insertBefore(item, insertBeforeRef);
			return;
		}

		listEl.insertBefore(item, insertBeforeRef);
	},

	/**
	 * @param {HTMLElement} row アプリ行
	 * @param {number} clientX X 座標
	 * @param {number} clientY Y 座標
	 * @returns {void}
	 */
	_moveAppRow: function (row, clientX, clientY) {
		const targetList = TMS_AL.RowDrag._elementFromPoint(
			clientX,
			clientY,
			row,
			'.tms-al-group__apps',
		);

		if (!(targetList instanceof HTMLElement)) {
			return;
		}

		const group = targetList.closest('.tms-al-group');

		if (!(group instanceof HTMLElement) || !group.classList.contains('tms-al-group--expanded')) {
			return;
		}

		TMS_AL.RowDrag._placeInList(targetList, row, clientY, '.tms-al-app-row');
	},

	/**
	 * @param {HTMLElement} group グループ
	 * @param {number} clientX X 座標
	 * @param {number} clientY Y 座標
	 * @returns {void}
	 */
	_moveGroup: function (group, clientX, clientY) {
		const targetList = TMS_AL.RowDrag._elementFromPoint(
			clientX,
			clientY,
			group,
			'.tms-al-group-list',
		);

		if (!(targetList instanceof HTMLElement)) {
			return;
		}

		TMS_AL.RowDrag._placeInList(
			targetList,
			group,
			clientY,
			'.tms-al-group:not(.tms-al-group--fixed)',
		);
	},

	/**
	 * @param {PointerEvent} event ポインターイベント
	 * @returns {Promise<void>}
	 */
	_onPointerUp: async function (event) {
		const state = TMS_AL.RowDrag._state;

		if (!state || event.pointerId !== state.pointerId) {
			return;
		}

		if (state.handle.hasPointerCapture(event.pointerId)) {
			state.handle.releasePointerCapture(event.pointerId);
		}

		TMS_AL.RowDrag._state = null;
		document.body.classList.remove('tms-al-body--dragging');
		state.element.classList.remove('tms-al-app-row--dragging', 'tms-al-group--dragging');

		if (!state.moved) {
			return;
		}

		event.preventDefault();
		TMS_AL.RowDrag._suppressClick = true;

		try {
			await TMS_AL.ScreenMain.RecalculateOrdersFromDom();
		} catch (error) {
			TMS_AL.ComFnc.LogError('Failed to save row order after drag', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

Object.assign(TMS_AL.ScreenMain, {
	/** @type {import('../../main/types').LauncherData | null} */
	_data: null,

	/** @type {Record<string, boolean>} */
	_groupExpanded: {},

	/** @type {ReturnType<typeof setTimeout> | null} */
	_saveTimer: null,

	/** @type {number | null} */
	_lastActivePaneCount: null,

	/** @type {Set<string>} */
	_runningAppIds: new Set(),

	/** @type {({ appId: string; groupId: string; groupName: string; appName: string; path: string; pathFileName: string; label: string }|{ type: 'separator' })[]} */
	_searchResults: [],

	/** @type {number} */
	_searchSelectedIndex: -1,

	/** @type {string | null} */
	_searchPreviewAppId: null,

	/** @type {string | null} */
	_searchPreviewGroupId: null,

	/** @type {ReturnType<typeof setTimeout> | null} */
	_resizeTimer: null,

	/** @type {string} */
	_lastUpdateErrorMessage: '',

	/** @type {number} */
	_lastUpdateErrorAt: 0,

	/**
	 * アプリタイトル表示を更新する
	 * @param {boolean} isAdministrator 管理者権限なら true
	 * @returns {void}
	 */
	UpdateTitle: function (isAdministrator) {
		const titleEl = document.getElementById('tmsAlTitle');
		const title   = isAdministrator
			? `${APP_TITLE}${ADMINISTRATOR_TITLE_SUFFIX}`
			: APP_TITLE;

		document.title = title;

		if (titleEl) {
			titleEl.textContent = title;
			titleEl.title       = title;
		}
	},

	/**
	 * 自動更新の状態通知を処理する
	 * @param {import('../../main/types').UpdateStatusPayload} payload 通知内容
	 * @returns {void}
	 */
	HandleUpdateStatus: function (payload) {
		if (payload.type === 'available') {
			TMS_AL_COMMON.Ui.ShowToast(
				`新しいバージョン v${payload.version} をダウンロードしています…`,
				'info',
			);
			return;
		}

		if (payload.type !== 'error') {
			return;
		}

		const now = Date.now();

		if (
			payload.message === TMS_AL.ScreenMain._lastUpdateErrorMessage
			&& now - TMS_AL.ScreenMain._lastUpdateErrorAt < 5000
		) {
			return;
		}

		TMS_AL.ScreenMain._lastUpdateErrorMessage = payload.message;
		TMS_AL.ScreenMain._lastUpdateErrorAt      = now;
		TMS_AL_COMMON.Ui.ShowToast(payload.message, 'error');
	},

	/**
	 * 設定上のペイン数を取得する
	 * @returns {1 | 2 | 3} ペイン数
	 */
	GetConfiguredPaneCount: function () {
		const count = TMS_AL.ScreenMain._data?.settings.paneCount ?? 1;

		return count === 2 || count === 3 ? count : 1;
	},

	/**
	 * 現在のビューポートで有効なペイン数を取得する
	 * @returns {1 | 2 | 3} ペイン数
	 */
	GetActivePaneCount: function () {
		const configured = TMS_AL.ScreenMain.GetConfiguredPaneCount();
		const maxByWidth = Math.max(
			1,
			Math.floor(window.innerWidth / TMS_AL.Const.PANE_MIN_WIDTH),
		);

		return /** @type {1 | 2 | 3} */ (Math.min(configured, maxByWidth));
	},

	/**
	 * 複数ペイン表示が有効か判定する
	 * @returns {boolean} 有効なら true
	 */
	IsMultiPaneActive: function () {
		return TMS_AL.ScreenMain.GetActivePaneCount() > 1;
	},

	/**
	 * ペイン要素IDを取得する
	 * @param {'left' | 'center' | 'right'} pane ペイン
	 * @returns {string} 要素ID
	 */
	GetPaneElementId: function (pane) {
		if (pane === 'center') {
			return 'tmsAlGroupListCenter';
		}

		return pane === 'right' ? 'tmsAlGroupListRight' : 'tmsAlGroupListLeft';
	},

	/**
	 * 有効なペイン名一覧を取得する
	 * @returns {Array<'left' | 'center' | 'right'>} ペイン名配列
	 */
	GetActivePaneNames: function () {
		const activeCount = TMS_AL.ScreenMain.GetActivePaneCount();

		if (activeCount >= 3) {
			return ['left', 'center', 'right'];
		}

		if (activeCount === 2) {
			return ['left', 'right'];
		}

		return ['left'];
	},

	/**
	 * グループの表示ペインを取得する
	 * @param {import('../../main/types').LauncherGroup} group グループ
	 * @returns {'left' | 'center' | 'right'} ペイン
	 */
	GetGroupTargetPane: function (group) {
		const data = TMS_AL.ScreenMain._data;

		if (!data) {
			return 'left';
		}

		if (group.isUncategorized) {
			return data.settings.uncategorizedPane ?? 'left';
		}

		return group.pane ?? 'left';
	},

	/**
	 * 描画対象のグループリスト要素を取得する
	 * @returns {HTMLElement[]} リスト要素配列
	 */
	GetActiveGroupListElements: function () {
		const lists = [];

		for (const pane of TMS_AL.ScreenMain.GetActivePaneNames()) {
			const el = document.getElementById(TMS_AL.ScreenMain.GetPaneElementId(pane));

			if (el) {
				lists.push(el);
			}
		}

		return lists;
	},

	/**
	 * ペインコンテナのレイアウトクラスを更新する
	 * @returns {void}
	 */
	UpdatePaneLayout: function () {
		const container   = document.getElementById('tmsAlPaneContainer');
		const leftEl      = document.getElementById('tmsAlGroupListLeft');
		const centerEl    = document.getElementById('tmsAlGroupListCenter');
		const rightEl     = document.getElementById('tmsAlGroupListRight');
		const activeCount = TMS_AL.ScreenMain.GetActivePaneCount();
		const paneLabels  = {
			left  : '左ペイン',
			center: '中央ペイン',
			right : '右ペイン',
		};

		if (container) {
			container.classList.toggle('tms-al-pane-container--multi', activeCount > 1);
			container.classList.toggle('tms-al-pane-container--single', activeCount === 1);
		}

		if (leftEl) {
			leftEl.hidden = false;

			if (activeCount === 1) {
				leftEl.removeAttribute('aria-label');
			} else {
				leftEl.setAttribute('aria-label', paneLabels.left);
			}
		}

		if (centerEl) {
			centerEl.hidden = activeCount < 3;

			if (activeCount >= 3) {
				centerEl.setAttribute('aria-label', paneLabels.center);
			} else {
				centerEl.removeAttribute('aria-label');
			}
		}

		if (rightEl) {
			rightEl.hidden = activeCount < 2;

			if (activeCount >= 2) {
				rightEl.setAttribute('aria-label', paneLabels.right);
			} else {
				rightEl.removeAttribute('aria-label');
			}
		}
	},

	/**
	 * ソート済みグループ一覧
	 * @returns {import('../../main/types').LauncherGroup[]} グループ配列
	 */
	GetSortedGroups: function () {
		if (!TMS_AL.ScreenMain._data) {
			return [];
		}

		return [...TMS_AL.ScreenMain._data.groups].sort((a, b) => a.order - b.order);
	},

	/**
	 * 所属グループプルダウン用の並び順（未分類を先頭、他は左ペイン→右ペインの表示順）
	 * @returns {import('../../main/types').LauncherGroup[]} グループ配列
	 */
	GetGroupsForDropdown: function () {
		const data = TMS_AL.ScreenMain._data;

		if (!data) {
			return [];
		}

		const uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();
		const others        = data.groups.filter((group) => !group.isUncategorized);

		/**
		 * @param {import('../../main/types').LauncherGroup} a
		 * @param {import('../../main/types').LauncherGroup} b
		 * @returns {number}
		 */
		const compareByOrder = (a, b) => a.order - b.order;

		let orderedOthers;

		if (TMS_AL.ScreenMain.IsMultiPaneActive()) {
			const leftGroups   = others
				.filter((group) => TMS_AL.ScreenMain.GetGroupTargetPane(group) === 'left')
				.sort(compareByOrder);
			const centerGroups = others
				.filter((group) => TMS_AL.ScreenMain.GetGroupTargetPane(group) === 'center')
				.sort(compareByOrder);
			const rightGroups  = others
				.filter((group) => TMS_AL.ScreenMain.GetGroupTargetPane(group) === 'right')
				.sort(compareByOrder);

			orderedOthers = [...leftGroups, ...centerGroups, ...rightGroups];
		} else {
			const paneOrder = { left: 0, center: 1, right: 2 };

			orderedOthers = [...others].sort((a, b) => {
				const paneA = a.pane ?? 'left';
				const paneB = b.pane ?? 'left';

				if (paneA !== paneB) {
					return paneOrder[paneA] - paneOrder[paneB];
				}

				return compareByOrder(a, b);
			});
		}

		if (uncategorized) {
			return [uncategorized, ...orderedOthers];
		}

		return orderedOthers;
	},

	/**
	 * 未分類グループを取得する
	 * @returns {import('../../main/types').LauncherGroup | undefined} 未分類グループ
	 */
	FindUncategorizedGroup: function () {
		return TMS_AL.ScreenMain._data?.groups.find((g) => g.isUncategorized);
	},

	/**
	 * グループ内アプリを order 昇順で取得
	 * @param {string} groupId グループID
	 * @returns {import('../../main/types').LauncherApp[]} アプリ配列
	 */
	GetAppsForGroup: function (groupId) {
		if (!TMS_AL.ScreenMain._data) {
			return [];
		}

		return TMS_AL.ScreenMain._data.apps
			.filter((app) => app.groupId === groupId)
			.sort((a, b) => a.order - b.order);
	},

	/**
	 * グループ開閉状態をデータへ同期する
	 * @returns {void}
	 */
	SyncGroupExpandedStatesToData: function () {
		const data = TMS_AL.ScreenMain._data;

		if (!data) {
			return;
		}

		data.settings.groupExpandedStates = { ...TMS_AL.ScreenMain._groupExpanded };
	},

	/**
	 * グループ開閉状態を保存する
	 * @param {boolean} [immediate=false] 即時保存
	 * @returns {Promise<void>}
	 */
	PersistGroupExpandedStates: async function (immediate) {
		TMS_AL.ScreenMain.SyncGroupExpandedStatesToData();
		await TMS_AL.ScreenMain.SaveData(immediate);
	},

	/**
	 * グループ開閉状態を初期化する
	 * @param {{ clearSaved?: boolean }} [options] オプション
	 * @returns {void}
	 */
	InitGroupExpandedState: function (options) {
		const data             = TMS_AL.ScreenMain._data;
		const clearSaved       = options?.clearSaved === true;
		const saved            = data?.settings.groupExpandedStates;
		const hasSaved         = !clearSaved
			&& saved
			&& Object.keys(saved).length > 0;
		const fallbackExpanded = data?.settings.toggleInitialState === 'expandAll';

		TMS_AL.ScreenMain._groupExpanded = {};

		if (!data) {
			return;
		}

		for (const group of data.groups) {
			if (hasSaved && Object.prototype.hasOwnProperty.call(saved, group.id)) {
				TMS_AL.ScreenMain._groupExpanded[group.id] = saved[group.id];
			} else if (hasSaved) {
				TMS_AL.ScreenMain._groupExpanded[group.id] = true;
			} else {
				TMS_AL.ScreenMain._groupExpanded[group.id] = fallbackExpanded;
			}
		}
	},

	/**
	 * データを保存する（300ms デバウンス）
	 * @param {boolean} [immediate=false] 即時保存
	 * @returns {Promise<boolean>} 成功時 true
	 */
	SaveData: async function (immediate) {
		if (!TMS_AL.ScreenMain._data) {
			return false;
		}

		if (TMS_AL.ScreenMain._saveTimer) {
			clearTimeout(TMS_AL.ScreenMain._saveTimer);
			TMS_AL.ScreenMain._saveTimer = null;
		}

		/**
		 *
		 */
		const doSave = async () => {
			const result = await window.launcherApi.saveData(TMS_AL.ScreenMain._data);

			if (!result.success) {
				TMS_AL_COMMON.Ui.ShowToast(`保存に失敗しました: ${result.error ?? ''}`, 'error');
				return false;
			}

			return true;
		};

		if (immediate) {
			return doSave();
		}

		return new Promise((resolve) => {
			TMS_AL.ScreenMain._saveTimer = setTimeout(async () => {
				resolve(await doSave());
			}, 300);
		});
	},

	/**
	 * 起動中アプリ状態をDOMへ反映する
	 * @param {import('../../main/types').RunningAppsPayload} payload 起動中ID
	 * @returns {void}
	 */
	ApplyRunningApps: function (payload) {
		const appIds = Array.isArray(payload?.appIds)
			? payload.appIds.filter((id) => typeof id === 'string')
			: [];

		TMS_AL.ScreenMain._runningAppIds = new Set(appIds);

		document.querySelectorAll('.tms-al-app-row').forEach((rowEl) => {
			const appId   = rowEl.getAttribute('data-app-id') ?? '';
			const running = TMS_AL.ScreenMain._runningAppIds.has(appId);
			const stateEl = rowEl.querySelector('.tms-al-app-row__running-state');

			rowEl.classList.toggle('tms-al-app-row--running', running);

			if (stateEl instanceof HTMLElement) {
				stateEl.hidden = !running;
			}
		});
	},

	/**
	 * 現在のDOM表示順で検索結果を構築する
	 * @param {string} query 検索文字列
	 * @returns {({ appId: string; groupId: string; groupName: string; appName: string; path: string; pathFileName: string; label: string }|{ type: 'separator' })[]} 検索結果
	 */
	BuildSearchResults: function (query) {
		const data = TMS_AL.ScreenMain._data;

		if (!data) {
			return [];
		}

		const appsById   = new Map(data.apps.map((app) => [app.id, app]));
		const groupsById = new Map(data.groups.map((group) => [group.id, group]));
		const partial    = [];
		const other      = [];

		document.querySelectorAll('.tms-al-app-row').forEach((rowEl) => {
			const appId = rowEl.getAttribute('data-app-id') ?? '';
			const app   = appsById.get(appId);

			if (!app || !TMS_AL.Search.MatchesApp(app.name, app.path, query)) {
				return;
			}

			const group        = groupsById.get(app.groupId);
			const groupName    = group?.name ?? TMS_AL_COMMON.Const.UNCATEGORIZED_NAME;
			const pathFileName = TMS_AL.Search.GetPathFileName(app.path);
			const item         = {
				appId       : app.id,
				groupId     : app.groupId,
				groupName   : groupName,
				appName     : app.name,
				path        : app.path,
				pathFileName: pathFileName,
				label       : `${groupName}：${app.name}`,
			};

			if (TMS_AL.Search.ContainsApp(app.name, app.path, query)) {
				partial.push(item);
			} else {
				other.push(item);
			}
		});

		return TMS_AL.Search.MergeSearchGroups(partial, other);
	},

	/**
	 * 検索結果が選択可能な項目か判定する
	 * @param {{ type?: string }|null|undefined} result 検索結果
	 * @returns {boolean} 選択可能ならtrue
	 */
	IsSearchResultSelectable: function (result) {
		return Boolean(result && result.type !== 'separator');
	},

	/**
	 * 矢印キーで移動する次の選択可能な検索結果インデックスを返す
	 * @param {number} start 現在のインデックス（未選択は-1）
	 * @param {number} delta 移動量
	 * @returns {number} 次のインデックス（見つからなければ-1）
	 */
	FindNextSearchResultIndex: function (start, delta) {
		const results = TMS_AL.ScreenMain._searchResults;
		const count   = results.length;

		if (count === 0) {
			return -1;
		}

		let index = start;

		if (index < 0) {
			index = delta > 0 ? 0 : count - 1;
		} else {
			index = (index + delta + count) % count;
		}

		for (let step = 0; step < count; step += 1) {
			if (TMS_AL.ScreenMain.IsSearchResultSelectable(results[index])) {
				return index;
			}

			index = (index + delta + count) % count;
		}

		return -1;
	},

	/** 検索プレビューだけを解除する */
	ClearSearchPreview: function () {
		if (TMS_AL.ScreenMain._searchPreviewAppId) {
			const rowEl = document.querySelector(
				`.tms-al-app-row[data-app-id="${TMS_AL.ScreenMain._searchPreviewAppId}"]`,
			);

			rowEl?.classList.remove('tms-al-app-row--search-preview');
		}

		if (TMS_AL.ScreenMain._searchPreviewGroupId
			&& !TMS_AL.ScreenMain._groupExpanded[TMS_AL.ScreenMain._searchPreviewGroupId]) {
			const groupEl = document.querySelector(
				`.tms-al-group[data-group-id="${TMS_AL.ScreenMain._searchPreviewGroupId}"]`,
			);

			groupEl?.classList.remove('tms-al-group--expanded');

			const iconEl = groupEl?.querySelector('.tms-al-group__toggle-icon');

			if (iconEl) {
				iconEl.textContent = '▶';
			}
		}

		TMS_AL.ScreenMain._searchPreviewAppId   = null;
		TMS_AL.ScreenMain._searchPreviewGroupId = null;
	},

	/**
	 * 指定検索結果を選択してプレビューする
	 * @param {number} index 検索結果インデックス
	 * @returns {void}
	 */
	SelectSearchResult: function (index) {
		const resultsEl = document.getElementById('tmsAlSearchResults');
		const inputEl   = document.getElementById('tmsAlSearchInput');

		TMS_AL.ScreenMain.ClearSearchPreview();

		if (index < 0 || index >= TMS_AL.ScreenMain._searchResults.length
			|| !TMS_AL.ScreenMain.IsSearchResultSelectable(TMS_AL.ScreenMain._searchResults[index])) {
			TMS_AL.ScreenMain._searchSelectedIndex = -1;
			resultsEl?.querySelectorAll('[role="option"]').forEach((option) => {
				option.setAttribute('aria-selected', 'false');
			});

			if (inputEl) {
				inputEl.removeAttribute('aria-activedescendant');
			}
			return;
		}

		const result  = TMS_AL.ScreenMain._searchResults[index];
		const groupEl = document.querySelector(`.tms-al-group[data-group-id="${result.groupId}"]`);
		const rowEl   = document.querySelector(`.tms-al-app-row[data-app-id="${result.appId}"]`);

		TMS_AL.ScreenMain._searchSelectedIndex  = index;
		TMS_AL.ScreenMain._searchPreviewAppId   = result.appId;
		TMS_AL.ScreenMain._searchPreviewGroupId = result.groupId;

		if (groupEl) {
			groupEl.classList.add('tms-al-group--expanded');
			const iconEl = groupEl.querySelector('.tms-al-group__toggle-icon');

			if (iconEl) {
				iconEl.textContent = '▼';
			}
		}

		rowEl?.classList.add('tms-al-app-row--search-preview');
		rowEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

		resultsEl?.querySelectorAll('[role="option"]').forEach((option) => {
			const optionIndex = Number(option.id.replace('tmsAlSearchOption', ''));

			option.setAttribute(
				'aria-selected',
				optionIndex === index ? 'true' : 'false',
			);
		});

		const selectedOption = document.getElementById(`tmsAlSearchOption${index}`);
		selectedOption?.scrollIntoView({ block: 'nearest' });

		if (inputEl && selectedOption) {
			inputEl.setAttribute('aria-activedescendant', selectedOption.id);
		}
	},

	/**
	 * 検索ハイライト付きのテキストを要素へ追加する
	 * @param {HTMLElement} parentEl 追加先要素
	 * @param {string} text 表示文字列
	 * @param {string} query 検索文字列
	 * @returns {void}
	 */
	AppendHighlightedSearchText: function (parentEl, text, query) {
		for (const part of TMS_AL.Search.BuildHighlightParts(text, query)) {
			if (!part.highlight) {
				parentEl.appendChild(document.createTextNode(part.text));
				continue;
			}

			const markEl       = document.createElement('mark');
			markEl.className   = 'tms-al-search__highlight';
			markEl.textContent = part.text;

			if (part.kind === 'character') {
				markEl.classList.add('tms-al-search__highlight--character');
			}

			parentEl.appendChild(markEl);
		}
	},

	/**
	 * 検索結果オプション要素を生成する
	 * @param {{ appId: string; groupName: string; appName: string; path: string; pathFileName: string; label: string }} result 検索結果
	 * @param {number} index 検索結果インデックス
	 * @param {string} query 検索文字列
	 * @returns {HTMLElement} 検索結果オプション要素
	 */
	CreateSearchOptionElement: function (result, index, query) {
		const optionEl = document.createElement('div');
		const title    = result.path ? `${result.label}\n${result.path}` : result.label;

		optionEl.id        = `tmsAlSearchOption${index}`;
		optionEl.className = 'tms-al-search__option';
		optionEl.title     = title;
		optionEl.setAttribute('role', 'option');
		optionEl.setAttribute('aria-selected', 'false');
		optionEl.setAttribute(
			'aria-label',
			result.pathFileName ? `${result.label} ${result.pathFileName}` : result.label,
		);

		const primaryLineEl = document.createElement('div');
		const groupNameEl   = document.createElement('span');

		primaryLineEl.className = 'tms-al-search__option-line tms-al-search__option-line--primary';
		groupNameEl.className   = 'tms-al-search__group-name';
		groupNameEl.textContent = `${result.groupName}：`;
		primaryLineEl.appendChild(groupNameEl);
		TMS_AL.ScreenMain.AppendHighlightedSearchText(primaryLineEl, result.appName, query);
		optionEl.appendChild(primaryLineEl);

		if (result.pathFileName) {
			const pathLineEl = document.createElement('div');

			pathLineEl.className = 'tms-al-search__option-line tms-al-search__option-line--path';
			pathLineEl.title     = result.path;
			TMS_AL.ScreenMain.AppendHighlightedSearchText(pathLineEl, result.pathFileName, query);
			optionEl.appendChild(pathLineEl);
		}

		optionEl.addEventListener('mouseenter', () => {
			TMS_AL.ScreenMain.SelectSearchResult(index);
		});
		optionEl.addEventListener('click', () => {
			TMS_AL.ScreenMain.SelectSearchResult(index);
			TMS_AL.ScreenMain.LaunchApp(result.appId);
		});

		return optionEl;
	},

	/**
	 * 入力値から検索結果リストを更新する
	 * @returns {void}
	 */
	UpdateSearchResults: function () {
		const inputEl   = document.getElementById('tmsAlSearchInput');
		const resultsEl = document.getElementById('tmsAlSearchResults');

		if (!(inputEl instanceof HTMLInputElement) || !resultsEl) {
			return;
		}

		TMS_AL.ScreenMain.ClearSearchPreview();
		TMS_AL.ScreenMain._searchSelectedIndex = -1;
		resultsEl.innerHTML                    = '';

		if (!TMS_AL.Search.Normalize(inputEl.value)) {
			TMS_AL.ScreenMain._searchResults = [];
			resultsEl.hidden                 = true;
			inputEl.setAttribute('aria-expanded', 'false');
			inputEl.removeAttribute('aria-activedescendant');
			return;
		}

		TMS_AL.ScreenMain._searchResults = TMS_AL.ScreenMain.BuildSearchResults(inputEl.value);

		if (TMS_AL.ScreenMain._searchResults.length === 0) {
			const emptyEl       = document.createElement('div');
			emptyEl.className   = 'tms-al-search__empty';
			emptyEl.textContent = '該当するアプリはありません';
			resultsEl.appendChild(emptyEl);
		} else {
			TMS_AL.ScreenMain._searchResults.forEach((result, index) => {
				if (result.type === 'separator') {
					const separatorEl     = document.createElement('div');
					separatorEl.className = 'tms-al-search__separator';
					separatorEl.setAttribute('role', 'separator');
					resultsEl.appendChild(separatorEl);
					return;
				}

				resultsEl.appendChild(
					TMS_AL.ScreenMain.CreateSearchOptionElement(result, index, inputEl.value),
				);
			});
		}

		resultsEl.hidden = false;
		inputEl.setAttribute('aria-expanded', 'true');
	},

	/** 検索条件・結果・プレビューをクリアする */
	ClearSearch: function () {
		const inputEl   = document.getElementById('tmsAlSearchInput');
		const resultsEl = document.getElementById('tmsAlSearchResults');

		TMS_AL.ScreenMain.ClearSearchPreview();
		TMS_AL.ScreenMain._searchResults       = [];
		TMS_AL.ScreenMain._searchSelectedIndex = -1;

		if (inputEl instanceof HTMLInputElement) {
			inputEl.value = '';
			inputEl.setAttribute('aria-expanded', 'false');
			inputEl.removeAttribute('aria-activedescendant');
		}

		if (resultsEl) {
			resultsEl.innerHTML = '';
			resultsEl.hidden    = true;
		}
	},

	/**
	 * 画面上に検索以外のモーダルが表示されているか判定する
	 * @returns {boolean} 表示中のモーダルがあれば true
	 */
	HasOpenModal: function () {
		return [...document.querySelectorAll('.tms-al-modal')].some(
			(modal) => modal instanceof HTMLElement && !modal.hidden,
		);
	},

	/**
	 * アプリ検索入力へフォーカスする
	 * @returns {void}
	 */
	FocusSearchInput: function () {
		if (TMS_AL.ScreenMain.HasOpenModal()
			|| !document.body.classList.contains(TMS_AL.Const.WINDOW_FOCUSED_CLASS)) {
			return;
		}

		const inputEl = document.getElementById('tmsAlSearchInput');

		if (inputEl instanceof HTMLInputElement && !inputEl.disabled) {
			inputEl.focus({ preventScroll: true });
		}
	},

	/**
	 * ウィンドウフォーカス変更時の画面操作を処理する
	 * @param {boolean} focused フォーカス中なら true
	 * @returns {void}
	 */
	HandleWindowFocusChanged: function (focused) {
		if (!focused) {
			return;
		}

		window.setTimeout(() => {
			TMS_AL.ScreenMain.FocusSearchInput();
		}, 0);
	},

	/**
	 * 検索ボックス外のキー操作を処理する
	 * @param {KeyboardEvent} event キーイベント
	 * @returns {void}
	 */
	HandleGlobalKeyDown: function (event) {
		if (event.key !== 'Escape' || TMS_AL.ScreenMain.HasOpenModal()) {
			return;
		}

		const inputEl   = document.getElementById('tmsAlSearchInput');
		const resultsEl = document.getElementById('tmsAlSearchResults');

		if (!(inputEl instanceof HTMLInputElement) || event.target === inputEl) {
			return;
		}

		if (!inputEl.value && (!resultsEl || resultsEl.hidden)) {
			return;
		}

		event.preventDefault();
		TMS_AL.ScreenMain.ClearSearch();
	},

	/**
	 * 検索ボックスのキー操作を処理する
	 * @param {KeyboardEvent} event キーイベント
	 * @returns {void}
	 */
	HandleSearchKeyDown: function (event) {
		if (event.key === 'Escape') {
			event.preventDefault();
			TMS_AL.ScreenMain.ClearSearch();
			return;
		}

		const count = TMS_AL.ScreenMain._searchResults.length;

		if (count === 0) {
			return;
		}

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			const next  = TMS_AL.ScreenMain.FindNextSearchResultIndex(
				TMS_AL.ScreenMain._searchSelectedIndex,
				delta,
			);

			TMS_AL.ScreenMain.SelectSearchResult(next);
			return;
		}

		if (event.key === 'Enter' && TMS_AL.ScreenMain._searchSelectedIndex >= 0) {
			event.preventDefault();
			const result = TMS_AL.ScreenMain._searchResults[
				TMS_AL.ScreenMain._searchSelectedIndex
			];

			if (!TMS_AL.ScreenMain.IsSearchResultSelectable(result)) {
				return;
			}

			TMS_AL.ScreenMain.LaunchApp(result.appId);
		}
	},

	/**
	 * 並べ替え後に order / groupId を再計算する
	 * @returns {Promise<void>}
	 */
	RecalculateOrdersFromDom: async function () {
		const data    = TMS_AL.ScreenMain._data;
		const listEls = TMS_AL.ScreenMain.GetActiveGroupListElements();

		if (!data || listEls.length === 0) {
			return;
		}

		const multiPane = TMS_AL.ScreenMain.IsMultiPaneActive();

		for (const listEl of listEls) {
			const pane     = listEl.getAttribute('data-pane') ?? 'left';
			const groupEls = listEl.querySelectorAll('.tms-al-group');

			groupEls.forEach((groupEl, groupIndex) => {
				const groupId = groupEl.getAttribute('data-group-id');
				const group   = data.groups.find((g) => g.id === groupId);

				if (!group || group.isUncategorized) {
					return;
				}

				group.order = groupIndex;

				if (multiPane) {
					group.pane = /** @type {'left' | 'center' | 'right'} */ (pane);
				}
			});
		}

		const uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();

		if (uncategorized) {
			uncategorized.order = 9999;
		}

		for (const listEl of listEls) {
			const groupEls = listEl.querySelectorAll('.tms-al-group');

			groupEls.forEach((groupEl) => {
				const groupId = groupEl.getAttribute('data-group-id');
				const rows    = groupEl.querySelectorAll('.tms-al-app-row');

				rows.forEach((rowEl, rowIndex) => {
					const appId = rowEl.getAttribute('data-app-id');
					const app   = data.apps.find((item) => item.id === appId);

					if (app) {
						app.groupId = groupId ?? app.groupId;
						app.order   = rowIndex;
					}
				});
			});
		}

		await TMS_AL.ScreenMain.SaveData(true);
	},

	/**
	 * アプリ行のアイコンを非同期読込
	 * @param {HTMLElement} rowEl 行要素
	 * @param {import('../../main/types').LauncherApp} app アプリ
	 * @returns {Promise<void>}
	 */
	LoadAppRowIcon: async function (rowEl, app) {
		const imgEl      = rowEl.querySelector('.tms-al-app-row__icon');
		const fallbackEl = rowEl.querySelector('.tms-al-app-row__icon--fallback');

		if (!(imgEl instanceof HTMLImageElement) || !(fallbackEl instanceof HTMLElement)) {
			return;
		}

		const iconPath = app.iconMode === 'custom' && app.customIconPath
			? app.customIconPath
			: app.path;

		if (TMS_AL_COMMON.Funcs.IsEmpty(iconPath)) {
			return;
		}

		const dataUrl = await window.launcherApi.getIcon(iconPath);

		if (dataUrl) {
			imgEl.src         = dataUrl;
			imgEl.hidden      = false;
			fallbackEl.hidden = true;
		}
	},

	/**
	 * パス存在警告を表示
	 * @param {HTMLElement} rowEl 行要素
	 * @param {string} filePath パス
	 * @returns {Promise<void>}
	 */
	UpdatePathWarning: async function (rowEl, filePath) {
		const warnEl = rowEl.querySelector('.tms-al-app-row__warn');

		if (!(warnEl instanceof HTMLElement)) {
			return;
		}

		const valid  = await window.launcherApi.isValidExecutablePath(filePath);
		const exists = valid ? await window.launcherApi.pathExists(filePath) : false;

		warnEl.hidden = valid && exists;
	},

	/**
	 * アプリ行 DOM を生成する
	 * @param {import('../../main/types').LauncherApp} app アプリ
	 * @returns {HTMLElement} 行要素
	 */
	CreateAppRowElement: function (app) {
		const rowEl     = document.createElement('div');
		const pathLabel = TMS_AL_COMMON.Funcs.GetPathBasename(app.path);

		rowEl.className = `tms-al-app-row${TMS_AL.ScreenMain._runningAppIds.has(app.id) ? ' tms-al-app-row--running' : ''}`;
		rowEl.setAttribute('data-app-id', app.id);

		rowEl.innerHTML = [
			'<span class="tms-al-app-row__drag" title="ドラッグで並べ替え">⠿</span>',
			'<span class="tms-al-app-row__icon-wrap">',
			'<img class="tms-al-app-row__icon" alt="" hidden>',
			'<span class="tms-al-app-row__icon tms-al-app-row__icon--fallback">📄</span>',
			'</span>',
			`<a class="tms-al-app-row__name tms-al-app-row__name-link" href="#" title="${TMS_AL_COMMON.Funcs.EscapeHtml(app.name)}">${TMS_AL_COMMON.Funcs.EscapeHtml(app.name)}</a>`,
			`<span class="tms-al-app-row__path" title="${TMS_AL_COMMON.Funcs.EscapeHtml(app.path)}">${TMS_AL_COMMON.Funcs.EscapeHtml(pathLabel)}</span>`,
			`<span class="tms-al-app-row__running-state" title="起動中" aria-label="起動中"${TMS_AL.ScreenMain._runningAppIds.has(app.id) ? '' : ' hidden'}></span>`,
			'<span class="tms-al-app-row__warn" title="パスが存在しません" hidden>⚠</span>',
			'<span class="tms-al-app-row__actions">',
			'<button class="tms-al-btn tms-al-btn--small" type="button" data-action="edit">編集</button>',
			'<button class="tms-al-btn tms-al-btn--small tms-al-btn--danger" type="button" data-action="delete">削除</button>',
			'</span>',
		].join('');

		const nameLink = rowEl.querySelector('.tms-al-app-row__name-link');
		const iconImg  = rowEl.querySelector('.tms-al-app-row__icon:not(.tms-al-app-row__icon--fallback)');

		rowEl.addEventListener('contextmenu', (event) => {
			TMS_AL.ScreenMain.OpenAppContextMenu(app.id, event);
		});

		if (nameLink instanceof HTMLAnchorElement) {
			nameLink.addEventListener('click', (event) => {
				event.preventDefault();
				TMS_AL.ScreenMain.LaunchApp(app.id);
			});
		}

		if (iconImg instanceof HTMLImageElement) {
			iconImg.style.cursor = 'pointer';
			iconImg.addEventListener('click', () => {
				TMS_AL.ScreenMain.LaunchApp(app.id);
			});
		}

		const editBtn = rowEl.querySelector('[data-action="edit"]');

		if (editBtn) {
			editBtn.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.OpenEdit(app.id);
			});
		}

		const deleteBtn = rowEl.querySelector('[data-action="delete"]');

		if (deleteBtn) {
			deleteBtn.addEventListener('click', () => {
				TMS_AL.ScreenMain.DeleteApp(app.id);
			});
		}

		TMS_AL.ScreenMain.LoadAppRowIcon(rowEl, app);
		TMS_AL.ScreenMain.UpdatePathWarning(rowEl, app.path);

		return rowEl;
	},

	/**
	 * グループ DOM を生成する
	 * @param {import('../../main/types').LauncherGroup} group グループ
	 * @returns {HTMLElement} グループ要素
	 */
	CreateGroupElement: function (group) {
		const isExpanded = TMS_AL.ScreenMain._groupExpanded[group.id] ?? true;
		const apps       = TMS_AL.ScreenMain.GetAppsForGroup(group.id);
		const groupEl    = document.createElement('section');

		groupEl.className = `tms-al-group${isExpanded ? ' tms-al-group--expanded' : ''}${group.isUncategorized ? ' tms-al-group--fixed' : ''}`;
		groupEl.setAttribute('data-group-id', group.id);
		groupEl.setAttribute('role', 'listitem');

		const dragHandle = group.isUncategorized
			? '<span class="tms-al-group__toggle"></span>'
			: '<span class="tms-al-group__drag-handle tms-al-group__toggle" title="ドラッグで並べ替え">⠿</span>';

		const groupActions = group.isUncategorized
			? ''
			: [
				'<span class="tms-al-group__actions">',
				'<button class="tms-al-btn tms-al-btn--small" type="button" data-action="rename">改名</button>',
				'<button class="tms-al-btn tms-al-btn--small tms-al-btn--danger" type="button" data-action="delete">削除</button>',
				'</span>',
			].join('');

		const toggleIcon = isExpanded ? '▼' : '▶';

		groupEl.innerHTML = [
			'<div class="tms-al-group__header">',
			dragHandle,
			`<span class="tms-al-group__toggle-icon">${toggleIcon}</span>`,
			`<span class="tms-al-group__name">${TMS_AL_COMMON.Funcs.EscapeHtml(group.name)}</span>`,
			`<span class="tms-al-group__count">(${apps.length})</span>`,
			groupActions,
			'</div>',
			'<div class="tms-al-group__apps"></div>',
		].join('');

		const headerEl = groupEl.querySelector('.tms-al-group__header');
		const appsEl   = groupEl.querySelector('.tms-al-group__apps');

		if (headerEl) {
			headerEl.addEventListener('click', (event) => {
				if (TMS_AL.RowDrag.ConsumeClick()) {
					return;
				}

				if (!(event.target instanceof HTMLElement)) {
					return;
				}

				if (event.target.closest('button, .tms-al-group__drag-handle')) {
					return;
				}

				TMS_AL.ScreenMain.ToggleGroup(group.id);
			});
		}

		const renameBtn = groupEl.querySelector('[data-action="rename"]');

		if (renameBtn) {
			renameBtn.addEventListener('click', (event) => {
				event.stopPropagation();
				TMS_AL.ScreenMain.RenameGroup(group.id);
			});
		}

		const deleteBtn = groupEl.querySelector('[data-action="delete"]');

		if (deleteBtn) {
			deleteBtn.addEventListener('click', (event) => {
				event.stopPropagation();
				TMS_AL.ScreenMain.DeleteGroup(group.id);
			});
		}

		if (appsEl) {
			for (const app of apps) {
				appsEl.appendChild(TMS_AL.ScreenMain.CreateAppRowElement(app));
			}
		}

		return groupEl;
	},

	/**
	 * 一覧を描画する
	 * @returns {Promise<void>}
	 */
	Render: async function () {
		const leftEl   = document.getElementById('tmsAlGroupListLeft');
		const centerEl = document.getElementById('tmsAlGroupListCenter');
		const rightEl  = document.getElementById('tmsAlGroupListRight');
		const emptyEl  = document.getElementById('tmsAlEmptyMessage');
		const data     = TMS_AL.ScreenMain._data;

		if (!leftEl || !data) {
			return;
		}

		TMS_AL.ScreenMain.UpdatePaneLayout();

		leftEl.innerHTML = '';

		if (centerEl) {
			centerEl.innerHTML = '';
		}

		if (rightEl) {
			rightEl.innerHTML = '';
		}

		const activePaneCount = TMS_AL.ScreenMain.GetActivePaneCount();
		const groups          = TMS_AL.ScreenMain.GetSortedGroups();

		/**
		 * @param {import('../../main/types').LauncherGroup} a
		 * @param {import('../../main/types').LauncherGroup} b
		 * @returns {number}
		 */
		const compareGroupOrder = (a, b) => {
			if (a.isUncategorized) {
				return 1;
			}

			if (b.isUncategorized) {
				return -1;
			}

			return a.order - b.order;
		};

		if (activePaneCount > 1) {
			const paneElements = {
				left  : leftEl,
				center: centerEl,
				right : rightEl,
			};

			for (const pane of TMS_AL.ScreenMain.GetActivePaneNames()) {
				const listEl = paneElements[pane];

				if (!listEl) {
					continue;
				}

				const paneGroups = groups
					.filter((group) => TMS_AL.ScreenMain.GetGroupTargetPane(group) === pane)
					.sort(compareGroupOrder);

				for (const group of paneGroups) {
					listEl.appendChild(TMS_AL.ScreenMain.CreateGroupElement(group));
				}
			}
		} else {
			const singlePaneGroups = [...groups].sort((a, b) => {
				if (a.isUncategorized) {
					return 1;
				}

				if (b.isUncategorized) {
					return -1;
				}

				const paneOrder = { left: 0, center: 1, right: 2 };
				const paneA     = a.pane ?? 'left';
				const paneB     = b.pane ?? 'left';

				if (paneA !== paneB) {
					return paneOrder[paneA] - paneOrder[paneB];
				}

				return a.order - b.order;
			});

			for (const group of singlePaneGroups) {
				leftEl.appendChild(TMS_AL.ScreenMain.CreateGroupElement(group));
			}
		}

		if (emptyEl) {
			emptyEl.hidden = data.apps.length > 0;
		}

		TMS_AL.ScreenMain._lastActivePaneCount = activePaneCount;
		TMS_AL.ScreenMain.ApplyRunningApps({ appIds: [...TMS_AL.ScreenMain._runningAppIds] });

		const searchInput = document.getElementById('tmsAlSearchInput');

		if (searchInput instanceof HTMLInputElement && searchInput.value) {
			TMS_AL.ScreenMain.UpdateSearchResults();
		}
	},

	/**
	 * グループ開閉を切り替える
	 * @param {string} groupId グループID
	 * @returns {void}
	 */
	ToggleGroup: function (groupId) {
		TMS_AL.ScreenMain._groupExpanded[groupId] = !TMS_AL.ScreenMain._groupExpanded[groupId];

		const groupEl = document.querySelector(`.tms-al-group[data-group-id="${groupId}"]`);

		if (!groupEl) {
			return;
		}

		const expanded = TMS_AL.ScreenMain._groupExpanded[groupId];
		const iconEl   = groupEl.querySelector('.tms-al-group__toggle-icon');

		groupEl.classList.toggle('tms-al-group--expanded', expanded);

		if (iconEl) {
			iconEl.textContent = expanded ? '▼' : '▶';
		}

		TMS_AL.ScreenMain.PersistGroupExpandedStates();
	},

	/**
	 * すべて展開する
	 * @returns {void}
	 */
	ExpandAll: function () {
		if (!TMS_AL.ScreenMain._data) {
			return;
		}

		for (const group of TMS_AL.ScreenMain._data.groups) {
			TMS_AL.ScreenMain._groupExpanded[group.id] = true;
		}

		TMS_AL.ScreenMain.Render();
		TMS_AL.ScreenMain.PersistGroupExpandedStates();
	},

	/**
	 * すべて折りたたむ
	 * @returns {void}
	 */
	CollapseAll: function () {
		if (!TMS_AL.ScreenMain._data) {
			return;
		}

		for (const group of TMS_AL.ScreenMain._data.groups) {
			TMS_AL.ScreenMain._groupExpanded[group.id] = false;
		}

		TMS_AL.ScreenMain.Render();
		TMS_AL.ScreenMain.PersistGroupExpandedStates();
	},

	/**
	 * アプリ右クリックメニューの選択結果を処理する
	 * @param {string} appId アプリID
	 * @param {'launch' | 'runAsAdmin' | 'edit' | 'delete' | null} action 選択アクション
	 * @returns {Promise<void>}
	 */
	HandleAppContextMenuAction: async function (appId, action) {
		if (action === 'launch') {
			await TMS_AL.ScreenMain.LaunchApp(appId);
			return;
		}

		if (action === 'runAsAdmin') {
			await TMS_AL.ScreenMain.LaunchApp(appId, { runAsAdmin: true });
			return;
		}

		if (action === 'edit') {
			TMS_AL.ScreenModalEdit.OpenEdit(appId);
			return;
		}

		if (action === 'delete') {
			await TMS_AL.ScreenMain.DeleteApp(appId);
		}
	},

	/**
	 * アプリ右クリックメニューを表示する
	 * @param {string} appId アプリID
	 * @param {MouseEvent} event 右クリックイベント
	 * @returns {Promise<void>}
	 */
	OpenAppContextMenu: async function (appId, event) {
		event.preventDefault();
		event.stopPropagation();

		try {
			const action = await window.launcherApi.showAppContextMenu();

			await TMS_AL.ScreenMain.HandleAppContextMenuAction(appId, action);
		} catch (error) {
			TMS_AL.ComFnc.LogError('Failed to show app context menu', {
				appId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},

	/**
	 * アプリを起動する
	 * @param {string} appId アプリID
	 * @param {{ runAsAdmin?: boolean }} [options] 起動オプション
	 * @returns {Promise<void>}
	 */
	LaunchApp: async function (appId, options) {
		const data = TMS_AL.ScreenMain._data;
		const app  = data?.apps.find((item) => item.id === appId);

		if (!app || !data) {
			return;
		}

		const result = await window.launcherApi.launchApp({
			path          : app.path,
			name          : app.name,
			args          : app.args,
			workingDir    : app.workingDir,
			launchBehavior: data.settings.launchBehavior,
			runAsAdmin    : options?.runAsAdmin === true,
		});

		if (!result.success) {
			const detail = result.error ? `\n${result.error}` : TMS_AL_COMMON.Const.BLANK;
			const action = options?.runAsAdmin === true ? '管理者として起動' : '起動';

			TMS_AL_COMMON.Ui.ShowToast(
				`「${app.name}」を${action}できませんでした。パスを確認してください: ${app.path}${detail}`,
				'error',
			);
		}
	},

	/**
	 * アプリを削除する
	 * @param {string} appId アプリID
	 * @returns {Promise<void>}
	 */
	DeleteApp: async function (appId) {
		const data = TMS_AL.ScreenMain._data;
		const app  = data?.apps.find((item) => item.id === appId);

		if (!app || !data) {
			return;
		}

		const ok = TMS_AL_COMMON.Ui.Confirm(`「${app.name}」を削除します。よろしいですか？`);

		if (!ok) {
			return;
		}

		data.apps = data.apps.filter((item) => item.id !== appId);

		const saved = await TMS_AL.ScreenMain.SaveData(true);

		if (saved) {
			await TMS_AL.ScreenMain.Render();
		}
	},

	/**
	 * グループを追加する
	 * @returns {Promise<void>}
	 */
	AddGroup: async function () {
		const data = TMS_AL.ScreenMain._data;
		const name = await TMS_AL_COMMON.Ui.PromptAsync('新しいグループ名を入力してください:');

		if (!data || TMS_AL_COMMON.Funcs.IsEmpty(name)) {
			return;
		}

		const normalGroups = data.groups.filter((g) => !g.isUncategorized);
		const maxOrder     = normalGroups.reduce((max, g) => Math.max(max, g.order), -1);

		data.groups.push({
			id             : `g-${TMS_AL_COMMON.Funcs.GenerateUuid()}`,
			name           : name.trim(),
			order          : maxOrder + 1,
			isUncategorized: false,
			pane           : 'left',
		});

		const saved = await TMS_AL.ScreenMain.SaveData(true);

		if (saved) {
			await TMS_AL.ScreenMain.LoadAndRender();
		}
	},

	/**
	 * グループ名を変更する
	 * @param {string} groupId グループID
	 * @returns {Promise<void>}
	 */
	RenameGroup: async function (groupId) {
		const data  = TMS_AL.ScreenMain._data;
		const group = data?.groups.find((g) => g.id === groupId);

		if (!group || group.isUncategorized) {
			return;
		}

		const name = await TMS_AL_COMMON.Ui.PromptAsync('グループ名を入力してください:', group.name);

		if (TMS_AL_COMMON.Funcs.IsEmpty(name)) {
			return;
		}

		group.name  = name.trim();
		const saved = await TMS_AL.ScreenMain.SaveData(true);

		if (saved) {
			await TMS_AL.ScreenMain.Render();
		}
	},

	/**
	 * グループを削除する
	 * @param {string} groupId グループID
	 * @returns {Promise<void>}
	 */
	DeleteGroup: async function (groupId) {
		const data  = TMS_AL.ScreenMain._data;
		const group = data?.groups.find((g) => g.id === groupId);

		if (!group || group.isUncategorized || !data) {
			return;
		}

		const movingApps = data.apps.filter((app) => app.groupId === groupId);
		const message    = `グループ「${group.name}」を削除します。所属する ${movingApps.length} 件のアプリは「未分類」へ移動します。よろしいですか？`;
		const ok         = TMS_AL_COMMON.Ui.Confirm(message);

		if (!ok) {
			return;
		}

		let uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();

		if (!uncategorized) {
			uncategorized = {
				id             : `g-${TMS_AL_COMMON.Funcs.GenerateUuid()}`,
				name           : TMS_AL_COMMON.Const.UNCATEGORIZED_NAME,
				order          : 9999,
				isUncategorized: true,
			};
			data.groups.push(uncategorized);
		}

		const maxOrder = data.apps
			.filter((app) => app.groupId === uncategorized.id)
			.reduce((max, app) => Math.max(max, app.order), -1);

		movingApps.forEach((app, index) => {
			app.groupId = uncategorized.id;
			app.order   = maxOrder + 1 + index;
		});

		data.groups = data.groups.filter((g) => g.id !== groupId);

		const saved = await TMS_AL.ScreenMain.SaveData(true);

		if (saved) {
			await TMS_AL.ScreenMain.LoadAndRender();
		}
	},

	/**
	 * フッターのバージョン表示を更新する
	 * @returns {Promise<void>}
	 */
	UpdateVersion: async function () {
		const versionEl = document.getElementById('tmsAlVersion');

		if (!versionEl) {
			return;
		}

		try {
			const info            = await window.launcherApi.getVersion();
			versionEl.textContent = `v${info.version}`;
		} catch (error) {
			TMS_AL.ComFnc.LogError('Failed to get app version', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},

	/**
	 * データを読み込んで画面に反映する
	 * @returns {Promise<void>}
	 */
	LoadAndRender: async function () {
		try {
			const result = await window.launcherApi.loadData();

			if (!result.success || !result.data) {
				TMS_AL.ComFnc.LogError('Failed to load data', { error: result.error });
				return;
			}

			TMS_AL.ScreenMain._data = result.data;

			if (result.recoveredFromBackup) {
				TMS_AL_COMMON.Ui.ShowToast('データファイルをバックアップから復旧しました。', 'warn');
			}

			TMS_AL.ScreenMain.InitGroupExpandedState();
			await TMS_AL.Theme.Apply(result.data.settings.appearance);
			await window.launcherApi.applyLayoutSettings(result.data.settings.paneCount ?? 1);
			await TMS_AL.ScreenMain.Render();

			window.launcherApi.writeLog('INFO', 'Main screen rendered', {
				appCount  : result.data.apps.length,
				groupCount: result.data.groups.length,
			});
		} catch (error) {
			TMS_AL.ComFnc.LogError('Failed to initialize main screen', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},

	/**
	 * イベントハンドラを登録する
	 * @returns {void}
	 */
	BindEvents: function () {
		const btnSettings    = document.getElementById('tmsAlBtnSettings');
		const btnCollapseAll = document.getElementById('tmsAlBtnCollapseAll');
		const btnExpandAll   = document.getElementById('tmsAlBtnExpandAll');
		const btnAdd         = document.getElementById('tmsAlBtnAdd');
		const btnAddGroup    = document.getElementById('tmsAlBtnAddGroup');
		const searchInput    = document.getElementById('tmsAlSearchInput');
		const searchResults  = document.getElementById('tmsAlSearchResults');

		if (btnSettings) {
			btnSettings.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.Open();
			});
		}

		if (btnCollapseAll) {
			btnCollapseAll.addEventListener('click', () => {
				TMS_AL.ScreenMain.CollapseAll();
			});
		}

		if (btnExpandAll) {
			btnExpandAll.addEventListener('click', () => {
				TMS_AL.ScreenMain.ExpandAll();
			});
		}

		if (btnAdd) {
			btnAdd.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.OpenNew();
			});
		}

		if (btnAddGroup) {
			btnAddGroup.addEventListener('click', () => {
				TMS_AL.ScreenMain.AddGroup();
			});
		}

		if (searchInput instanceof HTMLInputElement) {
			searchInput.addEventListener('input', TMS_AL.ScreenMain.UpdateSearchResults);
			searchInput.addEventListener('keydown', TMS_AL.ScreenMain.HandleSearchKeyDown);
		}

		window.addEventListener('focus', () => {
			TMS_AL.ScreenMain.HandleWindowFocusChanged(true);
		});
		window.launcherApi.onWindowFocusChanged((focused) => {
			TMS_AL.ScreenMain.HandleWindowFocusChanged(focused);
		});
		TMS_AL.ScreenMain.HandleWindowFocusChanged(document.hasFocus());

		document.addEventListener('keydown', TMS_AL.ScreenMain.HandleGlobalKeyDown, { capture: true });

		searchResults?.addEventListener('mouseleave', () => {
			TMS_AL.ScreenMain.SelectSearchResult(-1);
		});

		window.addEventListener('resize', () => {
			if (TMS_AL.ScreenMain._resizeTimer) {
				clearTimeout(TMS_AL.ScreenMain._resizeTimer);
			}

			TMS_AL.ScreenMain._resizeTimer = setTimeout(async () => {
				const activeCount = TMS_AL.ScreenMain.GetActivePaneCount();

				if (TMS_AL.ScreenMain._lastActivePaneCount !== activeCount) {
					await TMS_AL.ScreenMain.Render();
				}
			}, 150);
		});
	},
});

/**
 * 初期化エントリーポイント
 * @returns {Promise<void>}
 */
TMS_AL.Init = async function () {
	if (!TMS_AL.ComFnc.IsApiAvailable()) {
		console.error(`${TMS_AL_COMMON.Const.LOG_PREFIX} launcherApi is not available`);
		return;
	}

	TMS_AL.Theme.BindWindowFocusEvents();
	TMS_AL.RowDrag.Bind();
	TMS_AL.ScreenMain.BindEvents();

	window.launcherApi.onThemeChanged(async () => {
		const appearance = TMS_AL.ScreenMain._data?.settings.appearance;

		if (appearance === 'system') {
			await TMS_AL.Theme.Apply('system');
			return;
		}

		await TMS_AL.Theme.ApplyWindowChrome();
	});

	window.launcherApi.onUpdateStatus((payload) => {
		TMS_AL.ScreenMain.HandleUpdateStatus(payload);
	});

	window.launcherApi.onRunningAppsChanged((payload) => {
		TMS_AL.ScreenMain.ApplyRunningApps(payload);
	});

	window.launcherApi.onBeforeClose(async () => {
		try {
			TMS_AL.ScreenMain.SyncGroupExpandedStatesToData();
			await TMS_AL.ScreenMain.SaveData(true);
		} finally {
			window.launcherApi.notifyCloseReady();
		}
	});

	TMS_AL.ScreenMain.UpdateTitle(await window.launcherApi.isAdministrator());
	await TMS_AL.ScreenMain.UpdateVersion();
	await TMS_AL.ScreenMain.LoadAndRender();
	TMS_AL.ScreenMain.ApplyRunningApps(await window.launcherApi.getRunningApps());
};

TMS_AL.Init();
