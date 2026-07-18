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
	DEBUG: 0,
	INFO : 1,
	WARN : 2,
	ERROR: 3,
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
	const now = new Date();
	const y   = now.getFullYear();
	const m   = String(now.getMonth() + 1).padStart(2, '0');
	const d   = String(now.getDate()).padStart(2, '0');

	return `app-${y}${m}${d}.log`;
}

/**
 * ログディレクトリを確保する
 * @returns {void}
 */
function ensureLogDir(): void {
	const logDir = getLogDir();

	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir, { recursive: true });
	}
}

/**
 * 古いログファイルを削除する
 * @returns {void}
 */
function purgeOldLogs(): void {
	const logDir = getLogDir();

	if (!fs.existsSync(logDir)) {
		return;
	}

	const cutoff = Date.now() - (LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
	const files  = fs.readdirSync(logDir);

	for (const file of files) {
		if (!file.startsWith('app-') || !file.endsWith('.log')) {
			continue;
		}

		const filePath = path.join(logDir, file);
		const stat     = fs.statSync(filePath);

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
 * @returns {void}
 */
function writeLog(
	level: LogLevel,
	processName: 'main' | 'renderer',
	message: string,
	context?: Record<string, unknown>,
): void {
	if (!shouldLog(level)) {
		return;
	}

	ensureLogDir();

	const timestamp  = new Date().toISOString();
	const contextStr = context ? ` ${JSON.stringify(context)}` : '';
	const line       = `[${timestamp}] [${level}] [${processName}] ${message}${contextStr}\n`;
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
	 * @returns {void}
	 */
	error(message: string, context?: Record<string, unknown>): void {
		writeLog('ERROR', 'main', message, context);
	},

	/**
	 * WARN ログ
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 * @returns {void}
	 */
	warn(message: string, context?: Record<string, unknown>): void {
		writeLog('WARN', 'main', message, context);
	},

	/**
	 * INFO ログ
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 * @returns {void}
	 */
	info(message: string, context?: Record<string, unknown>): void {
		writeLog('INFO', 'main', message, context);
	},

	/**
	 * DEBUG ログ
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 * @returns {void}
	 */
	debug(message: string, context?: Record<string, unknown>): void {
		writeLog('DEBUG', 'main', message, context);
	},

	/**
	 * 起動時のログ初期化
	 * @returns {void}
	 */
	init(): void {
		if (process.env.APP_LAUNCHER_LOG_LEVEL === 'DEBUG') {
			minLogLevel = 'DEBUG';
		}

		ensureLogDir();
		purgeOldLogs();
		logger.info('Logger initialized');
	},

	/**
	 * レンダラーからのログを記録する
	 * @param {LogLevel} level ログレベル
	 * @param {string} message メッセージ
	 * @param {Record<string, unknown>} [context] コンテキスト
	 * @returns {void}
	 */
	fromRenderer(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		writeLog(level, 'renderer', message, context);
	},
};
