/**
 * 日次ログファイルへレベル付きで書き、保持日数を超えたログを削除する
 * 呼び出し側は logger だけを使い、ログディレクトリの作成はこのファイルが行う
 * @file
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** ログレベル */
export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/** ログ出力先保持日数 */
const LOG_RETENTION_DAYS = 14;

/** 現在の最小ログレベル（本番既定: INFO） */
let minLogLevel: LogLevel = 'INFO';

/** ログレベルの優先度マップ */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	// 最も低い。DEBUG 設定のときだけ出る
	DEBUG: 0,
	// 本番の既定しきい値。これ未満は出さない
	INFO: 1,
	// INFO より重い警告
	WARN: 2,
	// 常に出す最上位。数値が大きいほど優先
	ERROR: 3
};

/**
 * ログディレクトリのパスを取得する
 * @returns {string} ログディレクトリの絶対パス
 */
function getLogDir(): string {
	return path.join(app.getPath('userData'), 'logs');
}

/**
 * 今日のログファイル名を取得する
 * @returns {string} ログファイル名
 */
function getTodayLogFileName(): string {
	// ローカル日付。UTC ではない。ファイル名の基準日
	const now = new Date();
	// 年。4 桁。単位は西暦
	const y   = now.getFullYear();
	// 月。1 始まりの 2 桁。単位は暦月。0 埋め
	const m   = String(now.getMonth() + 1).padStart(2, '0');
	// 日。2 桁。単位は日。0 埋め
	const d   = String(now.getDate()).padStart(2, '0');

	return `app-${y}${m}${d}.log`;
}

/**
 * ログディレクトリを確保する
 */
function ensureLogDir(): void {
	// ----------------------------------------------
	// userData/logs の絶対パス。未作成でもパスは返す
	// ----------------------------------------------
	const logDir = getLogDir();

	// ----------------------------------------------
	// ディレクトリが無いときだけ作る。既にあるときは何もしない
	// ----------------------------------------------
	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir, {
			// 親が無くてもまとめて作る
			recursive: true
		});
	}
}

/**
 * 古いログファイルを削除する
 */
function purgeOldLogs(): void {
	// userData/logs。ディレクトリが無くてもパスは決まる
	const logDir = getLogDir();

	// ログディレクトリが無い。消す対象も無い
	if (!fs.existsSync(logDir)) {
		return;
	}

	// ----------------------------------------------
	// 今から保持日数を引いた期限。単位は ms。これより古い mtime を消す
	// ----------------------------------------------
	const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	// ディレクトリ直下の名前。空なら何も消さない
	const files  = fs.readdirSync(logDir);

	// 1 件の名前。app- かつ .log の両方を満たすものだけが削除候補
	for (const file of files) {
		// app- で始まらないか、.log で終わらないか。どちらかで対象外。両方一致したときだけ時刻を見る
		if (!file.startsWith('app-') || !file.endsWith('.log')) {
			continue;
		}

		// ログファイルの絶対パス。親は logDir 固定
		const filePath = path.join(logDir, file);
		// 更新時刻を見る。単位は ms。読めないときは例外になる
		const stat     = fs.statSync(filePath);

		// 更新時刻が期限より前。同じ時刻は残す
		if (stat.mtimeMs < cutoff) {
			fs.unlinkSync(filePath);
		}
	}
}

/**
 * ログ出力すべきレベルか判定する
 * @param {LogLevel} level ログレベル
 * @returns {boolean} 出力対象なら true
 */
function shouldLog(level: LogLevel): boolean {
	return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLogLevel];
}

/**
 * ログ1行を書き込む
 * @param {LogLevel} level ログレベル
 * @param {'main' | 'renderer'} processName プロセス名
 * @param {string} message メッセージ
 * @param {Record<string, unknown>} [context] 追加コンテキスト
 */
function writeLog(level: LogLevel, processName: 'main' | 'renderer', message: string, context?: Record<string, unknown>): void {
	// 最小レベル未満。ディレクトリもファイルも触らない
	if (!shouldLog(level)) {
		return;
	}

	ensureLogDir();

	// ----------------------------------------------
	// ISO 時刻の 1 行を、今日のログファイルへ追記する
	// ----------------------------------------------
	const timestamp  = new Date().toISOString();
	// context が未指定または falsy のときは空。あるときは前置空白付き JSON
	const contextStr = context ? ` ${JSON.stringify(context)}` : '';
	// 1 レコード。末尾は改行。context が空でもレベルと本文は残る
	const line       = `[${timestamp}] [${level}] [${processName}] ${message}${contextStr}\n`;
	// 今日のログの絶対パス。日付が変わると別ファイル
	const logPath    = path.join(getLogDir(), getTodayLogFileName());

	fs.appendFileSync(logPath, line, 'utf8');
}

/**
 * ロガー API
 */
export const logger = {
	/**
	 * ERROR ログ
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 */
	error(message: string, context?: Record<string, unknown>): void {
		writeLog('ERROR', 'main', message, context);
	},

	/**
	 * WARN ログ
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 */
	warn(message: string, context?: Record<string, unknown>): void {
		writeLog('WARN', 'main', message, context);
	},

	/**
	 * INFO ログ
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 */
	info(message: string, context?: Record<string, unknown>): void {
		writeLog('INFO', 'main', message, context);
	},

	/**
	 * DEBUG ログ
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 */
	debug(message: string, context?: Record<string, unknown>): void {
		writeLog('DEBUG', 'main', message, context);
	},

	/**
	 * 起動時のログ初期化
	 */
	init(): void {
		// 環境変数がちょうど DEBUG のときだけしきい値を下げる。未設定や別の値は INFO のまま
		if (process.env.APP_LAUNCHER_LOG_LEVEL === 'DEBUG') {
			minLogLevel = 'DEBUG';
		}

		// ----------------------------------------------
		// ディレクトリを作り、期限切れを消してから開始を記録する
		// ----------------------------------------------
		ensureLogDir();
		purgeOldLogs();
		logger.info('Logger initialized');
	},

	/**
	 * レンダラーからのログを記録する
	 * @param {LogLevel} level ログレベル
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 */
	fromRenderer(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		writeLog(level, 'renderer', message, context);
	}
};
