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
		BLANK     : '',
		/** 未分類グループ名 */
		UNCATEGORIZED_NAME: '未分類',
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
			if (typeof value === 'undefined' || value === null) {
				return true;
			}

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
			const limit = maxLength ?? 40;

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
			if (TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
				return TMS_AL_COMMON.Const.BLANK;
			}

			const trimmed = filePath.trim().replace(/[/\\]+$/, '');
			const parts   = trimmed.split(/[/\\]/);

			return parts[parts.length - 1] ?? trimmed;
		},

		/**
		 * HTML エスケープ
		 * @param {string} text 文字列
		 * @returns {string} エスケープ済み文字列
		 */
		EscapeHtml: function (text) {
			if (TMS_AL_COMMON.Funcs.IsEmpty(text)) {
				return TMS_AL_COMMON.Const.BLANK;
			}

			return String(text)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;');
		},

		/**
		 * UUID を生成する
		 * @returns {string} UUID
		 */
		GenerateUuid: function () {
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
			if (TMS_AL_COMMON.Funcs.IsEmpty(filePath)) {
				return TMS_AL_COMMON.Const.BLANK;
			}

			let normalized = filePath.trim();

			if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
				normalized = normalized.slice(1, -1).trim();
			}

			return normalized;
		},
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
		 * @returns {void}
		 */
		ShowToast: function (message, type) {
			const container = document.getElementById('tmsAlToastContainer');

			if (!container) {
				return;
			}

			const toast     = document.createElement('div');
			const toastType = type ?? 'info';

			toast.className   = `tms-al-toast tms-al-toast--${toastType}`;
			toast.textContent = message;
			container.appendChild(toast);

			setTimeout(() => {
				toast.remove();
			}, toastType === 'error' ? 8000 : 4000);
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
				const modal     = document.getElementById('tmsAlPromptModal');
				const msgEl     = document.getElementById('tmsAlPromptMessage');
				const inputEl   = document.getElementById('tmsAlPromptInput');
				const btnOk     = document.getElementById('tmsAlBtnPromptOk');
				const btnCancel = document.getElementById('tmsAlBtnPromptCancel');
				const backdrop  = document.getElementById('tmsAlPromptBackdrop');

				if (!modal || !inputEl) {
					resolve(null);
					return;
				}

				if (msgEl) {
					msgEl.textContent = message;
				}

				inputEl.value = defaultValue ?? TMS_AL_COMMON.Const.BLANK;

				/**
				 * イベント解除とモーダル非表示
				 * @returns {void}
				 */
				const cleanup = function () {
					modal.hidden = true;

					if (btnOk) {
						btnOk.removeEventListener('click', onOk);
					}

					if (btnCancel) {
						btnCancel.removeEventListener('click', onCancel);
					}

					if (backdrop) {
						backdrop.removeEventListener('click', onCancel);
					}

					inputEl.removeEventListener('keydown', onKeydown);
				};

				/**
				 * OK 押下
				 * @returns {void}
				 */
				const onOk = function () {
					const value = inputEl.value.trim();

					cleanup();
					resolve(TMS_AL_COMMON.Funcs.IsEmpty(value) ? null : value);
				};

				/**
				 * キャンセル押下
				 * @returns {void}
				 */
				const onCancel = function () {
					cleanup();
					resolve(null);
				};

				/**
				 * キーボード操作
				 * @param {KeyboardEvent} event キーイベント
				 * @returns {void}
				 */
				const onKeydown = function (event) {
					if (event.key === 'Enter') {
						event.preventDefault();
						onOk();
					}

					if (event.key === 'Escape') {
						onCancel();
					}
				};

				if (btnOk) {
					btnOk.addEventListener('click', onOk);
				}

				if (btnCancel) {
					btnCancel.addEventListener('click', onCancel);
				}

				if (backdrop) {
					backdrop.addEventListener('click', onCancel);
				}

				inputEl.addEventListener('keydown', onKeydown);

				modal.hidden = false;
				inputEl.focus();
				inputEl.select();
			});
		},
	},
};

/**
 * オブジェクトを再帰的に凍結する
 * @param {object} object 凍結対象
 * @returns {object} 凍結済みオブジェクト
 */
function DeepFreeze(object) {
	if (object === null || typeof object !== 'object' || Object.isFrozen(object)) {
		return object;
	}

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
	Const         : {},
	ComFnc        : {},
	Theme         : {},
	ScreenMain     : {},
	ScreenModalEdit: {},
	ScreenModalSettings: {},
	RowDrag        : {},
};
