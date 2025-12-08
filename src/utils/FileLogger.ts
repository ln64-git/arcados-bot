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
	private streamReady = false; // Track if stream is ready for writes

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
			autoClose: false, // Keep stream open
		});

		// Mark stream as ready when opened
		this.writeStream.on("open", () => {
			this.streamReady = true;
		});

		// Handle stream errors
		this.writeStream.on("error", (error) => {
			// Use process.stderr.write directly to avoid recursion
			process.stderr.write(`🔸 FileLogger write stream error: ${error}\n`);
			this.streamReady = false;
		});

		// Stream is ready immediately after creation (synchronous open)
		// But we'll mark it as ready on the 'open' event for safety
		this.streamReady = true;
	}

	/**
	 * Write log entry to current.log
	 */
	log(message: string): void {
		// Format: HH:MM:SS.mmm (compact, readable)
		const now = new Date();
		const hours = now.getHours().toString().padStart(2, "0");
		const minutes = now.getMinutes().toString().padStart(2, "0");
		const seconds = now.getSeconds().toString().padStart(2, "0");
		const millis = now.getMilliseconds().toString().padStart(3, "0");
		const timestamp = `${hours}:${minutes}:${seconds}.${millis}`;

		const logEntry = `[${timestamp}] ${message}\n`;

		// Try to write via stream first (preferred method)
		if (this.writeStream && this.streamReady) {
			try {
				const written = this.writeStream.write(logEntry);
				
				// If write buffer is full, the write will be queued automatically
				// The stream will emit 'drain' when ready for more data
				if (!written) {
					// Buffer is full, but write is queued - stream will handle it
					// We don't need to do anything here as the write is already queued
				}
				return; // Successfully wrote via stream
			} catch (error) {
				// Stream write failed, fall through to fallback
			}
		}

		// Fallback: write directly to file if stream isn't ready or write failed
		// This ensures we don't lose messages during initialization or stream errors
		try {
			fs.appendFileSync(this.currentLogPath, logEntry, "utf8");
		} catch (error) {
			// Ignore fallback errors to avoid recursion
			// Message is lost, but at least we don't crash
		}
	}

	/**
	 * Write raw message without timestamp
	 */
	logRaw(message: string): void {
		if (!this.writeStream) {
			return;
		}

		const logEntry = `${message}\n`;

		// Write to file - use try/catch for synchronous errors
		try {
			this.writeStream.write(logEntry);
		} catch (error) {
			// Handle synchronous write errors
			process.stderr.write(`🔸 FileLogger write error: ${error}\n`);
		}
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
		logger.close();
	});

	process.on("SIGINT", () => {
		logger.close();
	});

	process.on("exit", () => {
		logger.close();
	});
}
