/**
 * File Logger with Rotating Logs
 *
 * Maintains up to 8 log files:
 * - current.log: Active log file for the current session
 * - bot-1.log to bot-7.log: Previous 7 log sessions (rotated)
 *
 * Features:
 * - Real-time writes to current.log
 * - Automatic rotation on bot restart
 * - Keeps only the latest 8 sessions
 * - Timestamps for all log entries
 * - Color-coded console output (preserved in files)
 */

import * as fs from "node:fs";
import * as path from "node:path";

export class FileLogger {
	private static instance: FileLogger;
	private logDir: string;
	private archiveDir: string;
	private currentLogPath: string;
	private writeStream: fs.WriteStream | null = null;
	private maxLogs = 8; // current.log + 7 archived logs

	private constructor() {
		this.logDir = path.join(process.cwd(), "log");
		this.archiveDir = path.join(this.logDir, "archive");
		this.currentLogPath = path.join(this.logDir, "current.log");
		this.ensureLogDirectory();
		this.rotateLogsOnStartup();
		this.initializeWriteStream();
	}

	static getInstance(): FileLogger {
		if (!FileLogger.instance) {
			FileLogger.instance = new FileLogger();
		}
		return FileLogger.instance;
	}

	/**
	 * Ensure log directory exists
	 */
	private ensureLogDirectory(): void {
		if (!fs.existsSync(this.logDir)) {
			fs.mkdirSync(this.logDir, { recursive: true });
		}
		if (!fs.existsSync(this.archiveDir)) {
			fs.mkdirSync(this.archiveDir, { recursive: true });
		}
	}

	/**
	 * Rotate logs on startup
	 *
	 * current.log → archive/bot-1.log
	 * archive/bot-1.log → archive/bot-2.log
	 * archive/bot-2.log → archive/bot-3.log
	 * ...
	 * archive/bot-6.log → archive/bot-7.log
	 * archive/bot-7.log → deleted
	 */
	private rotateLogsOnStartup(): void {
		// If current.log exists, rotate it
		if (fs.existsSync(this.currentLogPath)) {
			// Delete oldest log (archive/bot-7.log)
			const oldestLog = path.join(this.archiveDir, `bot-${this.maxLogs - 1}.log`);
			if (fs.existsSync(oldestLog)) {
				fs.unlinkSync(oldestLog);
			}

			// Rotate existing logs (bot-6.log → bot-7.log, bot-5.log → bot-6.log, etc.)
			for (let i = this.maxLogs - 2; i >= 1; i--) {
				const oldPath = path.join(this.archiveDir, `bot-${i}.log`);
				const newPath = path.join(this.archiveDir, `bot-${i + 1}.log`);
				if (fs.existsSync(oldPath)) {
					fs.renameSync(oldPath, newPath);
				}
			}

			// Rotate current.log → archive/bot-1.log
			const firstArchive = path.join(this.archiveDir, "bot-1.log");
			fs.renameSync(this.currentLogPath, firstArchive);
		}

		// Create new current.log with header
		const header = `

		
🌿 Arcados Bot - New Session                   
Started: ${new Date().toISOString()}                

`;
		fs.writeFileSync(this.currentLogPath, header);
	}

	/**
	 * Initialize write stream for current.log
	 */
	private initializeWriteStream(): void {
		this.writeStream = fs.createWriteStream(this.currentLogPath, {
			flags: "a", // Append mode
			encoding: "utf8",
		});

		// Handle stream errors
		this.writeStream.on("error", (error) => {
			console.error("🔸 FileLogger write stream error:", error);
		});
	}

	/**
	 * Write log entry to current.log
	 */
	log(message: string): void {
		if (!this.writeStream) {
			return;
		}

		// Format: HH:MM:SS.mmm (compact, readable)
		const now = new Date();
		const hours = now.getHours().toString().padStart(2, "0");
		const minutes = now.getMinutes().toString().padStart(2, "0");
		const seconds = now.getSeconds().toString().padStart(2, "0");
		const millis = now.getMilliseconds().toString().padStart(3, "0");
		const timestamp = `${hours}:${minutes}:${seconds}.${millis}`;

		const logEntry = `[${timestamp}] ${message}\n`;

		// Write to file
		this.writeStream.write(logEntry);
	}

	/**
	 * Write raw message without timestamp
	 */
	logRaw(message: string): void {
		if (!this.writeStream) {
			return;
		}

		this.writeStream.write(`${message}\n`);
	}

	/**
	 * Get list of all log files (current + archived)
	 */
	getLogFiles(): string[] {
		const files: string[] = [];

		// Add current.log
		if (fs.existsSync(this.currentLogPath)) {
			files.push("current.log (ACTIVE)");
		}

		// Add archived logs
		for (let i = 1; i < this.maxLogs; i++) {
			const logPath = path.join(this.archiveDir, `bot-${i}.log`);
			if (fs.existsSync(logPath)) {
				const stats = fs.statSync(logPath);
				files.push(`archive/bot-${i}.log (${stats.size} bytes, ${stats.mtime.toISOString()})`);
			}
		}

		return files;
	}

	/**
	 * Close write stream on shutdown
	 */
	close(): void {
		if (this.writeStream) {
			this.writeStream.end();
			this.writeStream = null;
		}
	}
}

/**
 * Intercept console.log and write to file
 */
export function interceptConsole(): void {
	const logger = FileLogger.getInstance();

	const originalLog = console.log;
	const originalError = console.error;
	const originalWarn = console.warn;

	console.log = (...args: unknown[]) => {
		const message = args.map((arg) => String(arg)).join(" ");
		logger.log(message);
		originalLog.apply(console, args);
	};

	console.error = (...args: unknown[]) => {
		const message = args.map((arg) => String(arg)).join(" ");
		logger.log(`ERROR: ${message}`);
		originalError.apply(console, args);
	};

	console.warn = (...args: unknown[]) => {
		const message = args.map((arg) => String(arg)).join(" ");
		logger.log(`WARN: ${message}`);
		originalWarn.apply(console, args);
	};

	// Handle graceful shutdown
	process.on("SIGTERM", () => {
		logger.log("Received SIGTERM, shutting down gracefully...");
		logger.close();
	});

	process.on("SIGINT", () => {
		logger.log("Received SIGINT, shutting down gracefully...");
		logger.close();
	});

	process.on("exit", () => {
		logger.close();
	});
}
