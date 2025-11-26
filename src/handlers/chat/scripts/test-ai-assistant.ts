import "dotenv/config";
import { ChatAIManager } from "../ChatAIManager.js";
import { AIContextBuilder } from "../../../ai/core/AIContext.js";
import { AIFactory } from "../../../ai/core/AIFactory.js";
import { PostgreSQLManager } from "../../../database/PostgreSQLManager.js";

const provider = process.env.PROVIDER || "grok"; // grok | openai | ollama | gemini
const input = process.argv.slice(2).join(" ") || process.env.PROMPT || "hello";
const userId = process.env.USER_ID || "test-user";
const guildId = process.env.GUILD_ID;
const botUserId = process.env.BOT_USER_ID; // optional: the bot's Discord user ID

async function main(): Promise<void> {
  console.log(`Provider: ${provider}`);

  if (!process.env.BOT_TOKEN) {
    console.warn(
      "🔸 BOT_TOKEN not set. Set BOT_TOKEN in your env for config validation."
    );
  }

  if (!guildId) {
    console.error("🔸 GUILD_ID is required to run with tools.");
    process.exit(1);
  }

  let userContent = input.trim();

  if (botUserId) {
    const mentionRe = new RegExp(`<@!?${botUserId}>`, "g");
    userContent = userContent.replace(mentionRe, "").trim();
  }

  userContent = userContent.replace(/^@bot\b/i, "").trim();

  const selfQueryRegex =
    /(who\s+am\s+i\b|whoami\b|tell\s+me\s+about\s+me\b|what\s+do\s+you\s+know\s+about\s+me\b|who\s+is\s+me\b)/i;
  if (selfQueryRegex.test(userContent) && userId) {
    userContent = `tell me about <@${userId}>`;
  }

  userContent = userContent.replace(/@(\d{10,})/g, "<@$1>");

  const rawForAI = userContent;

  // Initialize new AI architecture
  const { engine } = await AIFactory.create();
  const chatAI = new ChatAIManager(engine);

  // Initialize database (optional but enables environment context)
  const db = new PostgreSQLManager();
  const dbConnected = await db.connect();
  if (!dbConnected) {
    console.warn("🔸 Database not connected. Running without enriched environment context.");
  }

  // Build AIContext
  const contextBuilder = new AIContextBuilder()
    .guild(guildId)
    .user(userId)
    .domain("chat");

  if (dbConnected) {
    contextBuilder.withDatabase(db);
  }

  const context = contextBuilder.build();

  const res = await chatAI.generateMentionResponse(rawForAI, context);

  if (!res.success) {
    console.error("🔸 Error:", res.error || "Unknown error");
    process.exit(1);
  }

  console.log("\n=== AI Response ===\n");
  console.log(res.content);

  // Flush cost tracking data before exiting
  try {
    const { APICostTracker } = await import("../../../utils/APICostTracker.js");
    const tracker = APICostTracker.getInstance();
    // Use timeout to prevent hanging
    await Promise.race([
      tracker.writeStats(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  } catch (err) {
    // Ignore errors in cost tracking
    console.log("\n⚠️  Cost tracking flush skipped");
  }

  if (dbConnected) {
    await db.disconnect();
  }

  process.exit(0);
}

main().catch(async (err) => {
  console.error("🔸 Uncaught error:", err);
  try {
    // Best-effort DB cleanup if we created one
    const db = new PostgreSQLManager();
    if (db.isConnected()) {
      await db.disconnect();
    }
  } catch {
    // ignore
  }
  process.exit(1);
});
