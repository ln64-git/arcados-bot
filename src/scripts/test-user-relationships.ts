import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { AIManager } from "../features/ai-assistant/AIManager";

async function testUserRelationships() {
	console.log("🧪 Testing User Relationship Display...\n");

	// Initialize database
	const db = new PostgreSQLManager();
	await db.connect();

	if (!db.isConnected()) {
		console.error("❌ Database connection failed");
		process.exit(1);
	}

	// Get guild ID from environment or use default
	const guildId = process.env.GUILD_ID || "1254694808228986912";
	const userId = "515503587762241538"; // Cela (@deesnuts)
	console.log(`📍 Testing with Guild ID: ${guildId}`);
	console.log(`👤 Testing with User ID: ${userId}\n`);

	// Initialize AI Manager
	const aiManager = AIManager.getInstance();

	// Test user info query that should show relationships
	console.log(`🔍 Testing query: 'tell me about <@${userId}>'\n`);

	try {
		const response = await aiManager.runWithGuildContext(guildId, async () => {
			return await aiManager.generateText(
				`tell me about <@${userId}>`,
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

			// Check for mention tags in the response
			const mentionTags = response.content.match(/<@!?\d+>/g);
			if (mentionTags && mentionTags.length > 0) {
				console.log("\n❌ FAILURE: Response contains raw mention tags:");
				for (const tag of mentionTags) {
					console.log(`   - ${tag}`);
				}
			} else {
				console.log("\n✅ SUCCESS: No raw mention tags found in response");
			}
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

testUserRelationships();
