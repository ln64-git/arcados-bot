import "dotenv/config";
import { AIManager } from "../AIManager";

// CLI inputs
const provider = process.env.PROVIDER || "grok"; // grok | openai | ollama | gemini
const input = process.argv.slice(2).join(" ") || process.env.PROMPT || "hello";
const userId = process.env.USER_ID || "test-user";
const guildId = process.env.GUILD_ID;
const botUserId = process.env.BOT_USER_ID; // optional: the bot's Discord user ID

async function main() {
  console.log(`Provider: ${provider}`);
  console.log("Mode: chat-like with tools");

  // Config guard
  if (!process.env.BOT_TOKEN) {
    console.warn(
      "🔸 BOT_TOKEN not set. Set BOT_TOKEN in your env for config validation."
    );
  }
  if (!guildId) {
    console.error("🔸 GUILD_ID is required to run with tools.");
    process.exit(1);
  }

  // Prepare message like Bot.ts does
  let userContent = input.trim();

  // Strip bot mention if provided
  if (botUserId) {
    const mentionRe = new RegExp(`<@!?${botUserId}>`, "g");
    userContent = userContent.replace(mentionRe, "").trim();
  }
  // Also strip a plain "@bot" prefix if present
  userContent = userContent.replace(/^@bot\b/i, "").trim();

  // Map self-referential queries to an explicit self-mention
  const selfQueryRegex =
    /(who\s+am\s+i\b|whoami\b|tell\s+me\s+about\s+me\b|what\s+do\s+you\s+know\s+about\s+me\b|who\s+is\s+me\b)/i;
  if (selfQueryRegex.test(userContent) && userId) {
    userContent = `tell me about <@${userId}>`;
  }

  // Convert @1234567890 to <@1234567890> so tools can resolve
  userContent = userContent.replace(/@(\d{10,})/g, "<@$1>");

  // Keep raw mentions for AI so tool layer can see <@id>
  const rawForAI = userContent;

  const ai = AIManager.getInstance();
  await ai.runWithGuildContext(guildId, async () => {
    // Use generateText in guild context so AIManager routes to generateWithTools
    const res = await ai.generateText(rawForAI, userId, provider, {
      persona: "casual",
      useDiscordFormatting: false,
    });
    if (!res.success) {
      console.error("🔸 Error:", res.error || "Unknown error");
      process.exit(1);
    }
    console.log("\n=== AI Response ===\n");
    console.log(res.content);
  });
}

main().catch((err) => {
  console.error("🔸 Uncaught error:", err);
  process.exit(1);
});
