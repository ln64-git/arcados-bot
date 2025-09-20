import dotenv from "dotenv";
import { Bot } from "./Bot";

dotenv.config();

const botToken = process.env.BOT_TOKEN!;

if (!botToken) {
  throw new Error("BOT_TOKEN is missing in the environment.");
}

const bot = new Bot(botToken);
bot.init().catch((err) => console.error("🔸 Failed to initialize bot:", err));