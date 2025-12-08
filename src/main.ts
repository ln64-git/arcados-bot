import { Bot } from "./Bot";
import { interceptConsole, FileLogger } from "./utils/FileLogger";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Initialize file logging before anything else
interceptConsole();

const PID_FILE = join(tmpdir(), "arcados-bot.pid");

/**
 * Delay helper function
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if another instance is running and kill it if found
 */
async function ensureSingleInstance(): Promise<void> {
	if (existsSync(PID_FILE)) {
		try {
			const existingPid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);

			// Check if process is still running
			// On Linux, sending signal 0 checks if process exists
			try {
				process.kill(existingPid, 0);
				// Process exists, kill it
				console.log(`🔸 Found existing instance (PID: ${existingPid}), terminating...`);
				process.kill(existingPid, "SIGTERM");

				// Wait a bit for graceful shutdown
				let attempts = 0;
				const maxAttempts = 10;
				while (attempts < maxAttempts) {
					try {
						process.kill(existingPid, 0);
						// Still running, wait
						attempts++;
						await delay(100);
					} catch {
						// Process is gone
						break;
					}
				}

				// If still running, force kill
				try {
					process.kill(existingPid, 0);
					console.log(`🔸 Force killing existing instance (PID: ${existingPid})...`);
					process.kill(existingPid, "SIGKILL");
				} catch {
					// Process already gone
				}
			} catch {
				// Process doesn't exist, PID file is stale
				console.log("🔸 Stale PID file found, removing...");
			}

			// Remove old PID file
			try {
				unlinkSync(PID_FILE);
			} catch {
				// Ignore errors removing stale PID file
			}
		} catch (error) {
			console.error("🔸 Error checking for existing instance:", error);
			// Continue anyway
		}
	}

	// Create PID file for this instance
	try {
		writeFileSync(PID_FILE, process.pid.toString(), "utf-8");
	} catch (error) {
		console.error("🔸 Error creating PID file:", error);
		// Continue anyway
	}
}

/**
 * Clean up PID file on exit
 */
function cleanupPidFile(): void {
	try {
		if (existsSync(PID_FILE)) {
			unlinkSync(PID_FILE);
		}
	} catch {
		// Ignore errors during cleanup
	}
}

let bot: Bot;

async function main() {
	try {
		// Ensure only one instance is running
		await ensureSingleInstance();

		console.log("🚀 Starting Arcados Bot...");
		bot = new Bot();
		await bot.init();
		console.log("🔹 Bot initialized successfully");
	} catch (error) {
		console.error("🔸 Bot initialization failed:", error);
		cleanupPidFile();
		process.exit(1);
	}
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
	console.error("🔸 Uncaught Exception:", error);
	cleanupPidFile();
	process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("🔸 Unhandled Rejection at:", promise, "reason:", reason);
	cleanupPidFile();
	process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
	console.log("🔹 Received SIGINT, shutting down gracefully...");

	if (bot) {
		// Set a timeout to force exit if shutdown takes too long
		const shutdownTimeout = setTimeout(() => {
			FileLogger.getInstance().close();
			cleanupPidFile();
			process.exit(0);
		}, 1000); // Reduced to 1 second timeout

		try {
			await bot.shutdown();
			clearTimeout(shutdownTimeout);
		} catch (error) {
			console.error("🔸 Error during shutdown:", error);
		}
	}
	FileLogger.getInstance().close();
	cleanupPidFile();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("🔹 Received SIGTERM, shutting down gracefully...");

	if (bot) {
		// Set a timeout to force exit if shutdown takes too long
		const shutdownTimeout = setTimeout(() => {
			FileLogger.getInstance().close();
			cleanupPidFile();
			process.exit(0);
		}, 1000); // Reduced to 1 second timeout

		try {
			await bot.shutdown();
			clearTimeout(shutdownTimeout);
		} catch (error) {
			console.error("🔸 Error during shutdown:", error);
		}
	}
	FileLogger.getInstance().close();
	cleanupPidFile();
	process.exit(0);
});

main();
