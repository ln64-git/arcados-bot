import "dotenv/config";
import { AIManager } from "../AIManager";
import { PostgreSQLManager } from "../../../database/PostgreSQLManager";

// CLI inputs
const toolName = process.argv[2];
const guildId = process.env.GUILD_ID;
const userId = process.env.USER_ID || "test-user";
const channelId = process.env.CHANNEL_ID;
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

// Parse tool arguments from remaining CLI args
// Format: key=value key2=value2 OR positional userId for convenience
const toolArgs: Record<string, any> = {};
const positionalArgs: string[] = [];

for (let i = 3; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg) {
    continue;
  }
  
  // Skip flag arguments
  if (arg === "--verbose" || arg === "-v") continue;
  
  const match = arg.match(/^([^=]+)=(.+)$/);
  if (match) {
    const key = match[1]!;
    const rawValue = match[2]!;
    // Try to parse as JSON, otherwise use as string
    try {
      toolArgs[key] = JSON.parse(rawValue);
    } catch {
      toolArgs[key] = rawValue;
    }
  } else {
    // Positional argument
    positionalArgs.push(arg);
  }
}

// If there's a positional arg and no userId set, treat first positional as userId
if (positionalArgs.length > 0 && !toolArgs.userId) {
  toolArgs.userId = positionalArgs[0];
}

// Helper function to condense data for display
function condenseData(data: any, toolName: string): any {
  if (!data || typeof data !== "object") return data;
  
  // For user info tools, show condensed relationship data
  if (toolName === "getUserInfo") {
    const condensed: any = {};
    
    if (data.richContext) {
      const rc = data.richContext;
      condensed.user = {
        displayName: rc.displayName,
        username: rc.username,
        globalName: rc.globalName,
        joinedAt: rc.joinedAt,
        messageCount: rc.messageCount,
        roleCount: rc.roleCount,
        active: rc.active,
      };
      
      // Deduplicate and show top 5 relationships
      if (rc.relationshipNetwork && Array.isArray(rc.relationshipNetwork)) {
        const seenUsers = new Set();
        const uniqueRelationships = rc.relationshipNetwork
          .filter((r: any) => {
            if (seenUsers.has(r.user_id)) return false;
            seenUsers.add(r.user_id);
            return true;
          })
          .slice(0, 5)
          .map((r: any) => ({
            name: r.display_name,
            affinity: `${r.affinity_percentage.toFixed(1)}%`,
            interactions: r.interaction_count,
          }));
        condensed.topRelationships = uniqueRelationships;
      }
      
      if (rc.summary) condensed.summary = rc.summary;
      if (rc.keywords && rc.keywords.length > 0) condensed.keywords = rc.keywords.slice(0, 5);
      if (rc.notes && rc.notes.length > 0) condensed.notes = rc.notes.slice(0, 3);
    }
    
    return condensed;
  }
  
  // For getHolisticUserContext, condense similarly
  if (toolName === "getHolisticUserContext") {
    const condensed: any = {};
    
    if (data.user) {
      condensed.user = {
        displayName: data.user.display_name,
        username: data.user.username,
        messageCount: data.messageCount,
      };
    }
    
    if (data.relationships && Array.isArray(data.relationships)) {
      condensed.topRelationships = data.relationships.slice(0, 5).map((r: any) => ({
        name: r.display_name || r.username,
        affinity: `${r.affinity_percentage?.toFixed(1) || 0}%`,
        interactions: r.interaction_count || 0,
      }));
    }
    
    if (data.recentMessages && Array.isArray(data.recentMessages)) {
      condensed.recentMessageCount = data.recentMessages.length;
      condensed.recentMessageSample = data.recentMessages.slice(0, 3).map((m: any) => ({
        channel: m.channel_name,
        preview: m.content?.substring(0, 50) + (m.content?.length > 50 ? "..." : ""),
        timestamp: m.created_at,
      }));
    }
    
    if (data.summary) condensed.summary = data.summary;
    
    return condensed;
  }
  
  // For message/conversation tools, limit message arrays
  if (Array.isArray(data)) {
    if (data.length > 10) {
      return {
        count: data.length,
        sample: data.slice(0, 5).map((item: any) => {
          if (item.content) {
            return {
              ...item,
              content: item.content.substring(0, 100) + (item.content.length > 100 ? "..." : ""),
            };
          }
          return item;
        }),
        note: `Showing first 5 of ${data.length} items. Use --verbose to see all.`,
      };
    }
  }
  
  return data;
}

