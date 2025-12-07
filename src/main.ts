import { Bot } from "./Bot";
import { interceptConsole, FileLogger } from "./utils/FileLogger";

// Initialize file logging before anything else
interceptConsole();

let bot: Bot;

async function main() {
	try {
		console.log("🚀 Starting Arcados Bot...");
		bot = new Bot();
		await bot.init();
		console.log("✅ Bot initialized successfully");
	} catch (error) {
		console.error("🔸 Bot initialization failed:", error);
		process.exit(1);
	}
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
	console.error("🔸 Uncaught Exception:", error);
	process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("🔸 Unhandled Rejection at:", promise, "reason:", reason);
	process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
	console.log("🔹 Received SIGINT, shutting down gracefully...");

	if (bot) {
		// Set a timeout to force exit if shutdown takes too long
		const shutdownTimeout = setTimeout(() => {
			FileLogger.getInstance().close();
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
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("🔹 Received SIGTERM, shutting down gracefully...");

	if (bot) {
		// Set a timeout to force exit if shutdown takes too long
		const shutdownTimeout = setTimeout(() => {
			FileLogger.getInstance().close();
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
	process.exit(0);
});

main();
