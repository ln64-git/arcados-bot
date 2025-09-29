import { Bot } from "./Bot";
import { memoryManager } from "./features/performance-monitoring/MemoryManager";
import { performanceTest } from "./features/performance-monitoring/PerformanceTest";

async function main() {
	try {
		// Run performance tests in development
		if (process.env.NODE_ENV === "development") {
			await performanceTest.runAllTests();
		}

		const bot = new Bot();
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
	await memoryManager.destroy();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("🔹 Received SIGTERM, shutting down gracefully...");
	await memoryManager.destroy();
	process.exit(0);
});

main();