async function listAllTools() {
  const ai = AIManager.getInstance();
  const tools = ai.databaseTools.toGrokFunctions();
  
  console.log("\n📋 Available Tools:\n");
  
  // Group tools by category
  type ToolDefinition = (typeof tools)[number];
  type CategoryName =
    | "User Tools"
    | "Relationship Tools"
    | "Conversation Tools"
    | "Message Tools"
    | "Server Tools"
    | "Context Tools"
    | "Analysis Tools"
    | "Live Conversation Tools"
    | "Drama Analysis Tools"
    | "Semantic Search Tools"
    | "Storyline Tools"
    | "Other";

  const categories: Record<CategoryName, ToolDefinition[]> = {
    "User Tools": [],
    "Relationship Tools": [],
    "Conversation Tools": [],
    "Message Tools": [],
    "Server Tools": [],
    "Context Tools": [],
    "Analysis Tools": [],
    "Live Conversation Tools": [],
    "Drama Analysis Tools": [],
    "Semantic Search Tools": [],
    "Storyline Tools": [],
    "Other": [],
  };
  
  for (const tool of tools) {
    const name = tool.name;
    if (name.includes("User") || name.includes("user")) {
      categories["User Tools"].push(tool);
    } else if (name.includes("Relationship") || name.includes("relationship")) {
      categories["Relationship Tools"].push(tool);
    } else if (name.includes("Conversation") || name.includes("conversation")) {
      categories["Conversation Tools"].push(tool);
    } else if (name.includes("Message") || name.includes("message")) {
      categories["Message Tools"].push(tool);
    } else if (name.includes("Server") || name.includes("server") || name.includes("Guild")) {
      categories["Server Tools"].push(tool);
    } else if (name.includes("Context") || name.includes("context")) {
      categories["Context Tools"].push(tool);
    } else if (name.includes("Analysis") || name.includes("analyze")) {
      categories["Analysis Tools"].push(tool);
    } else if (name.includes("Live") || name.includes("live")) {
      categories["Live Conversation Tools"].push(tool);
    } else if (name.includes("Drama") || name.includes("drama")) {
      categories["Drama Analysis Tools"].push(tool);
    } else if (name.includes("Semantic") || name.includes("search")) {
      categories["Semantic Search Tools"].push(tool);
    } else if (name.includes("Storyline") || name.includes("storyline")) {
      categories["Storyline Tools"].push(tool);
    } else {
      categories["Other"].push(tool);
    }
  }
  
  for (const [category, categoryTools] of Object.entries(categories)) {
    if (categoryTools.length === 0) continue;
    
    console.log(`\n${category}:`);
    for (const tool of categoryTools) {
      console.log(`  • ${tool.name}`);
      console.log(`    ${tool.description}`);
    }
  }
  
  console.log(`\nTotal: ${tools.length} tools`);
  console.log("\nUsage:");
  console.log("  npm run test:tool -- <toolName> [args...] [--verbose]");
  console.log("\nExamples:");
  console.log('  npm run test:tool -- getUserInfo 123456789');
  console.log('  npm run test:tool -- getUserInfo userId=123456789 --verbose');
  console.log('  npm run test:tool -- getHolisticUserContext userId=123456789 lookbackDays=7');
  console.log('  npm run test:tool -- searchMessagesBySemantic query="funny memes" limit=5');
  console.log("\nFlags:");
  console.log("  --verbose, -v  Show full data output (default: condensed)");
  console.log("\nEnvironment Variables:");
  console.log("  GUILD_ID    - Required for most tools");
  console.log("  USER_ID     - User making the request (default: test-user)");
  console.log("  CHANNEL_ID  - Optional channel context");
}

