import { Bot } from "./Bot";

let bot: Bot;

async function main() {
	try {
		bot = new Bot();
		await bot.init();
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

	// Immediately stop all console output to prevent lingering logs
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;
	console.log = () => {};
	console.error = () => {};

	if (bot) {
		// Set a timeout to force exit if shutdown takes too long
		const shutdownTimeout = setTimeout(() => {
			process.exit(0);
		}, 1000); // Reduced to 1 second timeout

		try {
			await bot.shutdown();
			clearTimeout(shutdownTimeout);
		} catch (error) {
			// Silent error handling
		}
	}
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("🔹 Received SIGTERM, shutting down gracefully...");

	// Immediately stop all console output to prevent lingering logs
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;
	console.log = () => {};
	console.error = () => {};

	if (bot) {
		// Set a timeout to force exit if shutdown takes too long
		const shutdownTimeout = setTimeout(() => {
			process.exit(0);
		}, 1000); // Reduced to 1 second timeout

		try {
			await bot.shutdown();
			clearTimeout(shutdownTimeout);
		} catch (error) {
			// Silent error handling
		}
	}
	process.exit(0);
});

main();
