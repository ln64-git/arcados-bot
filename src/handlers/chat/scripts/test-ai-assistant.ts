import "dotenv/config";
import { ChatAIManager } from "../ChatAIManager.js";
import { AIContextBuilder } from "../../../../ai/core/AIContext.js";
import { AIFactory } from "../../../../ai/core/AIFactory.js";

const provider = process.env.PROVIDER || "grok"; // grok | openai | ollama | gemini
const input = process.argv.slice(2).join(" ") || process.env.PROMPT || "hello";
const userId = process.env.USER_ID || "test-user";
const guildId = process.env.GUILD_ID;
const botUserId = process.env.BOT_USER_ID; // optional: the bot's Discord user ID

async function main(): Promise<void> {
  console.log(`Provider: ${provider}`);
  console.log("Mode: chat-like with tools");

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

  console.log(`\n=== Testing with prompt: "${rawForAI}" ===\n`);
  console.log("Checking for hidden behavior trigger...\n");

  // Build AIContext
  const context = new AIContextBuilder()
    .guild(guildId)
    .user(userId)
    .domain("chat")
    .build();

  const res = await chatAI.generateMentionResponse(rawForAI, context);

  if (!res.success) {
    console.error("🔸 Error:", res.error || "Unknown error");
    process.exit(1);
  }

  console.log("\n=== AI Response ===\n");
  console.log(res.content);

  // Flush cost tracking data before exiting
  try {
    const { APICostTracker } = await import("../../../../utils/APICostTracker.js");
    const tracker = APICostTracker.getInstance();
    // Use timeout to prevent hanging
    await Promise.race([
      tracker.writeStats(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
    console.log("\n💾 Cost tracking data flushed to api-costs/ directory");
    console.log("   View costs with: bun view-costs");
  } catch (err) {
    // Ignore errors in cost tracking
    console.log("\n⚠️  Cost tracking flush skipped");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("🔸 Uncaught error:", err);
  process.exit(1);
});