async function getToolInfo(toolName: string) {
  const ai = AIManager.getInstance();
  const tools = ai.databaseTools.toGrokFunctions();
  const tool = tools.find(t => t.name === toolName);
  
  if (!tool) {
    console.error(`\n❌ Tool '${toolName}' not found`);
    console.log("\nRun without arguments to see all available tools.");
    process.exit(1);
  }
  
  console.log("\n📋 Tool Information:\n");
  console.log(`Name: ${tool.name}`);
  console.log(`Description: ${tool.description}`);
  console.log("\nParameters:");
  
  if (tool.parameters?.properties) {
    const props = tool.parameters.properties;
    const required = tool.parameters.required || [];
    
    for (const [key, value] of Object.entries(props)) {
      const prop = value as any;
      const isRequired = required.includes(key);
      const requiredTag = isRequired ? " (required)" : " (optional)";
      console.log(`  • ${key}${requiredTag}`);
      if (prop.description) {
        console.log(`    ${prop.description}`);
      }
      if (prop.type) {
        console.log(`    Type: ${prop.type}`);
      }
      if (prop.default !== undefined) {
        console.log(`    Default: ${prop.default}`);
      }
    }
  } else {
    console.log("  No parameters");
  }
  
  console.log("\nExample usage:");
  console.log(`  npm run test:tool -- ${toolName} ${Object.keys(tool.parameters?.properties || {}).slice(0, 2).map(k => `${k}=value`).join(" ")}`);
}

async function testTool() {
  if (!toolName) {
    await listAllTools();
    return;
  }
  
  // Check if user wants info about a specific tool
  if (Object.keys(toolArgs).length === 0 && process.argv.length === 3) {
    await getToolInfo(toolName);
    return;
  }
  
  if (!guildId) {
    console.error("❌ GUILD_ID environment variable is required");
    console.log("\nExample:");
    console.log(`  GUILD_ID=123456789 npm run test:tool -- ${toolName} ${Object.keys(toolArgs).map(k => `${k}=${toolArgs[k]}`).join(" ")}`);
    process.exit(1);
  }
  
  console.log("\n🧪 Testing Tool\n");
  console.log(`Tool: ${toolName}`);
  console.log(`Guild ID: ${guildId}`);
  console.log(`User ID: ${userId}`);
  if (channelId) console.log(`Channel ID: ${channelId}`);
  console.log("\nArguments:");
  console.log(JSON.stringify(toolArgs, null, 2));
  
  const ai = AIManager.getInstance();
  const db = new PostgreSQLManager();
  
  // Connect to database
  const connected = await db.connect();
  if (!connected) {
    console.error("❌ Failed to connect to database");
    console.log("Check your POSTGRES_URL environment variable");
    process.exit(1);
  }
  
  console.log("\n⏳ Executing tool...\n");
  
  const startTime = Date.now();
  
  try {
    const result = await ai.databaseTools.executeTool(
      toolName,
      toolArgs,
      { userId, guildId, db, channelId }
    );
    
    const duration = Date.now() - startTime;
    
    console.log("═".repeat(80));
    console.log("📤 Result");
    console.log("═".repeat(80));
    console.log(`\n⏱️  Duration: ${duration}ms\n`);
    
    if (typeof result === "object") {
      if (result.success) {
        console.log("✅ Success\n");
        
        if (result.summary) {
          console.log("📝 Summary:");
          console.log(result.summary);
          console.log();
        }
        
        if (result.data) {
          console.log("📊 Data:");
          
          // Use condensed view unless verbose flag is set
          const displayData = verbose ? result.data : condenseData(result.data, toolName);
          const dataStr = JSON.stringify(displayData, null, 2);
          
          if (verbose) {
            // Verbose mode: show everything but truncate if too long
            if (dataStr.length > 5000) {
              console.log(dataStr.substring(0, 5000));
              console.log(`\n... [truncated ${dataStr.length - 5000} characters]`);
              console.log(`\nFull data length: ${dataStr.length} characters`);
            } else {
              console.log(dataStr);
            }
          } else {
            // Condensed mode: show key info only
            console.log(dataStr);
            const originalSize = JSON.stringify(result.data).length;
            if (originalSize > dataStr.length) {
              console.log(`\n💡 Tip: Use --verbose flag to see full data (${originalSize} chars total)`);
            }
          }
        }
      } else {
        console.log("❌ Failed\n");
        if (result.error) {
          console.error("Error:", result.error);
        }
        if (result.data) {
          console.log("\nPartial data:");
          console.log(JSON.stringify(result.data, null, 2));
        }
      }
    } else {
      console.log(result);
    }
  } catch (error) {
    console.error("\n💥 Error executing tool:");
    console.error(error);
    await db.disconnect();
    process.exit(1);
  } finally {
    // Close database connection
    await db.disconnect();
  }
}

testTool().catch((err) => {
  console.error("\n💥 Uncaught error:", err);
  process.exit(1);
});
