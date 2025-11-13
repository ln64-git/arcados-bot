import "dotenv/config";
import { AIManager } from "../AIManager";
import type { ToolCall } from "../providers/AIProvider";

// CLI inputs
const provider = process.env.PROVIDER || "grok"; // grok | openai | ollama | gemini
const input = process.argv.slice(2).join(" ") || process.env.PROMPT || "hello";
const userId = process.env.USER_ID || "test-user";
const guildId = process.env.GUILD_ID;
const botUserId = process.env.BOT_USER_ID; // optional: the bot's Discord user ID

// Patch DatabaseTools to log all tool executions
function patchDatabaseTools() {
  const ai = AIManager.getInstance();
  const originalExecuteTool = ai.databaseTools.executeTool.bind(ai.databaseTools);
  
  let toolCallCount = 0;
  
  ai.databaseTools.executeTool = async function(toolName: string, args: any, context: any) {
    toolCallCount++;
    const callNum = toolCallCount;
    
    console.log("\n" + "=".repeat(80));
    console.log(`🔧 TOOL CALL #${callNum}: ${toolName}`);
    console.log("=".repeat(80));
    console.log("\n📥 Arguments:");
    console.log(JSON.stringify(args, null, 2));
    
    const startTime = Date.now();
    const result = await originalExecuteTool(toolName, args, context);
    const duration = Date.now() - startTime;
    
    console.log(`\n⏱️  Duration: ${duration}ms`);
    console.log("\n📤 Result:");
    
    // Pretty print the result
    if (typeof result === "object") {
      if (result.success) {
        console.log("✅ Success");
        if (result.summary) {
          console.log("\n📝 Summary:");
          console.log(result.summary);
        }
        if (result.data) {
          console.log("\n📊 Data:");
          // Truncate long data for readability
          const dataStr = JSON.stringify(result.data, null, 2);
          if (dataStr.length > 1000) {
            console.log(dataStr.substring(0, 1000) + "\n... [truncated " + (dataStr.length - 1000) + " chars]");
          } else {
            console.log(dataStr);
          }
        }
      } else {
        console.log("❌ Failed");
        if (result.error) {
          console.log("\n⚠️  Error:", result.error);
        }
      }
    } else {
      console.log(result);
    }
    
    return result;
  };
}

// Patch provider to log API calls
async function patchProvider(providerName: string) {
  const ai = AIManager.getInstance();
  const provider = (ai as any).getProvider(providerName);
  
  if (provider.callTextAPIWithTools) {
    const originalCall = provider.callTextAPIWithTools.bind(provider);
    let apiCallCount = 0;
    
    provider.callTextAPIWithTools = async function(
      systemPrompt: string,
      userPrompt: string,
      tools: any[],
      toolResults?: any[],
      runtimeConfig?: any
    ) {
      apiCallCount++;
      
      console.log("\n" + "█".repeat(80));
      console.log(`🤖 AI API CALL #${apiCallCount}`);
      console.log("█".repeat(80));
      console.log("\n📋 System Prompt Length:", systemPrompt.length, "chars");
      console.log("📋 User Prompt Length:", userPrompt.length, "chars");
      
      if (apiCallCount === 1) {
        console.log("\n💭 User Prompt Preview (first 500 chars):");
        console.log(userPrompt.substring(0, 500));
        if (userPrompt.length > 500) console.log("... [truncated]");
      }
      
      console.log("\n🔧 Tools Available:", tools.length);
      console.log("Tools:", tools.map(t => t.name).join(", "));
      
      if (toolResults && toolResults.length > 0) {
        console.log("\n📦 Tool Results Provided:", toolResults.length);
        toolResults.forEach((tr, idx) => {
          console.log(`  ${idx + 1}. ${tr.name}: ${tr.content.substring(0, 100)}${tr.content.length > 100 ? "..." : ""}`);
        });
      }
      
      const startTime = Date.now();
      const result = await originalCall(systemPrompt, userPrompt, tools, toolResults, runtimeConfig);
      const duration = Date.now() - startTime;
      
      console.log(`\n⏱️  API Duration: ${duration}ms`);
      
      if (result.toolCalls && result.toolCalls.length > 0) {
        console.log("\n🎯 AI Requested Tools:");
        result.toolCalls.forEach((tc: ToolCall, idx: number) => {
          console.log(`  ${idx + 1}. ${tc.name}`);
          console.log(`     Args:`, JSON.stringify(tc.arguments).substring(0, 150));
        });
      } else {
        console.log("\n💬 AI Provided Final Response");
        console.log("Response length:", result.content.length, "chars");
        if (apiCallCount > 1) {
          console.log("\nResponse preview (first 200 chars):");
          console.log(result.content.substring(0, 200));
          if (result.content.length > 200) console.log("... [truncated]");
        }
      }
      
      return result;
    };
  }
}

async function main() {
  console.log("\n" + "🔍".repeat(40));
  console.log("🔍 AI ASSISTANT DEBUG MODE");
  console.log("🔍".repeat(40));
  console.log(`\n⚙️  Provider: ${provider}`);
  console.log(`⚙️  Guild ID: ${guildId}`);
  console.log(`⚙️  User ID: ${userId}`);
  console.log(`⚙️  Input: "${input}"\n`);

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

  // Patch before creating AI manager
  patchDatabaseTools();
  await patchProvider(provider);

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

  console.log(`📝 Processed prompt: "${rawForAI}"\n`);

  const ai = AIManager.getInstance();
  const overallStart = Date.now();
  
  await ai.runWithGuildContext(guildId, async () => {
    // Use generateText in guild context so AIManager routes to generateWithTools
    const res = await ai.generateText(rawForAI, userId, provider, {
      persona: "casual",
      useDiscordFormatting: false,
    });
    
    const overallDuration = Date.now() - overallStart;
    
    console.log("\n" + "═".repeat(80));
    console.log("🎉 FINAL RESULT");
    console.log("═".repeat(80));
    console.log(`\n⏱️  Total Duration: ${overallDuration}ms (${(overallDuration / 1000).toFixed(2)}s)`);
    
    if (!res.success) {
      console.error("\n❌ Error:", res.error || "Unknown error");
      process.exit(1);
    }
    
    console.log("\n✅ Success!");
    console.log("\n💬 AI Response:");
    console.log("─".repeat(80));
    console.log(res.content);
    console.log("─".repeat(80));
    console.log(`\nResponse length: ${res.content.length} chars`);
  });
}

main().catch((err) => {
  console.error("\n💥 Uncaught error:", err);
  process.exit(1);
});
