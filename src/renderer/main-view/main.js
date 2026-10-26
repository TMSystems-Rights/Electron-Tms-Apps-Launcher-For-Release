/**
 * グループ一覧の描画、起動、並び替え、テーマ適用を画面へ接続する
 * 保存データの読み書きは launcherApi に渡し、このファイルは表示中の状態を持つ
 * @file
 */
'use strict';

/** アプリタイトル */
const APP_TITLE = 'TMS-AppsLauncher';

/** 管理者権限時のタイトル接尾辞 */
const ADMINISTRATOR_TITLE_SUFFIX = '（管理者権限）';

/** @type {RegExp} */
const CSS_COLOR_HEX_PATTERN = /^#[0-9a-f]{6}$/iu;

// ----------------------------------------------
// 画面共通の定数
// ----------------------------------------------
Object.assign(TMS_AL.Const, {
	/** テーマクラス: ダーク */
	THEME_CLASS_DARK: 'tms-al-theme-dark',
	/** テーマクラス: ライト */
	THEME_CLASS_LIGHT: 'tms-al-theme-light',
	/** ウィンドウフォーカスクラス */
	WINDOW_FOCUSED_CLASS: 'tms-al-window-focused',
	/** 1ペインあたりの最小幅 */
	PANE_MIN_WIDTH: 360
});

// ----------------------------------------------
// 画面共通の関数
// ----------------------------------------------
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
	 */
	LogError: function (message, context) {
		// launcherApi があるときだけファイルへ書く。無いときはコンソールだけ
		if (TMS_AL.ComFnc.IsApiAvailable()) {
			window.launcherApi.writeLog('ERROR', message, context);
		}

		console.error(`${TMS_AL_COMMON.Const.LOG_PREFIX} ${message}`, context);
	}
});

