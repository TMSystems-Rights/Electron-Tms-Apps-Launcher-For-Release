/**
 * 画面をまたいで使う空判定、パス整形、文字入力を提供する
 * 定数と関数は凍結し、画面固有の状態は持たない
 * @file
 */
'use strict';

/**
 * アプリ起動ランチャー共通モジュール
 * @namespace TMS_AL_COMMON
 */
const TMS_AL_COMMON = {
	/**
	 * 共通定数
	 * @namespace Const
	 */
	Const: {
		/** ログメッセージ接頭辞 */
		LOG_PREFIX: '[TmsAppLauncher]',
		/** 空文字列 */
		BLANK: '',
		/** 未分類グループ名 */
		UNCATEGORIZED_NAME: '未分類'
	},

	/**
	 * 共通関数
	 * @namespace Funcs
	 */
	Funcs: {
		/**
		 * 値が空かどうかを判定する
		 * @param {*} value 判定対象の値
		 * @returns {boolean} 判定結果（true: 空、false: それ以外）
		 */
		IsEmpty: function (value) {
			// 未定義または null は空。どちらか一方で足りる
			if (typeof value === 'undefined' || value === null) {
				return true;
			}

			// 文字列であり、かつ空白を除いた長さが 0 以下。型が文字列でないと入らない
			if (typeof value === 'string' && value.trim().length <= 0) {
				return true;
			}

			return false;
		},

		/**
		 * パスを省略表示用に整形する
		 * @param {string} filePath ファイルパス
		 * @param {number} [maxLength=40] 最大表示長
		 * @returns {string} 省略後パス
		 */
		TruncatePath: function (filePath, maxLength) {
			// 省略後の最大文字数。引数が未指定のときは 40
			const limit = maxLength ?? 40;

			// パスが空、または文字数が上限以内なら省略しない。どちらか一方で元の文字列を返す
			if (TMS_AL_COMMON.Funcs.IsEmpty(filePath) || filePath.length <= limit) {
				return filePath;
			}

			return `…${filePath.slice(-(limit - 1))}`;
		},

		/**
		 * パスからファイル名を取得する
		 * @param {string} filePath ファイルパス
		 * @returns {string} ファイル名
		 */
		GetPathBasename: function (filePath) {
			// パスが空ならファイル名は空文字
			if (TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
				return TMS_AL_COMMON.Const.BLANK;
			}

			// 末尾の区切りを除いたパス。区切りだけだったときは空文字になる
			const trimmed = filePath.trim().replace(/[/\\]+$/, '');
			// 区切りで分けた各部分。空文字だけのときは要素が一つ
			const parts   = trimmed.split(/[/\\]/);

			return parts[parts.length - 1] ?? trimmed;
		},

		/**
		 * HTML エスケープ
		 * @param {string} text 文字列
		 * @returns {string} エスケープ済み文字列
		 */
		EscapeHtml: function (text) {
			// テキストが空ならエスケープ対象が無く、空文字を返す
			if (TMS_AL_COMMON.Funcs.IsEmpty(text)) {
				return TMS_AL_COMMON.Const.BLANK;
			}

			return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		},

		/**
		 * UUID を生成する
		 * @returns {string} UUID
		 */
		GenerateUuid: function () {
			// crypto.randomUUID があるときだけそれを使う。実行環境に crypto が無いとフォールバックへ進む
			if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
				return crypto.randomUUID();
			}

			return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		},

		/**
		 * 実行パス文字列から両端のダブルクォートを除去する
		 * @param {string} filePath 実行パス
		 * @returns {string} 正規化後パス
		 */
		StripExecutablePathQuotes: function (filePath) {
			// パスが空なら除去する対象が無く、空文字を返す
			if (TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
				return TMS_AL_COMMON.Const.BLANK;
			}

			// 両端の空白を除いたパス。このあと両端クォートを見る
			let normalized = filePath.trim();

			// 長さが 2 以上で、先頭と末尾がともにダブルクォートのときだけ外す。どれか一つでも欠けると残す
			if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
				normalized = normalized.slice(1, -1).trim();
			}

			return normalized;
		}
	},

	/**
	 * UI ユーティリティ
	 * @namespace Ui
	 */
	Ui: {
		/**
		 * トースト通知を表示する
		 * @param {string} message メッセージ
		 * @param {'info' | 'warn' | 'error'} [type='info'] 種別
		 */
		ShowToast: function (message, type) {
			// トーストの親要素。画面に無いときは通知を出さない
			const container = document.getElementById('tmsAlToastContainer');

			// 親が無いときは要素を作らず終了する
			if (!container) {
				return;
			}

			// これから足す通知要素。種別クラスと本文は直後に付ける
			const toast     = document.createElement('div');
			// 表示種別。引数が未指定のときは info。error だけ表示を長くする
			const toastType = type ?? 'info';

			toast.className   = `tms-al-toast tms-al-toast--${toastType}`;
			toast.textContent = message;
			container.appendChild(toast);

			setTimeout(
				() => {
					toast.remove();
				},
				toastType === 'error' ? 8000 : 4000
			);
		},

		/**
		 * 確認ダイアログ
		 * @param {string} message メッセージ
		 * @returns {boolean} OK なら true
		 */
		Confirm: function (message) {
			return window.confirm(message);
		},

		/**
		 * 入力プロンプト（同期版・Electron 非対応。PromptAsync を使用すること）
		 * @param {string} message メッセージ
		 * @param {string} [defaultValue=''] 既定値
		 * @returns {string | null} 入力値（キャンセル時 null）
		 */
		Prompt: function (message, defaultValue) {
			return window.prompt(message, defaultValue ?? TMS_AL_COMMON.Const.BLANK);
		},

		/**
		 * 入力プロンプト（非同期・Electron 対応）
		 * @param {string} message メッセージ
		 * @param {string} [defaultValue=''] 既定値
		 * @returns {Promise<string | null>} 入力値（キャンセル時 null）
		 */
		PromptAsync: function (message, defaultValue) {
			return new Promise((resolve) => {
				// プロンプトのモーダル。無いときは入力を受け取れない
				const modal     = document.getElementById('tmsAlPromptModal');
				// 説明文の表示先。無いときは本文を書かず入力欄だけ使う
				const msgEl     = document.getElementById('tmsAlPromptMessage');
				// 入力欄。無いときはモーダルを開かない
				const inputEl   = document.getElementById('tmsAlPromptInput');
				// 確定ボタン。無いときはクリックでは確定できない
				const btnOk     = document.getElementById('tmsAlBtnPromptOk');
				// キャンセルボタン。無いときはクリックでは閉じられない
				const btnCancel = document.getElementById('tmsAlBtnPromptCancel');
				// 背景。無いときは背景クリックでは閉じられない
				const backdrop  = document.getElementById('tmsAlPromptBackdrop');

				// モーダルか入力欄が無いと入力を受け取れない。どちらか欠けるとキャンセルと同じ null
				if (!modal || !inputEl) {
					resolve(null);
					return;
				}

				// 説明文の要素があるときだけ本文を書く
				if (msgEl) {
					msgEl.textContent = message;
				}

				inputEl.value = defaultValue ?? TMS_AL_COMMON.Const.BLANK;

				// ----------------------------------------------
				/**
				 * イベント解除とモーダル非表示
				 */
				const cleanup = function () {
					modal.hidden = true;

					// 確定ボタンがあるときだけ確定ハンドラを外す
					if (btnOk) {
						btnOk.removeEventListener('click', onOk);
					}

					// キャンセルボタンがあるときだけ閉じるハンドラを外す
					if (btnCancel) {
						btnCancel.removeEventListener('click', onCancel);
					}

					// 背景があるときだけ背景クリックのハンドラを外す
					if (backdrop) {
						backdrop.removeEventListener('click', onCancel);
					}

					inputEl.removeEventListener('keydown', onKeydown);
				};

				/**
				 * OK 押下
				 */
				const onOk = function () {
					// 前後の空白を除いた入力。空なら null として返す
					const value = inputEl.value.trim();

					cleanup();
					resolve(TMS_AL_COMMON.Funcs.IsEmpty(value) ? null : value);
				};

				/**
				 * キャンセル押下
				 */
				const onCancel = function () {
					cleanup();
					resolve(null);
				};

				/**
				 * キーボード操作
				 * @param {KeyboardEvent} event キーイベント
				 */
				const onKeydown = function (event) {
					// Enter は確定。入力欄の改行にはしない
					if (event.key === 'Enter') {
						event.preventDefault();
						onOk();
					}

					// Escape はキャンセル。入力値は返さない
					if (event.key === 'Escape') {
						onCancel();
					}
				};

				// ----------------------------------------------
				// 確定ボタンがあるときだけ確定クリックを受ける
				if (btnOk) {
					btnOk.addEventListener('click', onOk);
				}

				// キャンセルボタンがあるときだけ閉じるクリックを受ける
				if (btnCancel) {
					btnCancel.addEventListener('click', onCancel);
				}

				// 背景があるときだけ背景クリックで閉じる
				if (backdrop) {
					backdrop.addEventListener('click', onCancel);
				}

				inputEl.addEventListener('keydown', onKeydown);

				// ----------------------------------------------
				modal.hidden = false;
				inputEl.focus();
				inputEl.select();
			});
		}
	}
};

