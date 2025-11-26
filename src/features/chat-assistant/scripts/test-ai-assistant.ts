import "dotenv/config";
import { AIManager } from "../../../ai/core/AIManager";

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
  const ai = AIManager.getInstance();

  console.log(`\n=== Testing with prompt: "${rawForAI}" ===\n`);
  console.log("Checking for hidden behavior trigger...\n");

  await ai.runWithGuildContext(guildId, async () => {
    const res = await ai.generateText(rawForAI, userId, provider, {
      personaKey: "sophia",
      useDiscordFormatting: false,
      mode: "chat",
    });

    if (!res.success) {
      console.error("🔸 Error:", res.error || "Unknown error");
      process.exit(1);
    }

    console.log("\n=== AI Response ===\n");
    console.log(res.content);

    // Check if hidden behavior was activated by looking for keywords in response
    const responseLower = res.content.toLowerCase();
    const hasHiddenBehaviorKeywords =
      responseLower.includes("carnal") ||
      responseLower.includes("sensual") ||
      responseLower.includes("erotic") ||
      responseLower.includes("sexual") ||
      responseLower.includes("desire") ||
      responseLower.includes("hunger");

  });

  process.exit(0);
}

main().catch((err) => {
  console.error("🔸 Uncaught error:", err);
  process.exit(1);
});