// ----------------------------------------------
// テーマ
// ----------------------------------------------
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
		// テーマクラスを付ける body。画面は一つ
		const body = document.body;

		body.classList.remove(TMS_AL.Const.THEME_CLASS_DARK);
		body.classList.remove(TMS_AL.Const.THEME_CLASS_LIGHT);

		// ダーク指定のときはダーククラスだけ付けて、OS の色は見ない
		if (appearance === 'dark') {
			body.classList.add(TMS_AL.Const.THEME_CLASS_DARK);
			return;
		}

		// ライト指定のときはライトクラスだけ付ける
		if (appearance === 'light') {
			body.classList.add(TMS_AL.Const.THEME_CLASS_LIGHT);
			return;
		}

		// OS がダークなら true。system 以外はここまで来ない
		const isDark = await window.launcherApi.shouldUseDarkColors();

		// OS がダークのときだけダーククラスを付ける。ライトの OS ではクラス無し
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
		// OS のタイトルバー色。取れないときは null で、カスタムプロパティは変えない
		const colors = await window.launcherApi.getWindowChromeColors();
		// カスタムプロパティを書く body。無いときは反映できない
		const body   = document.body;

		// 色か body が無いと反映できない。どちらか欠けると何もしない
		if (!colors || !body) {
			return;
		}

		// CSS カスタムプロパティと、OS から受け取った色。無効な色は後で捨てる
		const colorMap = {
			// アクティブ時のタイトルバー背景。CSS 色として無効なら適用しない
			'--tms-al-titlebar-active-bg': colors.activeBackground,
			// アクティブ時の文字色
			'--tms-al-titlebar-active-text': colors.activeText,
			// 非アクティブ時のタイトルバー背景
			'--tms-al-titlebar-inactive-bg': colors.inactiveBackground,
			// 非アクティブ時の文字色
			'--tms-al-titlebar-inactive-text': colors.inactiveText
		};

		Object.entries(colorMap).forEach(([property, color]) => {
			// CSS の色として使えるときだけカスタムプロパティへ書く
			if (TMS_AL.Theme.IsValidCssColor(color)) {
				body.style.setProperty(property, color);
			}
		});
	},

	/**
	 * ウィンドウフォーカス状態を body に反映する
	 * @param {boolean} focused フォーカス中なら true
	 */
	SetWindowFocus: function (focused) {
		document.documentElement.classList.toggle(TMS_AL.Const.WINDOW_FOCUSED_CLASS, focused);
		document.body.classList.toggle(TMS_AL.Const.WINDOW_FOCUSED_CLASS, focused);
	},

	/**
	 * ウィンドウフォーカス状態イベントを登録する
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
	}
});

/** ドラッグ並べ替え（SortableJS 非依存・Electron 向け） */
// ----------------------------------------------
// 行とグループのドラッグ
// ----------------------------------------------
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
	 */
	Bind: function () {
		// すでに登録済みなら二重にリスナーを足さない
		if (TMS_AL.RowDrag._bound) {
			return;
		}

		TMS_AL.RowDrag._bound = true;
		// キャプチャ段階で受ける。行のクリックより先にドラッグ開始を判定する
		const opts            = {
			// バブリング前に処理する。子要素の既定動作より先
			capture: true
		};

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
		// ドラッグ直後の click を潰すフラグが無いときは、通常のクリックとして通す
		if (!TMS_AL.RowDrag._suppressClick) {
			return false;
		}

		TMS_AL.RowDrag._suppressClick = false;

		return true;
	},

	/**
	 * @param {PointerEvent} event ポインターイベント
	 */
	_onPointerDown: function (event) {
		// 左ボタン以外、または対象が要素でないときはドラッグを始めない。どちらか一方で足りる
		if (event.button !== 0 || !(event.target instanceof Element)) {
			return;
		}

		// アプリ行のドラッグハンドル。グループ用ハンドルとは別に見る
		const appHandle = event.target.closest('.tms-al-app-row__drag');

		// アプリ行のハンドル上なら、その行のドラッグを開始してグループ側は見ない
		if (appHandle instanceof HTMLElement) {
			// 動かすアプリ行。ハンドルが行の外なら開始しない
			const row = appHandle.closest('.tms-al-app-row');

			// 行要素があるときだけポインタを捕捉してドラッグ状態を作る
			if (row instanceof HTMLElement) {
				event.preventDefault();
				appHandle.setPointerCapture(event.pointerId);
				TMS_AL.RowDrag._state = {
					// ドラッグ対象はアプリ行
					type: 'app',
					// 移動する行要素
					element: row,
					// ポインタを捕捉するハンドル
					handle: appHandle,
					// この操作のポインタ。別ポインタの move は無視する
					pointerId: event.pointerId,
					// 押し始めたビューポート X。単位は px。閾値判定の起点
					startX: event.clientX,
					// 押し始めたビューポート Y。単位は px
					startY: event.clientY,
					// まだ閾値を超えていない。超えたあとだけ並べ替えと click 抑止をする
					moved: false
				};
				document.body.classList.add('tms-al-body--dragging');
			}

			return;
		}

		// グループのドラッグハンドル。アプリ行ハンドルではなかったときだけ見る
		const groupHandle = event.target.closest('.tms-al-group__drag-handle');

		// グループハンドルでなければドラッグしない
		if (!(groupHandle instanceof HTMLElement)) {
			return;
		}

		// 動かすグループ要素。ハンドルがグループの外なら開始しない
		const group = groupHandle.closest('.tms-al-group');

		// グループ要素でない、または未分類の固定グループならドラッグしない。どちらか一方で足りる
		if (!(group instanceof HTMLElement) || group.classList.contains('tms-al-group--fixed')) {
			return;
		}

		event.preventDefault();
		groupHandle.setPointerCapture(event.pointerId);
		TMS_AL.RowDrag._state = {
			// ドラッグ対象はグループ
			type: 'group',
			// 移動するグループ要素
			element: group,
			// ポインタを捕捉するハンドル
			handle: groupHandle,
			// この操作のポインタ。別ポインタの move は無視する
			pointerId: event.pointerId,
			// 押し始めたビューポート X。単位は px
			startX: event.clientX,
			// 押し始めたビューポート Y。単位は px
			startY: event.clientY,
			// まだ閾値を超えていない
			moved: false
		};
		document.body.classList.add('tms-al-body--dragging');
	},

	/**
	 * @param {PointerEvent} event ポインターイベント
	 */
	_onPointerMove: function (event) {
		// 進行中のドラッグ。無いときは移動しない
		const state = TMS_AL.RowDrag._state;

		// ドラッグ中でない、または別ポインタの移動なら無視する。どちらか一方で足りる
		if (!state || event.pointerId !== state.pointerId) {
			return;
		}

		// まだ閾値を超えていない移動は、並べ替えを始めずに距離だけ見る
		if (!state.moved) {
			// 押し始めからの横移動量。単位は px
			const dx = Math.abs(event.clientX - state.startX);
			// 押し始めからの縦移動量。単位は px
			const dy = Math.abs(event.clientY - state.startY);

			// 横も縦も閾値未満のときはまだクリックの可能性があるので並べ替えない。どちらも未満のときだけ入る
			if (dx < TMS_AL.RowDrag._DRAG_THRESHOLD && dy < TMS_AL.RowDrag._DRAG_THRESHOLD) {
				return;
			}

			state.moved = true;
			state.element.classList.add(state.type === 'app' ? 'tms-al-app-row--dragging' : 'tms-al-group--dragging');
		}

		// アプリ行のドラッグは行の移動だけ行い、グループ移動へは進まない
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
		// 座標の下にある要素。手前から奥へ見る
		for (const el of document.elementsFromPoint(clientX, clientY)) {
			// 要素でないヒットは closest できない
			if (!(el instanceof Element)) {
				continue;
			}

			// ドラッグ中の要素そのもの、またはその子孫はドロップ先にしない。どちらか一方で飛ばす
			if (dragging === el || dragging.contains(el)) {
				continue;
			}

			// selector に一致する祖先。無いときは次のヒットを見る
			const match = el.closest(selector);

			// 一致が要素であり、かつドラッグ中の要素の中に無いときだけそれを返す。どちらか欠けると次を見る
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
	 */
	_placeInList: function (listEl, item, clientY, itemSelector) {
		// 同じリスト内の、動かしている要素以外の行。空なら末尾へ足すだけ
		const peers = [...listEl.children].filter((el) => el instanceof HTMLElement && el.matches(itemSelector) && el !== item);

		// 比較相手が無いときは、まだそのリストに無ければ末尾へ入れる
		if (peers.length === 0) {
			// すでにそのリストの子なら動かす必要が無い
			if (item.parentElement !== listEl) {
				listEl.appendChild(item);
			}

			return;
		}

		/** @type {HTMLElement | null} */
		let insertBeforeRef = null;

		// 挿入位置の基準にする行。上から境界を見て、最初に入った帯で決める
		for (const peer of peers) {
			// 相手行の矩形。単位はビューポート px
			const rect  = peer.getBoundingClientRect();
			// 中央より上のヒステリシス境界。単位は px。この上なら相手の前へ入れる
			const upper = rect.top + rect.height * (0.5 - TMS_AL.RowDrag._HYSTERESIS_RATIO / 2);
			// 中央より下のヒステリシス境界。単位は px。帯の中は隣り同士を動かさない
			const lower = rect.top + rect.height * (0.5 + TMS_AL.RowDrag._HYSTERESIS_RATIO / 2);

			// 上側の境界よりポインタが上なら、この行の前に入れる
			if (clientY < upper) {
				insertBeforeRef = peer;
				break;
			}

			// ヒステリシス帯の中では、すでに隣なら入れ替えない
			if (clientY <= lower) {
				// すでにこの行の直前か直後にいるときは位置を変えない。どちらか一方で足りる
				if (item.nextElementSibling === peer || peer.nextElementSibling === item) {
					return;
				}

				insertBeforeRef = clientY < rect.top + rect.height / 2 ? peer : peer.nextElementSibling;
				break;
			}

			insertBeforeRef = peer.nextElementSibling instanceof HTMLElement ? peer.nextElementSibling : null;
		}

		// すでにその位置にいるときは DOM を動かさない
		if (item.nextElementSibling === insertBeforeRef) {
			return;
		}

		// 末尾指定であり、かつすでにそのリストの末尾なら動かさない。どちらか欠けると挿入する
		if (insertBeforeRef === null && item.parentElement === listEl && item.nextElementSibling === null) {
			return;
		}

		// 別リストから来た要素は、そのリストへ移してから位置を決める
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
	 */
	_moveAppRow: function (row, clientX, clientY) {
		// ポインタ下のアプリ一覧。ドラッグ中の行自身は除外する
		const targetList = TMS_AL.RowDrag._elementFromPoint(clientX, clientY, row, '.tms-al-group__apps');

		// アプリ一覧の上に無いときは行を動かさない
		if (!(targetList instanceof HTMLElement)) {
			return;
		}

		// その一覧のグループ。閉じていればドロップできない
		const group = targetList.closest('.tms-al-group');

		// グループ要素でない、または開いていないときは行を入れない。どちらか一方で足りる
		if (!(group instanceof HTMLElement) || !group.classList.contains('tms-al-group--expanded')) {
			return;
		}

		TMS_AL.RowDrag._placeInList(targetList, row, clientY, '.tms-al-app-row');
	},

	/**
	 * @param {HTMLElement} group グループ
	 * @param {number} clientX X 座標
	 * @param {number} clientY Y 座標
	 */
	_moveGroup: function (group, clientX, clientY) {
		// ポインタ下のグループ一覧。ドラッグ中のグループ自身は除外する
		const targetList = TMS_AL.RowDrag._elementFromPoint(clientX, clientY, group, '.tms-al-group-list');

		// グループ一覧の上に無いときは動かさない
		if (!(targetList instanceof HTMLElement)) {
			return;
		}

		TMS_AL.RowDrag._placeInList(targetList, group, clientY, '.tms-al-group:not(.tms-al-group--fixed)');
	},

	/**
	 * @param {PointerEvent} event ポインターイベント
	 * @returns {Promise<void>}
	 */
	_onPointerUp: async function (event) {
		// 終了するドラッグ。無いときは後処理しない
		const state = TMS_AL.RowDrag._state;

		// ドラッグ中でない、または別ポインタの離上なら無視する。どちらか一方で足りる
		if (!state || event.pointerId !== state.pointerId) {
			return;
		}

		// このハンドルがポインタを掴んでいるときだけ解放する。掴んでいないと release が失敗する
		if (state.handle.hasPointerCapture(event.pointerId)) {
			state.handle.releasePointerCapture(event.pointerId);
		}

		TMS_AL.RowDrag._state = null;
		document.body.classList.remove('tms-al-body--dragging');
		state.element.classList.remove('tms-al-app-row--dragging', 'tms-al-group--dragging');

		// 閾値を超えていないときはクリックとして残し、順序は保存しない
		if (!state.moved) {
			return;
		}

		event.preventDefault();
		TMS_AL.RowDrag._suppressClick = true;

		try {
			await TMS_AL.ScreenMain.RecalculateOrdersFromDom();
		} catch (error) {
			TMS_AL.ComFnc.LogError('Failed to save row order after drag', {
				// 保存失敗のメッセージ。Error 以外は文字列化する
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
});

// ----------------------------------------------
// メイン画面
// ----------------------------------------------
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
	 */
	UpdateTitle: function (isAdministrator) {
		// 見出し要素。無いときは document.title だけ更新する
		const titleEl = document.getElementById('tmsAlTitle');
		// 表示するタイトル。管理者のときだけ接尾辞を付ける
		const title   = isAdministrator ? `${APP_TITLE}${ADMINISTRATOR_TITLE_SUFFIX}` : APP_TITLE;

		document.title = title;

		// 見出し要素があるときだけ画面上の文字とツールチップを合わせる
		if (titleEl) {
			titleEl.textContent = title;
			titleEl.title       = title;
		}
	},

	/**
	 * 自動更新の状態通知を処理する
	 * @param {import('../../main/types').UpdateStatusPayload} payload 通知内容
	 */
	HandleUpdateStatus: function (payload) {
		// 新しい版が見つかった通知
		if (payload.type === 'available') {
			// ポータブル版は自動ダウンロードせず、公式ページからの ZIP 取得を案内する
			if (payload.mode === 'portable') {
				TMS_AL_COMMON.Ui.ShowToast(`新しいバージョン v${payload.version} があります。公式ページからポータブル ZIP 版をダウンロードしてください。`, 'info');
				return;
			}

			TMS_AL_COMMON.Ui.ShowToast(`新しいバージョン v${payload.version} をダウンロードしています…`, 'info');
			return;
		}

		// 失敗以外の通知はここでは出さない
		if (payload.type !== 'error') {
			return;
		}

		// この通知を受けた時刻。単位はミリ秒。直近の同一エラーを潰す基準
		const now = Date.now();

		// 直前と同じ文言であり、かつ 5 秒未満の再送ならトーストを重ねない。どちらか欠けると表示する
		if (payload.message === TMS_AL.ScreenMain._lastUpdateErrorMessage && now - TMS_AL.ScreenMain._lastUpdateErrorAt < 5000) {
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
		// 設定上のペイン数。データ未読込や未設定は 1
		const count = TMS_AL.ScreenMain._data?.settings.paneCount ?? 1;

		return count === 2 || count === 3 ? count : 1;
	},

	/**
	 * 現在のビューポートで有効なペイン数を取得する
	 * @returns {1 | 2 | 3} ペイン数
	 */
	GetActivePaneCount: function () {
		// 設定上のペイン数。1、2、3 のいずれか
		const configured = TMS_AL.ScreenMain.GetConfiguredPaneCount();
		// ウィンドウ幅に入るペイン数。最小幅で割った整数。1 未満にはしない
		const maxByWidth = Math.max(1, Math.floor(window.innerWidth / TMS_AL.Const.PANE_MIN_WIDTH));

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
		// 中央ペインは専用の要素 ID。左と右は下で分ける
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
		// いま有効なペイン数。幅が足りないと設定より少なくなる
		const activeCount = TMS_AL.ScreenMain.GetActivePaneCount();

		// 3 ペイン以上のとき左、中央、右を使う
		if (activeCount >= 3) {
			return ['left', 'center', 'right'];
		}

		// 2 ペインのときは中央を飛ばして左と右
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
		// 表示中の保存データ。未読込ならすべて左へ寄せる
		const data = TMS_AL.ScreenMain._data;

		// 保存データが無いときは左ペイン
		if (!data) {
			return 'left';
		}

		// 未分類は専用の設定ペイン。未設定は左
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
		// 描画に使うリスト要素。DOM に無いペインは入れない
		const lists = [];

		// 有効なペイン名。幅が足りないペインは含まない
		for (const pane of TMS_AL.ScreenMain.GetActivePaneNames()) {
			// そのペインのリスト要素。無いときは描画対象から外す
			const el = document.getElementById(TMS_AL.ScreenMain.GetPaneElementId(pane));

			// 要素があるときだけ返す
			if (el) {
				lists.push(el);
			}
		}

		return lists;
	},

	/**
	 * ペインコンテナのレイアウトクラスを更新する
	 */
	UpdatePaneLayout: function () {
		// ペインを並べるコンテナ。無いときはクラスを切り替えられない
		const container   = document.getElementById('tmsAlPaneContainer');
		// 左ペインのリスト。1 ペインのときもこれを使う
		const leftEl      = document.getElementById('tmsAlGroupListLeft');
		// 中央ペイン。3 ペイン未満では隠す
		const centerEl    = document.getElementById('tmsAlGroupListCenter');
		// 右ペイン。2 ペイン未満では隠す
		const rightEl     = document.getElementById('tmsAlGroupListRight');
		// 幅を考慮した有効ペイン数
		const activeCount = TMS_AL.ScreenMain.GetActivePaneCount();
		// 支援技術へ出すペイン名。1 ペインのときはラベルを外す
		const paneLabels  = {
			// 左ペインのアクセシブル名
			left: '左ペイン',
			// 中央ペインのアクセシブル名
			center: '中央ペイン',
			// 右ペインのアクセシブル名
			right: '右ペイン'
		};

		// コンテナがあるときだけ、複数ペインか単一ペインかのクラスを切り替える
		if (container) {
			container.classList.toggle('tms-al-pane-container--multi', activeCount > 1);
			container.classList.toggle('tms-al-pane-container--single', activeCount === 1);
		}

		// 左ペインがあるときだけ表示とラベルを更新する。左は常に表示する
		if (leftEl) {
			leftEl.hidden = false;

			// 1 ペインのときはペイン名を読み上げない
			if (activeCount === 1) {
				leftEl.removeAttribute('aria-label');
			} else {
				leftEl.setAttribute('aria-label', paneLabels.left);
			}
		}

		// 中央ペインがあるときだけ、3 ペイン未満では隠す
		if (centerEl) {
			centerEl.hidden = activeCount < 3;

			// 3 ペイン以上のときだけ中央のラベルを付ける
			if (activeCount >= 3) {
				centerEl.setAttribute('aria-label', paneLabels.center);
			} else {
				centerEl.removeAttribute('aria-label');
			}
		}

		// 右ペインがあるときだけ、2 ペイン未満では隠す
		if (rightEl) {
			rightEl.hidden = activeCount < 2;

			// 2 ペイン以上のときだけ右のラベルを付ける
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
		// 保存データが無いときはグループを返さない
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
		// 表示中の保存データ。未読込なら選択肢は空
		const data = TMS_AL.ScreenMain._data;

		// 保存データが無いときは空配列
		if (!data) {
			return [];
		}

		// 未分類グループ。先頭に置く。無いときはその他だけ返す
		const uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();
		// 未分類以外。ペインと order で並べる
		const others        = data.groups.filter((group) => !group.isUncategorized);

		/**
		 * @param {import('../../main/types').LauncherGroup} a
		 * @param {import('../../main/types').LauncherGroup} b
		 * @returns {number}
		 */
		/**
		 * @param {import('../../main/types').LauncherGroup} a
		 * @param {import('../../main/types').LauncherGroup} b
		 * @returns {number}
		 */
		const compareByOrder = (a, b) => a.order - b.order;

		// プルダウンに出す未分類以外。複数ペインと単一ペインで並べ方が変わる
		let orderedOthers;

		// 複数ペインのときは、画面に出ている左・中央・右の順で並べる
		if (TMS_AL.ScreenMain.IsMultiPaneActive()) {
			// 左ペインのグループ。order 昇順
			const leftGroups   = others.filter((group) => TMS_AL.ScreenMain.GetGroupTargetPane(group) === 'left').sort(compareByOrder);
			// 中央ペインのグループ。order 昇順
			const centerGroups = others.filter((group) => TMS_AL.ScreenMain.GetGroupTargetPane(group) === 'center').sort(compareByOrder);
			// 右ペインのグループ。order 昇順
			const rightGroups  = others.filter((group) => TMS_AL.ScreenMain.GetGroupTargetPane(group) === 'right').sort(compareByOrder);

			orderedOthers = [...leftGroups, ...centerGroups, ...rightGroups];
		} else {
			// 単一ペインでも、設定上のペイン順を先に見る
			const paneOrder = {
				// 左を最先頭にする並び値
				left: 0,
				// 中央は左の次
				center: 1,
				// 右は最後
				right: 2
			};

			orderedOthers = [...others].sort((a, b) => {
				// 比較元のペイン。未設定は左
				const paneA = a.pane ?? 'left';
				// 比較先のペイン。未設定は左
				const paneB = b.pane ?? 'left';

				// ペインが違うときはペイン順を優先する
				if (paneA !== paneB) {
					return paneOrder[paneA] - paneOrder[paneB];
				}

				return compareByOrder(a, b);
			});
		}

		// 未分類があるときだけ先頭に置く
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
		// 保存データが無いときはアプリを返さない
		if (!TMS_AL.ScreenMain._data) {
			return [];
		}

		return TMS_AL.ScreenMain._data.apps.filter((app) => app.groupId === groupId).sort((a, b) => a.order - b.order);
	},

	/**
	 * グループ開閉状態をデータへ同期する
	 */
	SyncGroupExpandedStatesToData: function () {
		// 表示中の保存データ。未読込なら開閉状態を書き戻せない
		const data = TMS_AL.ScreenMain._data;

		// 保存データが無いときは何もしない
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
	 */
	InitGroupExpandedState: function (options) {
		// 表示中の保存データ。未読込なら開閉マップは空のまま
		const data             = TMS_AL.ScreenMain._data;
		// 保存済み開閉を捨てるか。true のとき初期値だけで作り直す
		const clearSaved       = options?.clearSaved === true;
		// 保存済みの開閉マップ。未設定は undefined
		const saved            = data?.settings.groupExpandedStates;
		// 捨てる指定でなく、かつ保存マップに 1 件以上あるときだけ保存値を使う。どちらか欠けると初期値
		const hasSaved         = !clearSaved && saved && Object.keys(saved).length > 0;
		// 初期値がすべて展開か。保存値が無いグループはこれに従う
		const fallbackExpanded = data?.settings.toggleInitialState === 'expandAll';

		TMS_AL.ScreenMain._groupExpanded = {};

		// 保存データが無いときは空マップのまま終わる
		if (!data) {
			return;
		}

		// 保存データ上のグループ。画面に無いグループの開閉は作らない
		for (const group of data.groups) {
			// 保存マップがあり、かつこのグループ ID のキーがあるときだけ保存値を使う。どちらか欠けると下の分岐
			if (hasSaved && Object.prototype.hasOwnProperty.call(saved, group.id)) {
				TMS_AL.ScreenMain._groupExpanded[group.id] = saved[group.id];
				// 保存マップはあるが、このグループのキーが無いときは開いた扱いにする
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
		// 保存データが無いときは保存しない
		if (!TMS_AL.ScreenMain._data) {
			return false;
		}

		// 待機中の保存があるときだけ取り消す。即時保存でもデバウンスを潰す
		if (TMS_AL.ScreenMain._saveTimer) {
			clearTimeout(TMS_AL.ScreenMain._saveTimer);
			TMS_AL.ScreenMain._saveTimer = null;
		}

		/**
		 *
		 */
		const doSave = async () => {
			// 保存 API の結果。失敗時は error に理由が入る
			const result = await window.launcherApi.saveData(TMS_AL.ScreenMain._data);

			// 保存できなかったときは理由を出して false
			if (!result.success) {
				TMS_AL_COMMON.Ui.ShowToast(`保存に失敗しました: ${result.error ?? ''}`, 'error');
				return false;
			}

			return true;
		};

		// 即時指定のときは待たずに保存する
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
	 */
	ApplyRunningApps: function (payload) {
		// 起動中アプリ ID。配列でない、または文字列以外は捨てる
		const appIds = Array.isArray(payload?.appIds) ? payload.appIds.filter((id) => typeof id === 'string') : [];

		TMS_AL.ScreenMain._runningAppIds = new Set(appIds);

		document.querySelectorAll('.tms-al-app-row').forEach((rowEl) => {
			// 行のアプリ ID。属性が無いときは空文字で、起動中には一致しない
			const appId   = rowEl.getAttribute('data-app-id') ?? '';
			// その ID が起動中か
			const running = TMS_AL.ScreenMain._runningAppIds.has(appId);
			// 起動中ドット。無い行はクラスだけ切り替える
			const stateEl = rowEl.querySelector('.tms-al-app-row__running-state');

			rowEl.classList.toggle('tms-al-app-row--running', running);

			// ドット要素があるときだけ、起動中でなければ隠す
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
		// 表示中の保存データ。未読込なら検索結果は空
		const data = TMS_AL.ScreenMain._data;

		// 保存データが無いときは空配列
		if (!data) {
			return [];
		}

		// アプリ ID からアプリを引く表。DOM 行の ID が未知なら結果に入れない
		const appsById   = new Map(data.apps.map((app) => [app.id, app]));
		// グループ ID からグループを引く表。未知の所属は未分類名で表示する
		const groupsById = new Map(data.groups.map((group) => [group.id, group]));
		// 名前かファイル名が連続部分一致した行。DOM 順
		const partial    = [];
		// 文字の出現だけでは一致した行。部分一致の後ろに置く
		const other      = [];

		document.querySelectorAll('.tms-al-app-row').forEach((rowEl) => {
			// 行のアプリ ID。属性が無いときは空文字
			const appId = rowEl.getAttribute('data-app-id') ?? '';
			// その ID のアプリ。保存データに無い行は検索しない
			const app   = appsById.get(appId);

			// アプリが無い、または名前とファイル名のどちらも文字数が足りないときは結果に入れない。どちらか一方で足りる
			if (!app || !TMS_AL.Search.MatchesApp(app.name, app.path, query)) {
				return;
			}

			// 所属グループ。削除済み ID のときは名前を未分類にする
			const group        = groupsById.get(app.groupId);
			// 表示するグループ名。グループが無いときは未分類
			const groupName    = group?.name ?? TMS_AL_COMMON.Const.UNCATEGORIZED_NAME;
			// 実行パスのファイル名。パスが空なら空文字で、名前側だけが検索対象
			const pathFileName = TMS_AL.Search.GetPathFileName(app.path);
			// 1 件の検索結果。仕切り行ではない
			const item         = {
				// 起動とプレビューに使うアプリ ID
				appId: app.id,
				// プレビューで開くグループ ID
				groupId: app.groupId,
				// 結果行の先頭に出すグループ名
				groupName: groupName,
				// 強調対象のアプリ名
				appName: app.name,
				// ツールチップに出す実行パス。空ならパス行を出さない
				path: app.path,
				// 結果の 2 行目に出すファイル名。空なら出さない
				pathFileName: pathFileName,
				// 読み上げとツールチップ用のラベル
				label: `${groupName}：${app.name}`
			};

			// 名前かファイル名が連続部分一致するときは上段へ入れる
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
		// いまの検索結果。仕切りを含む
		const results = TMS_AL.ScreenMain._searchResults;
		// 結果件数。0 のときは選択できない
		const count   = results.length;

		// 結果が無いときは未選択
		if (count === 0) {
			return -1;
		}

		// 走査を始めるインデックス。未選択は -1
		let index = start;

		// 未選択から動くときは、下なら先頭、上なら末尾から始める
		if (index < 0) {
			index = delta > 0 ? 0 : count - 1;
		} else {
			index = (index + delta + count) % count;
		}

		// 仕切りを飛ばした回数。全件見ても選択できる行が無ければ未選択
		for (let step = 0; step < count; step += 1) {
			// 仕切りでない行ならそこを選択位置にする
			if (TMS_AL.ScreenMain.IsSearchResultSelectable(results[index])) {
				return index;
			}

			index = (index + delta + count) % count;
		}

		return -1;
	},

	/** 検索プレビューだけを解除する */
	ClearSearchPreview: function () {
		// プレビュー中のアプリ行があるときだけ強調を外す
		if (TMS_AL.ScreenMain._searchPreviewAppId) {
			// 強調中のアプリ行。DOM から消えていれば何もしない
			const rowEl = document.querySelector(`.tms-al-app-row[data-app-id="${TMS_AL.ScreenMain._searchPreviewAppId}"]`);

			rowEl?.classList.remove('tms-al-app-row--search-preview');
		}

		// プレビューで開いたグループであり、かつ本来は閉じているときだけ閉じ戻す。どちらか欠けると開いたまま
		if (TMS_AL.ScreenMain._searchPreviewGroupId && !TMS_AL.ScreenMain._groupExpanded[TMS_AL.ScreenMain._searchPreviewGroupId]) {
			// 一時的に開いたグループ。DOM に無ければ閉じ戻せない
			const groupEl = document.querySelector(`.tms-al-group[data-group-id="${TMS_AL.ScreenMain._searchPreviewGroupId}"]`);

			groupEl?.classList.remove('tms-al-group--expanded');

			// 開閉アイコン。グループが無いときは更新しない
			const iconEl = groupEl?.querySelector('.tms-al-group__toggle-icon');

			// アイコンがあるときだけ閉じた印へ戻す
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
	 */
	SelectSearchResult: function (index) {
		// 検索結果リスト。無いときは選択表示を更新できない
		const resultsEl = document.getElementById('tmsAlSearchResults');
		// 検索入力。無いときはアクティブ子孫を更新できない
		const inputEl   = document.getElementById('tmsAlSearchInput');

		TMS_AL.ScreenMain.ClearSearchPreview();

		// 範囲外、または仕切りのときは選択を解除する。インデックスが範囲外なら選択可能判定の前に切れる
		if (index < 0 || index >= TMS_AL.ScreenMain._searchResults.length || !TMS_AL.ScreenMain.IsSearchResultSelectable(TMS_AL.ScreenMain._searchResults[index])) {
			TMS_AL.ScreenMain._searchSelectedIndex = -1;
			resultsEl?.querySelectorAll('[role="option"]').forEach((option) => {
				option.setAttribute('aria-selected', 'false');
			});

			// 入力欄があるときだけアクティブ子孫を外す
			if (inputEl) {
				inputEl.removeAttribute('aria-activedescendant');
			}
			return;
		}

		// 選択する検索結果。上の条件で仕切りは除外済み
		const result  = TMS_AL.ScreenMain._searchResults[index];
		// プレビューで開くグループ。DOM に無ければ開閉だけスキップする
		const groupEl = document.querySelector(`.tms-al-group[data-group-id="${result.groupId}"]`);
		// 強調するアプリ行。DOM に無ければスクロールしない
		const rowEl   = document.querySelector(`.tms-al-app-row[data-app-id="${result.appId}"]`);

		TMS_AL.ScreenMain._searchSelectedIndex  = index;
		TMS_AL.ScreenMain._searchPreviewAppId   = result.appId;
		TMS_AL.ScreenMain._searchPreviewGroupId = result.groupId;

		// グループが DOM にあるときだけ開き、アイコンを展開にする
		if (groupEl) {
			groupEl.classList.add('tms-al-group--expanded');
			// 開閉アイコン。無いときは印を変えない
			const iconEl = groupEl.querySelector('.tms-al-group__toggle-icon');

			// アイコンがあるときだけ展開の印にする
			if (iconEl) {
				iconEl.textContent = '▼';
			}
		}

		rowEl?.classList.add('tms-al-app-row--search-preview');
		rowEl?.scrollIntoView({
			// プレビュー先をなめらかに見せる
			behavior: 'smooth',
			// 見えていればスクロール量を最小にする
			block: 'nearest'
		});

		resultsEl?.querySelectorAll('[role="option"]').forEach((option) => {
			// オプション ID から取り出したインデックス。ID 形式が違うときは NaN で未選択になる
			const optionIndex = Number(option.id.replace('tmsAlSearchOption', ''));

			option.setAttribute('aria-selected', optionIndex === index ? 'true' : 'false');
		});

		// 選択中オプション。DOM に無ければスクロールもアクティブ子孫も更新しない
		const selectedOption = document.getElementById(`tmsAlSearchOption${index}`);
		selectedOption?.scrollIntoView({
			// 結果リスト内で、見えていれば大きく動かさない
			block: 'nearest'
		});

		// 入力欄と選択オプションが両方あるときだけ、アクティブ子孫をその ID にする。どちらか欠けると更新しない
		if (inputEl && selectedOption) {
			inputEl.setAttribute('aria-activedescendant', selectedOption.id);
		}
	},

	/**
	 * 検索ハイライト付きのテキストを要素へ追加する
	 * @param {HTMLElement} parentEl 追加先要素
	 * @param {string} text 表示文字列
	 * @param {string} query 検索文字列
	 */
	AppendHighlightedSearchText: function (parentEl, text, query) {
		// 強調計算が返した区間。強調しない区間と mark を交互に足す
		for (const part of TMS_AL.Search.BuildHighlightParts(text, query)) {
			// 強調しない区間はテキストノードのまま足す
			if (!part.highlight) {
				parentEl.appendChild(document.createTextNode(part.text));
				continue;
			}

			// 強調区間の mark。連続一致と 1 文字一致でクラスを分ける
			const markEl       = document.createElement('mark');
			markEl.className   = 'tms-al-search__highlight';
			markEl.textContent = part.text;

			// 連続ではない 1 文字一致のときだけ薄い強調クラスを足す
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
		// 1 件の検索結果オプション
		const optionEl = document.createElement('div');
		// ツールチップ。パスがあるときだけ改行してパスを足す
		const title    = result.path ? `${result.label}\n${result.path}` : result.label;

		optionEl.id        = `tmsAlSearchOption${index}`;
		optionEl.className = 'tms-al-search__option';
		optionEl.title     = title;
		optionEl.setAttribute('role', 'option');
		optionEl.setAttribute('aria-selected', 'false');
		optionEl.setAttribute('aria-label', result.pathFileName ? `${result.label} ${result.pathFileName}` : result.label);

		// グループ名とアプリ名の行
		const primaryLineEl = document.createElement('div');
		// グループ名。アプリ名だけを強調対象にするため分ける
		const groupNameEl   = document.createElement('span');

		primaryLineEl.className = 'tms-al-search__option-line tms-al-search__option-line--primary';
		groupNameEl.className   = 'tms-al-search__group-name';
		groupNameEl.textContent = `${result.groupName}：`;
		primaryLineEl.appendChild(groupNameEl);
		TMS_AL.ScreenMain.AppendHighlightedSearchText(primaryLineEl, result.appName, query);
		optionEl.appendChild(primaryLineEl);

		// ファイル名があるときだけ 2 行目を出す。空ならパス行は作らない
		if (result.pathFileName) {
			// ファイル名の行。ツールチップにはフルパスを出す
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
	 */
	UpdateSearchResults: function () {
		// 検索入力。input でないときは結果を更新できない
		const inputEl   = document.getElementById('tmsAlSearchInput');
		// 結果リスト。無いときは描画できない
		const resultsEl = document.getElementById('tmsAlSearchResults');

		// 入力が input でない、または結果リストが無いときは何もしない。どちらか一方で足りる
		if (!(inputEl instanceof HTMLInputElement) || !resultsEl) {
			return;
		}

		TMS_AL.ScreenMain.ClearSearchPreview();
		TMS_AL.ScreenMain._searchSelectedIndex = -1;
		resultsEl.innerHTML                    = '';

		// 空白を除くと検索文字列が空なら、結果を閉じて選択も消す
		if (!TMS_AL.Search.Normalize(inputEl.value)) {
			TMS_AL.ScreenMain._searchResults = [];
			resultsEl.hidden                 = true;
			inputEl.setAttribute('aria-expanded', 'false');
			inputEl.removeAttribute('aria-activedescendant');
			return;
		}

		TMS_AL.ScreenMain._searchResults = TMS_AL.ScreenMain.BuildSearchResults(inputEl.value);

		// 一致が 0 件のときは空メッセージだけ出す
		if (TMS_AL.ScreenMain._searchResults.length === 0) {
			// 該当なしの表示。選択はできない
			const emptyEl       = document.createElement('div');
			emptyEl.className   = 'tms-al-search__empty';
			emptyEl.textContent = '該当するアプリはありません';
			resultsEl.appendChild(emptyEl);
		} else {
			TMS_AL.ScreenMain._searchResults.forEach((result, index) => {
				// 仕切りはアプリ行にせず、選択できない区切りだけ出す
				if (result.type === 'separator') {
					// 部分一致と文字一致の境目
					const separatorEl     = document.createElement('div');
					separatorEl.className = 'tms-al-search__separator';
					separatorEl.setAttribute('role', 'separator');
					resultsEl.appendChild(separatorEl);
					return;
				}

				resultsEl.appendChild(TMS_AL.ScreenMain.CreateSearchOptionElement(result, index, inputEl.value));
			});
		}

		resultsEl.hidden = false;
		inputEl.setAttribute('aria-expanded', 'true');
	},

	/** 検索条件・結果・プレビューをクリアする */
	ClearSearch: function () {
		// 検索入力。input のときだけ文字と aria を消す
		const inputEl   = document.getElementById('tmsAlSearchInput');
		// 結果リスト。無いときは非表示にできない
		const resultsEl = document.getElementById('tmsAlSearchResults');

		TMS_AL.ScreenMain.ClearSearchPreview();
		TMS_AL.ScreenMain._searchResults       = [];
		TMS_AL.ScreenMain._searchSelectedIndex = -1;

		// 入力が input のときだけ文字と展開状態を消す
		if (inputEl instanceof HTMLInputElement) {
			inputEl.value = '';
			inputEl.setAttribute('aria-expanded', 'false');
			inputEl.removeAttribute('aria-activedescendant');
		}

		// 結果リストがあるときだけ中身を消して隠す
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
		return [...document.querySelectorAll('.tms-al-modal')].some((modal) => modal instanceof HTMLElement && !modal.hidden);
	},

	/**
	 * アプリ検索入力へフォーカスする
	 */
	FocusSearchInput: function () {
		// モーダルが開いている、またはウィンドウがフォーカスされていないときは検索へ移さない。どちらか一方で足りる
		if (TMS_AL.ScreenMain.HasOpenModal() || !document.body.classList.contains(TMS_AL.Const.WINDOW_FOCUSED_CLASS)) {
			return;
		}

		// 検索入力。input でない、または無効ならフォーカスしない
		const inputEl = document.getElementById('tmsAlSearchInput');

		// 入力欄であり、かつ無効でないときだけフォーカスする。どちらか欠けると移さない
		if (inputEl instanceof HTMLInputElement && !inputEl.disabled) {
			inputEl.focus({
				// 検索欄へ移しても一覧のスクロール位置は変えない
				preventScroll: true
			});
		}
	},

	/**
	 * ウィンドウフォーカス変更時の画面操作を処理する
	 * @param {boolean} focused フォーカス中なら true
	 */
	HandleWindowFocusChanged: function (focused) {
		// フォーカスを失ったときは検索へ移さない
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
	 */
	HandleGlobalKeyDown: function (event) {
		// Escape でない、またはモーダルが開いているときは検索クリアに使わない。どちらか一方で足りる
		if (event.key !== 'Escape' || TMS_AL.ScreenMain.HasOpenModal()) {
			return;
		}

		// 検索入力。input でない、またはフォーカス中ならこのグローバル処理はしない
		const inputEl   = document.getElementById('tmsAlSearchInput');
		// 結果リスト。無い、または隠れているときはクリア対象が無いことがある
		const resultsEl = document.getElementById('tmsAlSearchResults');

		// 入力が input でない、またはすでに検索欄が対象なら何もしない。どちらか一方で足りる
		if (!(inputEl instanceof HTMLInputElement) || event.target === inputEl) {
			return;
		}

		// 入力が空であり、かつ結果が無い、または隠れているときは消すものがない。入力が残っているか結果が見えていればクリアする
		if (!inputEl.value && (!resultsEl || resultsEl.hidden)) {
			return;
		}

		event.preventDefault();
		TMS_AL.ScreenMain.ClearSearch();
	},

	/**
	 * 検索ボックスのキー操作を処理する
	 * @param {KeyboardEvent} event キーイベント
	 */
	HandleSearchKeyDown: function (event) {
		// Escape は検索条件と結果とプレビューを消す
		if (event.key === 'Escape') {
			event.preventDefault();
			TMS_AL.ScreenMain.ClearSearch();
			return;
		}

		// 結果件数。0 のときは矢印も Enter も移動先が無い
		const count = TMS_AL.ScreenMain._searchResults.length;

		// 結果が無いときはキーで選択しない
		if (count === 0) {
			return;
		}

		// 下または上の矢印のときだけ選択を動かす。どちらか一方で足りる
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			// 下は +1、上は -1。仕切りは FindNext が飛ばす
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			// 次に選択できるインデックス。見つからなければ -1
			const next  = TMS_AL.ScreenMain.FindNextSearchResultIndex(TMS_AL.ScreenMain._searchSelectedIndex, delta);

			TMS_AL.ScreenMain.SelectSearchResult(next);
			return;
		}

		// Enter であり、かつ何か選択されているときだけ起動する。未選択の Enter は何もしない
		if (event.key === 'Enter' && TMS_AL.ScreenMain._searchSelectedIndex >= 0) {
			event.preventDefault();
			// 選択中の結果。仕切りなら起動しない
			const result = TMS_AL.ScreenMain._searchResults[TMS_AL.ScreenMain._searchSelectedIndex];

			// 仕切りは起動できない
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
		// 表示中の保存データ。未読込なら順序を書き戻せない
		const data    = TMS_AL.ScreenMain._data;
		// 有効なグループリスト。幅で隠れているペインは含まない
		const listEls = TMS_AL.ScreenMain.GetActiveGroupListElements();

		// 保存データが無い、またはリストが 0 件なら保存しない。どちらか一方で足りる
		if (!data || listEls.length === 0) {
			return;
		}

		// 複数ペインのときだけ、ドロップ先のペインをグループへ書き戻す
		const multiPane = TMS_AL.ScreenMain.IsMultiPaneActive();

		// 有効なペインのリスト要素
		for (const listEl of listEls) {
			// このリストのペイン名。属性が無いときは左として書く
			const pane     = listEl.getAttribute('data-pane') ?? 'left';
			// そのペインに並んでいるグループ。DOM 順が新しい order
			const groupEls = listEl.querySelectorAll('.tms-al-group');

			groupEls.forEach((groupEl, groupIndex) => {
				// グループ ID。属性が無い行は保存データと一致しない
				const groupId = groupEl.getAttribute('data-group-id');
				// 対応する保存データ。未知 ID は飛ばす
				const group   = data.groups.find((g) => g.id === groupId);

				// グループが無い、または未分類は並びとペインをここで変えない。どちらか一方で足りる
				if (!group || group.isUncategorized) {
					return;
				}

				group.order = groupIndex;

				// 複数ペインのときだけ、いま入っているペインを保存する
				if (multiPane) {
					group.pane = /** @type {'left' | 'center' | 'right'} */ (pane);
				}
			});
		}

		// 未分類グループ。あるときだけ order を末尾固定にする
		const uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();

		// 未分類があるときだけ並びを固定値にする。ドラッグでは動かさない
		if (uncategorized) {
			uncategorized.order = 9999;
		}

		// ----------------------------------------------
		// アプリ行の所属と order を DOM 順で書き戻す
		for (const listEl of listEls) {
			// そのリスト内のグループ
			const groupEls = listEl.querySelectorAll('.tms-al-group');

			groupEls.forEach((groupEl) => {
				// 行の新しい所属グループ ID。属性が無いときは既存の所属を残す
				const groupId = groupEl.getAttribute('data-group-id');
				// グループ内のアプリ行。DOM 順が新しい order
				const rows    = groupEl.querySelectorAll('.tms-al-app-row');

				rows.forEach((rowEl, rowIndex) => {
					// アプリ ID。属性が無い行は保存データと一致しない
					const appId = rowEl.getAttribute('data-app-id');
					// 対応するアプリ。未知 ID は飛ばす
					const app   = data.apps.find((item) => item.id === appId);

					// アプリが残っているときだけ所属と順序を書き換える
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
		// アイコン画像。img でないときは読み込まない
		const imgEl      = rowEl.querySelector('.tms-al-app-row__icon');
		// 画像が無いときの代替。要素でないときは切り替えられない
		const fallbackEl = rowEl.querySelector('.tms-al-app-row__icon--fallback');

		// 画像か代替が要素でないとアイコンを出せない。どちらか欠けると何もしない
		if (!(imgEl instanceof HTMLImageElement) || !(fallbackEl instanceof HTMLElement)) {
			return;
		}

		// 表示に使うパス。カスタム指定があり、かつパスがあるときだけ実行パスの代わりに使う
		const iconPath = app.iconMode === 'custom' && app.customIconPath ? app.customIconPath : app.path;

		// パスが空なら既定の代替表示のままにする
		if (TMS_AL_COMMON.Funcs.IsEmpty(iconPath)) {
			return;
		}

		// 取得した data URL。取れないときは代替表示のまま
		const dataUrl = await window.launcherApi.getIcon(iconPath);

		// data URL があるときだけ画像を出して代替を隠す
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
		// パス警告の印。要素でないときは表示を切り替えられない
		const warnEl = rowEl.querySelector('.tms-al-app-row__warn');

		// 警告要素が無いときは何もしない
		if (!(warnEl instanceof HTMLElement)) {
			return;
		}

		// 実行ファイルとして妥当か。不正なら存在確認はしない
		const valid  = await window.launcherApi.isValidExecutablePath(filePath);
		// パスが存在するか。妥当でないときは false で警告を出す
		const exists = valid ? await window.launcherApi.pathExists(filePath) : false;

		warnEl.hidden = valid && exists;
	},

	/**
	 * アプリ行 DOM を生成する
	 * @param {import('../../main/types').LauncherApp} app アプリ
	 * @returns {HTMLElement} 行要素
	 */
	CreateAppRowElement: function (app) {
		// アプリ 1 行の要素
		const rowEl     = document.createElement('div');
		// 行に出すファイル名。フルパスはツールチップ側
		const pathLabel = TMS_AL_COMMON.Funcs.GetPathBasename(app.path);

		rowEl.className = `tms-al-app-row${TMS_AL.ScreenMain._runningAppIds.has(app.id) ? ' tms-al-app-row--running' : ''}`;
		rowEl.setAttribute('data-app-id', app.id);

		rowEl.innerHTML = ['<span class="tms-al-app-row__drag" title="ドラッグで並べ替え">⠿</span>', '<span class="tms-al-app-row__icon-wrap">', '<img class="tms-al-app-row__icon" alt="" hidden>', '<span class="tms-al-app-row__icon tms-al-app-row__icon--fallback">📄</span>', '</span>', `<a class="tms-al-app-row__name tms-al-app-row__name-link" href="#" title="${TMS_AL_COMMON.Funcs.EscapeHtml(app.name)}">${TMS_AL_COMMON.Funcs.EscapeHtml(app.name)}</a>`, `<span class="tms-al-app-row__path" title="${TMS_AL_COMMON.Funcs.EscapeHtml(app.path)}">${TMS_AL_COMMON.Funcs.EscapeHtml(pathLabel)}</span>`, `<span class="tms-al-app-row__running-state" title="起動中" aria-label="起動中"${TMS_AL.ScreenMain._runningAppIds.has(app.id) ? '' : ' hidden'}></span>`, '<span class="tms-al-app-row__warn" title="パスが存在しません" hidden>⚠</span>', '<span class="tms-al-app-row__actions">', '<button class="tms-al-btn tms-al-btn--small" type="button" data-action="edit">編集</button>', '<button class="tms-al-btn tms-al-btn--small tms-al-btn--danger" type="button" data-action="delete">削除</button>', '</span>'].join('');

		// アプリ名のリンク。a でないときは起動クリックを付けない
		const nameLink = rowEl.querySelector('.tms-al-app-row__name-link');
		// フォールバックではないアイコン画像。img のときだけクリックで起動する
		const iconImg  = rowEl.querySelector('.tms-al-app-row__icon:not(.tms-al-app-row__icon--fallback)');

		rowEl.addEventListener('contextmenu', (event) => {
			TMS_AL.ScreenMain.OpenAppContextMenu(app.id, event);
		});

		// 名前リンクが a のときだけ、遷移せず起動する
		if (nameLink instanceof HTMLAnchorElement) {
			nameLink.addEventListener('click', (event) => {
				event.preventDefault();
				TMS_AL.ScreenMain.LaunchApp(app.id);
			});
		}

		// アイコン画像のときだけ、クリックで起動する
		if (iconImg instanceof HTMLImageElement) {
			iconImg.style.cursor = 'pointer';
			iconImg.addEventListener('click', () => {
				TMS_AL.ScreenMain.LaunchApp(app.id);
			});
		}

		// 編集ボタン。無い行は編集を開けない
		const editBtn = rowEl.querySelector('[data-action="edit"]');

		// 編集ボタンがあるときだけ編集モーダルを開く
		if (editBtn) {
			editBtn.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.OpenEdit(app.id);
			});
		}

		// 削除ボタン。無い行は削除できない
		const deleteBtn = rowEl.querySelector('[data-action="delete"]');

		// 削除ボタンがあるときだけ削除確認を出す
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
		// このグループを開いて描くか。未記録のときは開く
		const isExpanded = TMS_AL.ScreenMain._groupExpanded[group.id] ?? true;
		// グループ内アプリ。order 昇順
		const apps       = TMS_AL.ScreenMain.GetAppsForGroup(group.id);
		// グループ 1 件の要素
		const groupEl    = document.createElement('section');

		groupEl.className = `tms-al-group${isExpanded ? ' tms-al-group--expanded' : ''}${group.isUncategorized ? ' tms-al-group--fixed' : ''}`;
		groupEl.setAttribute('data-group-id', group.id);
		groupEl.setAttribute('role', 'listitem');

		// 未分類はドラッグできない空き。それ以外は並べ替えハンドル
		const dragHandle = group.isUncategorized ? '<span class="tms-al-group__toggle"></span>' : '<span class="tms-al-group__drag-handle tms-al-group__toggle" title="ドラッグで並べ替え">⠿</span>';

		// このグループへアプリを足すボタン。未分類でも出す
		const addAppButton = '<button class="tms-al-btn tms-al-btn--small" type="button" data-action="add-app" title="アプリを追加" aria-label="アプリを追加">＋</button>';
		// 追加、改名、削除。未分類は追加だけ
		const groupActions = ['<span class="tms-al-group__actions">', addAppButton, group.isUncategorized ? '' : '<button class="tms-al-btn tms-al-btn--small" type="button" data-action="rename">改名</button>', group.isUncategorized ? '' : '<button class="tms-al-btn tms-al-btn--small tms-al-btn--danger" type="button" data-action="delete">削除</button>', '</span>'].join('');

		// 開閉の印。開いているときは下向き
		const toggleIcon = isExpanded ? '▼' : '▶';

		groupEl.innerHTML = ['<div class="tms-al-group__header">', dragHandle, `<span class="tms-al-group__toggle-icon">${toggleIcon}</span>`, `<span class="tms-al-group__name">${TMS_AL_COMMON.Funcs.EscapeHtml(group.name)}</span>`, `<span class="tms-al-group__count">(${apps.length})</span>`, groupActions, '</div>', '<div class="tms-al-group__apps"></div>'].join('');

		// 見出し。無いときは開閉クリックを付けない
		const headerEl = groupEl.querySelector('.tms-al-group__header');
		// アプリ行の入れ物。無いときは行を足せない
		const appsEl   = groupEl.querySelector('.tms-al-group__apps');

		// 見出しがあるときだけ、ボタンとハンドル以外のクリックで開閉する
		if (headerEl) {
			headerEl.addEventListener('click', (event) => {
				// ドラッグ直後の click は開閉にしない
				if (TMS_AL.RowDrag.ConsumeClick()) {
					return;
				}

				// クリック対象が要素でないときは開閉しない
				if (!(event.target instanceof HTMLElement)) {
					return;
				}

				// ボタンかドラッグハンドル上のクリックは開閉にしない
				if (event.target.closest('button, .tms-al-group__drag-handle')) {
					return;
				}

				TMS_AL.ScreenMain.ToggleGroup(group.id);
			});
		}

		// 追加ボタン。無いグループはここから新規登録を開けない
		const addAppBtn = groupEl.querySelector('[data-action="add-app"]');

		// 追加ボタンがあるときだけ、そのグループを選んで新規モーダルを開く
		if (addAppBtn) {
			addAppBtn.addEventListener('click', (event) => {
				event.stopPropagation();
				TMS_AL.ScreenModalEdit.OpenNew(group.id);
			});
		}

		// 改名ボタン。未分類には無い
		const renameBtn = groupEl.querySelector('[data-action="rename"]');

		// 改名ボタンがあるときだけ名前の入力を開く
		if (renameBtn) {
			renameBtn.addEventListener('click', (event) => {
				event.stopPropagation();
				TMS_AL.ScreenMain.RenameGroup(group.id);
			});
		}

		// 削除ボタン。未分類には無い
		const deleteBtn = groupEl.querySelector('[data-action="delete"]');

		// 削除ボタンがあるときだけグループ削除を確認する
		if (deleteBtn) {
			deleteBtn.addEventListener('click', (event) => {
				event.stopPropagation();
				TMS_AL.ScreenMain.DeleteGroup(group.id);
			});
		}

		// アプリ一覧の要素があるときだけ行を足す
		if (appsEl) {
			// このグループのアプリ。order 昇順
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
		// 左ペイン。無いと一覧を描けない
		const leftEl   = document.getElementById('tmsAlGroupListLeft');
		// 中央ペイン。無いときは 3 ペインでも中央をスキップする
		const centerEl = document.getElementById('tmsAlGroupListCenter');
		// 右ペイン。無いときは右をスキップする
		const rightEl  = document.getElementById('tmsAlGroupListRight');
		// アプリが 0 件のときの案内。無いときは出し分けできない
		const emptyEl  = document.getElementById('tmsAlEmptyMessage');
		// 表示中の保存データ。未読込なら描画しない
		const data     = TMS_AL.ScreenMain._data;

		// 左ペインか保存データが無いと描画できない。どちらか欠けると何もしない
		if (!leftEl || !data) {
			return;
		}

		TMS_AL.ScreenMain.UpdatePaneLayout();

		leftEl.innerHTML = '';

		// 中央ペインがあるときだけ中身を消す
		if (centerEl) {
			centerEl.innerHTML = '';
		}

		// 右ペインがあるときだけ中身を消す
		if (rightEl) {
			rightEl.innerHTML = '';
		}

		// 幅を考慮した有効ペイン数
		const activePaneCount = TMS_AL.ScreenMain.GetActivePaneCount();
		// order 昇順のグループ。ペイン振り分けは下で行う
		const groups          = TMS_AL.ScreenMain.GetSortedGroups();

		/**
		 * @param {import('../../main/types').LauncherGroup} a
		 * @param {import('../../main/types').LauncherGroup} b
		 * @returns {number}
		 */
		const compareGroupOrder = (a, b) => {
			// 未分類は常に後ろ
			if (a.isUncategorized) {
				return 1;
			}

			// 比較先が未分類なら、比較元を前にする
			if (b.isUncategorized) {
				return -1;
			}

			return a.order - b.order;
		};

		// 複数ペインのときはペインごとにグループを分ける
		if (activePaneCount > 1) {
			// ペイン名からリスト要素。中央や右が DOM に無いときは null
			const paneElements = {
				// 左ペインのリスト。必ずある前提で上を通過している
				left: leftEl,
				// 中央ペイン。無いときは null
				center: centerEl,
				// 右ペイン。無いときは null
				right: rightEl
			};

			// 有効なペイン名。幅が足りないペインは含まない
			for (const pane of TMS_AL.ScreenMain.GetActivePaneNames()) {
				// そのペインのリスト。DOM に無ければそのペインは描かない
				const listEl = paneElements[pane];

				// リストが無いペインは飛ばす
				if (!listEl) {
					continue;
				}

				// そのペインへ出すグループ。未分類は compare で末尾
				const paneGroups = groups.filter((group) => TMS_AL.ScreenMain.GetGroupTargetPane(group) === pane).sort(compareGroupOrder);

				// そのペインのグループ
				for (const group of paneGroups) {
					listEl.appendChild(TMS_AL.ScreenMain.CreateGroupElement(group));
				}
			}
		} else {
			// 1 ペインのときは左へ、設定上のペイン順と order で全部出す
			const singlePaneGroups = [...groups].sort((a, b) => {
				// 未分類は末尾
				if (a.isUncategorized) {
					return 1;
				}

				// 比較先が未分類なら比較元を前にする
				if (b.isUncategorized) {
					return -1;
				}

				// 単一表示でも設定上のペイン順を先に使う
				const paneOrder = {
					// 左を最先頭にする並び値
					left: 0,
					// 中央は左の次
					center: 1,
					// 右は最後
					right: 2
				};
				// 比較元のペイン。未設定は左
				const paneA     = a.pane ?? 'left';
				// 比較先のペイン。未設定は左
				const paneB     = b.pane ?? 'left';

				// ペインが違うときはペイン順を優先する
				if (paneA !== paneB) {
					return paneOrder[paneA] - paneOrder[paneB];
				}

				return a.order - b.order;
			});

			// 左ペインへ出すグループ
			for (const group of singlePaneGroups) {
				leftEl.appendChild(TMS_AL.ScreenMain.CreateGroupElement(group));
			}
		}

		// 空メッセージがあるときだけ、アプリ 0 件なら表示する
		if (emptyEl) {
			emptyEl.hidden = data.apps.length > 0;
		}

		TMS_AL.ScreenMain._lastActivePaneCount = activePaneCount;
		TMS_AL.ScreenMain.ApplyRunningApps({
			// いま起動中と覚えているアプリ ID。描画直後の行へドットを戻す
			appIds: [...TMS_AL.ScreenMain._runningAppIds]
		});

		// 検索欄。文字が残っているときだけ結果を描き直す
		const searchInput = document.getElementById('tmsAlSearchInput');

		// 入力欄であり、かつ検索文字が残っているときだけ結果を更新する。どちらか欠けると結果は閉じたまま
		if (searchInput instanceof HTMLInputElement && searchInput.value) {
			TMS_AL.ScreenMain.UpdateSearchResults();
		}
	},

	/**
	 * グループ開閉を切り替える
	 * @param {string} groupId グループID
	 */
	ToggleGroup: function (groupId) {
		TMS_AL.ScreenMain._groupExpanded[groupId] = !TMS_AL.ScreenMain._groupExpanded[groupId];

		// 開閉するグループ。DOM に無ければ印も更新しない
		const groupEl = document.querySelector(`.tms-al-group[data-group-id="${groupId}"]`);

		// グループ要素が無いときは保存だけ後で行うため、ここで描画更新をやめる
		if (!groupEl) {
			return;
		}

		// 切り替え後に開いているか
		const expanded = TMS_AL.ScreenMain._groupExpanded[groupId];
		// 開閉アイコン。無いときは印を変えない
		const iconEl   = groupEl.querySelector('.tms-al-group__toggle-icon');

		groupEl.classList.toggle('tms-al-group--expanded', expanded);

		// アイコンがあるときだけ開閉の印を変える
		if (iconEl) {
			iconEl.textContent = expanded ? '▼' : '▶';
		}

		TMS_AL.ScreenMain.PersistGroupExpandedStates();
	},

	/**
	 * すべて展開する
	 */
	ExpandAll: function () {
		// 保存データが無いときは展開できない
		if (!TMS_AL.ScreenMain._data) {
			return;
		}

		// 保存データ上のグループ。全部開く
		for (const group of TMS_AL.ScreenMain._data.groups) {
			TMS_AL.ScreenMain._groupExpanded[group.id] = true;
		}

		TMS_AL.ScreenMain.Render();
		TMS_AL.ScreenMain.PersistGroupExpandedStates();
	},

	/**
	 * すべて折りたたむ
	 */
	CollapseAll: function () {
		// 保存データが無いときは折りたためない
		if (!TMS_AL.ScreenMain._data) {
			return;
		}

		// 保存データ上のグループ。全部閉じる
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
		// 通常起動
		if (action === 'launch') {
			await TMS_AL.ScreenMain.LaunchApp(appId);
			return;
		}

		// 管理者として起動。オプションが無い通常起動とは分ける
		if (action === 'runAsAdmin') {
			await TMS_AL.ScreenMain.LaunchApp(appId, {
				// 管理者として起動する。未指定の通常起動とは分ける
				runAsAdmin: true
			});
			return;
		}

		// 編集モーダルを開く
		if (action === 'edit') {
			TMS_AL.ScreenModalEdit.OpenEdit(appId);
			return;
		}

		// 削除確認。キャンセルやメニューを閉じた null はここへ入らない
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
			// メニューで選んだ操作。閉じたときは null
			const action = await window.launcherApi.showAppContextMenu();

			await TMS_AL.ScreenMain.HandleAppContextMenuAction(appId, action);
		} catch (error) {
			TMS_AL.ComFnc.LogError('Failed to show app context menu', {
				// メニューを出そうとしたアプリ ID
				appId,
				// 失敗メッセージ。Error 以外は文字列化する
				error: error instanceof Error ? error.message : String(error)
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
		// 表示中の保存データ。未読込なら起動できない
		const data = TMS_AL.ScreenMain._data;
		// 起動するアプリ。ID が無いときは何もしない
		const app  = data?.apps.find((item) => item.id === appId);

		// アプリか保存データが無いと起動できない。どちらか欠けると何もしない
		if (!app || !data) {
			return;
		}

		// 起動結果。失敗時は error に理由が入る
		const result = await window.launcherApi.launchApp({
			// 起動する実行パス
			path: app.path,
			// 失敗メッセージに出すアプリ名
			name: app.name,
			// 起動引数。空なら付けない
			args: app.args,
			// 作業ディレクトリ。空なら実行ファイル側の既定
			workingDir: app.workingDir,
			// 起動後にランチャーを残すか最小化か終了か
			launchBehavior: data.settings.launchBehavior,
			// 管理者として起動するか。未指定は通常起動
			runAsAdmin: options?.runAsAdmin === true
		});

		// 起動できなかったときだけ理由を出す
		if (!result.success) {
			// 詳細メッセージ。error が空なら何も足さない
			const detail = result.error ? `\n${result.error}` : TMS_AL_COMMON.Const.BLANK;
			// 失敗文に出す操作名。管理者指定のときだけ文言を変える
			const action = options?.runAsAdmin === true ? '管理者として起動' : '起動';

			TMS_AL_COMMON.Ui.ShowToast(`「${app.name}」を${action}できませんでした。パスを確認してください: ${app.path}${detail}`, 'error');
		}
	},

	/**
	 * アプリを削除する
	 * @param {string} appId アプリID
	 * @returns {Promise<void>}
	 */
	DeleteApp: async function (appId) {
		// 表示中の保存データ。未読込なら削除できない
		const data = TMS_AL.ScreenMain._data;
		// 削除するアプリ。ID が無いときは確認も出さない
		const app  = data?.apps.find((item) => item.id === appId);

		// アプリか保存データが無いと削除できない。どちらか欠けると何もしない
		if (!app || !data) {
			return;
		}

		// 確認の結果。キャンセルは false
		const ok = TMS_AL_COMMON.Ui.Confirm(`「${app.name}」を削除します。よろしいですか？`);

		// キャンセルされたときは一覧を変えない
		if (!ok) {
			return;
		}

		data.apps = data.apps.filter((item) => item.id !== appId);

		// 保存の成否。失敗時は画面を描き直さない
		const saved = await TMS_AL.ScreenMain.SaveData(true);

		// 保存できたときだけ一覧を描き直す
		if (saved) {
			await TMS_AL.ScreenMain.Render();
		}
	},

	/**
	 * グループを追加する
	 * @returns {Promise<void>}
	 */
	AddGroup: async function () {
		// 表示中の保存データ。未読込なら追加できない
		const data = TMS_AL.ScreenMain._data;
		// 入力されたグループ名。キャンセル時は null
		const name = await TMS_AL_COMMON.Ui.PromptAsync('新しいグループ名を入力してください:');

		// 保存データが無い、または名前が空なら追加しない。どちらか一方で足りる
		if (!data || TMS_AL_COMMON.Funcs.IsEmpty(name)) {
			return;
		}

		// 未分類以外。order の最大をここから取る
		const normalGroups = data.groups.filter((g) => !g.isUncategorized);
		// 未分類以外の最大 order。1 件も無いときは -1 で、追加分は 0
		const maxOrder     = normalGroups.reduce((max, g) => Math.max(max, g.order), -1);

		data.groups.push({
			// 新規グループ ID
			id: `g-${TMS_AL_COMMON.Funcs.GenerateUuid()}`,
			// 前後空白を除いた名前
			name: name.trim(),
			// 未分類以外の末尾。既存が無いときは 0
			order: maxOrder + 1,
			// 未分類ではないのでドラッグと削除ができる
			isUncategorized: false,
			// 追加直後は左ペイン
			pane: 'left'
		});

		// 保存の成否。失敗時は再読込しない
		const saved = await TMS_AL.ScreenMain.SaveData(true);

		// 保存できたときだけ読み直して描画する
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
		// 表示中の保存データ。未読込なら改名できない
		const data  = TMS_AL.ScreenMain._data;
		// 改名するグループ。未分類は対象にしない
		const group = data?.groups.find((g) => g.id === groupId);

		// グループが無い、または未分類なら改名しない。どちらか一方で足りる
		if (!group || group.isUncategorized) {
			return;
		}

		// 入力された新しい名前。キャンセル時は null
		const name = await TMS_AL_COMMON.Ui.PromptAsync('グループ名を入力してください:', group.name);

		// 名前が空、またはキャンセルなら変えない
		if (TMS_AL_COMMON.Funcs.IsEmpty(name)) {
			return;
		}

		group.name  = name.trim();
		// 保存の成否。失敗時は画面を描き直さない
		const saved = await TMS_AL.ScreenMain.SaveData(true);

		// 保存できたときだけ一覧を描き直す
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
		// 表示中の保存データ。未読込なら削除できない
		const data  = TMS_AL.ScreenMain._data;
		// 削除するグループ。未分類は対象にしない
		const group = data?.groups.find((g) => g.id === groupId);

		// グループが無い、未分類、または保存データが無いときは削除しない。どれか一つで足りる
		if (!group || group.isUncategorized || !data) {
			return;
		}

		// 未分類へ移すアプリ。0 件でも確認文の件数は 0
		const movingApps = data.apps.filter((app) => app.groupId === groupId);
		// 確認文。移動件数を含む
		const message    = `グループ「${group.name}」を削除します。所属する ${movingApps.length} 件のアプリは「未分類」へ移動します。よろしいですか？`;
		// 確認の結果。キャンセルは false
		const ok         = TMS_AL_COMMON.Ui.Confirm(message);

		// キャンセルされたときはグループもアプリも動かさない
		if (!ok) {
			return;
		}

		// 移動先の未分類。無いときは作る
		let uncategorized = TMS_AL.ScreenMain.FindUncategorizedGroup();

		// 未分類が無いときだけ新規に作って一覧へ足す
		if (!uncategorized) {
			uncategorized = {
				// 新規の未分類 ID
				id: `g-${TMS_AL_COMMON.Funcs.GenerateUuid()}`,
				// 表示名は共通定数
				name: TMS_AL_COMMON.Const.UNCATEGORIZED_NAME,
				// 常に末尾に置く並び値
				order: 9999,
				// ドラッグも削除もできない固定グループ
				isUncategorized: true
			};
			data.groups.push(uncategorized);
		}

		// 未分類内の最大 order。アプリが無いときは -1
		const maxOrder = data.apps.filter((app) => app.groupId === uncategorized.id).reduce((max, app) => Math.max(max, app.order), -1);

		movingApps.forEach((app, index) => {
			app.groupId = uncategorized.id;
			app.order   = maxOrder + 1 + index;
		});

		data.groups = data.groups.filter((g) => g.id !== groupId);

		// 保存の成否。失敗時は再読込しない
		const saved = await TMS_AL.ScreenMain.SaveData(true);

		// 保存できたときだけ読み直して描画する
		if (saved) {
			await TMS_AL.ScreenMain.LoadAndRender();
		}
	},

	/**
	 * フッターのバージョン表示を更新する
	 * @returns {Promise<void>}
	 */
	UpdateVersion: async function () {
		// フッターのバージョン表示。無いときは何もしない
		const versionEl = document.getElementById('tmsAlVersion');

		// 表示要素が無いときは取得しない
		if (!versionEl) {
			return;
		}

		try {
			// 実行中の版。version は package の版文字列
			const info            = await window.launcherApi.getVersion();
			versionEl.textContent = `v${info.version}`;
		} catch (error) {
			TMS_AL.ComFnc.LogError('Failed to get app version', {
				// 取得失敗のメッセージ。Error 以外は文字列化する
				error: error instanceof Error ? error.message : String(error)
			});
		}
	},

	/**
	 * データを読み込んで画面に反映する
	 * @returns {Promise<void>}
	 */
	LoadAndRender: async function () {
		try {
			// 読み込み結果。失敗時は error があり data は無い
			const result = await window.launcherApi.loadData();

			// 失敗、またはデータが無いときは描画しない。どちらか一方で足りる
			if (!result.success || !result.data) {
				TMS_AL.ComFnc.LogError('Failed to load data', {
					// 読み込み失敗の理由。成功時はここへ来ない
					error: result.error
				});
				return;
			}

			TMS_AL.ScreenMain._data = result.data;

			// バックアップから復旧したときだけ警告を出す
			if (result.recoveredFromBackup) {
				TMS_AL_COMMON.Ui.ShowToast('データファイルをバックアップから復旧しました。', 'warn');
			}

			TMS_AL.ScreenMain.InitGroupExpandedState();
			await TMS_AL.Theme.Apply(result.data.settings.appearance);
			await window.launcherApi.applyLayoutSettings(result.data.settings.paneCount ?? 1);
			await TMS_AL.ScreenMain.Render();

			window.launcherApi.writeLog('INFO', 'Main screen rendered', {
				// 描画したアプリ件数
				appCount: result.data.apps.length,
				// 描画したグループ件数
				groupCount: result.data.groups.length
			});
		} catch (error) {
			TMS_AL.ComFnc.LogError('Failed to initialize main screen', {
				// 初期化失敗のメッセージ。Error 以外は文字列化する
				error: error instanceof Error ? error.message : String(error)
			});
		}
	},

	/**
	 * イベントハンドラを登録する
	 */
	BindEvents: function () {
		// 設定ボタン。無いときは設定を開けない
		const btnSettings    = document.getElementById('tmsAlBtnSettings');
		// すべて折りたたむボタン。無いときはその操作ができない
		const btnCollapseAll = document.getElementById('tmsAlBtnCollapseAll');
		// すべて展開するボタン。無いときはその操作ができない
		const btnExpandAll   = document.getElementById('tmsAlBtnExpandAll');
		// アプリ追加ボタン。グループ未指定の新規
		const btnAdd         = document.getElementById('tmsAlBtnAdd');
		// グループ追加ボタン。無いときはグループを作れない
		const btnAddGroup    = document.getElementById('tmsAlBtnAddGroup');
		// 検索入力。input のときだけ検索キーを受ける
		const searchInput    = document.getElementById('tmsAlSearchInput');
		// 検索結果。無いときはマウス離脱で選択解除できない
		const searchResults  = document.getElementById('tmsAlSearchResults');

		// 設定ボタンがあるときだけ設定モーダルを開く
		if (btnSettings) {
			btnSettings.addEventListener('click', () => {
				TMS_AL.ScreenModalSettings.Open();
			});
		}

		// 折りたたみボタンがあるときだけ全グループを閉じる
		if (btnCollapseAll) {
			btnCollapseAll.addEventListener('click', () => {
				TMS_AL.ScreenMain.CollapseAll();
			});
		}

		// 展開ボタンがあるときだけ全グループを開く
		if (btnExpandAll) {
			btnExpandAll.addEventListener('click', () => {
				TMS_AL.ScreenMain.ExpandAll();
			});
		}

		// 追加ボタンがあるときだけグループ未指定の新規を開く
		if (btnAdd) {
			btnAdd.addEventListener('click', () => {
				TMS_AL.ScreenModalEdit.OpenNew();
			});
		}

		// グループ追加ボタンがあるときだけ名前入力を開く
		if (btnAddGroup) {
			btnAddGroup.addEventListener('click', () => {
				TMS_AL.ScreenMain.AddGroup();
			});
		}

		// 検索欄が input のときだけ入力とキーを受ける
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

		document.addEventListener('keydown', TMS_AL.ScreenMain.HandleGlobalKeyDown, {
			// 検索欄より先に Escape を見て、モーダル以外の検索を消せるようにする
			capture: true
		});

		searchResults?.addEventListener('mouseleave', () => {
			TMS_AL.ScreenMain.SelectSearchResult(-1);
		});

		window.addEventListener('resize', () => {
			// 前回の幅判定が残っているときだけ取り消す。連続リサイズでは最後だけ描き直す
			if (TMS_AL.ScreenMain._resizeTimer) {
				clearTimeout(TMS_AL.ScreenMain._resizeTimer);
			}

			TMS_AL.ScreenMain._resizeTimer = setTimeout(async () => {
				// リサイズ後に入るペイン数
				const activeCount = TMS_AL.ScreenMain.GetActivePaneCount();

				// 有効ペイン数が変わったときだけ一覧を描き直す
				if (TMS_AL.ScreenMain._lastActivePaneCount !== activeCount) {
					await TMS_AL.ScreenMain.Render();
				}
			}, 150);
		});
	}
});

/**
 * 初期化エントリーポイント
 * @returns {Promise<void>}
 */
TMS_AL.Init = async function () {
	// launcherApi が無い開発外の直開きでは画面を結ばない
	if (!TMS_AL.ComFnc.IsApiAvailable()) {
		console.error(`${TMS_AL_COMMON.Const.LOG_PREFIX} launcherApi is not available`);
		return;
	}

	TMS_AL.Theme.BindWindowFocusEvents();
	TMS_AL.RowDrag.Bind();
	TMS_AL.ScreenMain.BindEvents();

	window.launcherApi.onThemeChanged(async () => {
		// 現在の外観設定。未読込のときは undefined で、タイトルバー色だけ更新する
		const appearance = TMS_AL.ScreenMain._data?.settings.appearance;

		// system のときだけ OS の明暗を取り直す。dark と light はクラスを維持する
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
