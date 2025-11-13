import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { AIManager } from "../features/ai-assistant/AIManager";

async function testDramaDetection() {
	console.log("🧪 Testing Drama Detection Tool...\n");

	// Initialize database
	const db = new PostgreSQLManager();
	await db.connect();

	if (!db.isConnected()) {
		console.error("❌ Database connection failed");
		process.exit(1);
	}

	// Get guild ID from environment or use default
	const guildId = process.env.GUILD_ID || "1254694808228986912";
	console.log(`📍 Testing with Guild ID: ${guildId}\n`);

	// Initialize AI Manager
	const aiManager = AIManager.getInstance();

	// Test the drama detection with a gossip query
	console.log("🔍 Testing query: 'give me gossip'\n");

	try {
		const response = await aiManager.runWithGuildContext(guildId, async () => {
			return await aiManager.generateText(
				"give me gossip",
				"test-user-id",
				"grok",
				{
					persona: "casual",
					useDiscordFormatting: false,
					mode: "chat",
				}
			);
		});

		console.log("📤 AI Response:");
		console.log("=".repeat(80));
		if (response.success) {
			console.log(response.content);
		} else {
			console.error("❌ Error:", response.error);
		}
		console.log("=".repeat(80));
	} catch (error) {
		console.error("❌ Test failed:", error);
	}

	// Clean up
	await db.disconnect();
	process.exit(0);
}

testDramaDetection();