/**
 * オブジェクトを再帰的に凍結する
 * @param {object} object 凍結対象
 * @returns {object} 凍結済みオブジェクト
 */
function DeepFreeze(object) {
	// null、オブジェクト以外、凍結済みは再帰しない。どれか一つでもそのまま返す
	if (object === null || typeof object !== 'object' || Object.isFrozen(object)) {
		return object;
	}

	// 凍結する子のプロパティ名。列挙できるものだけ再帰する
	for (const key of Object.keys(object)) {
		DeepFreeze(object[key]);
	}

	return Object.freeze(object);
}

DeepFreeze(TMS_AL_COMMON.Funcs);
DeepFreeze(TMS_AL_COMMON.Const);
Object.freeze(TMS_AL_COMMON);

/**
 * アプリ起動ランチャー レンダラー名前空間（各モジュールが拡張）
 * @namespace TMS_AL
 */
// eslint-disable-next-line no-unused-vars -- 後続スクリプトから参照されるグローバル名前空間
const TMS_AL = {
	// 画面共通の定数。main.js が Object.assign で足す。初期は空
	Const: {},
	// 画面共通の関数。初期は空
	ComFnc: {},
	// テーマ適用。初期は空
	Theme: {},
	// メイン画面の状態と描画。初期は空
	ScreenMain: {},
	// 登録・編集モーダル。初期は空
	ScreenModalEdit: {},
	// 設定モーダル。初期は空
	ScreenModalSettings: {},
	// 行とグループのドラッグ。初期は空
	RowDrag: {}
};
