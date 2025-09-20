import { Bot } from "./Bot";
import { config } from "./config";

async function main() {
  try {
    console.log('🔹 Starting Discord bot...');
    const bot = new Bot();
    await bot.init();
  } catch (error) {
    console.error('🔸 Failed to start bot:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('🔸 Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔸 Unhandled Rejection:', { reason, promise });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🔹 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🔹 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

main();