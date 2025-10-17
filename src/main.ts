import { Bot } from "./Bot";

async function main() {
	try {
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
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("🔹 Received SIGTERM, shutting down gracefully...");
	process.exit(0);
});

main();
