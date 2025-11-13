import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { DatabaseTools } from "../features/ai-assistant/DatabaseTools";
import { dramaAnalysisTools } from "../features/ai-assistant/tools/DramaAnalysisTools";

async function testDramaTool() {
	console.log("🧪 Testing Drama Detection Tool Directly...\n");

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

	// Initialize database tools
	const dbTools = new DatabaseTools();
	dbTools.registerTools(dramaAnalysisTools);

	// Execute the drama detection tool directly
	console.log("🔍 Executing detectDramaEvents tool directly...\n");

	try {
		const result = await dbTools.executeTool(
			"detectDramaEvents",
			{
				lookbackHours: 168, // 7 days
				minInteractions: 10,
				maxAffinityPercent: 30,
				limit: 5,
			},
			{
				userId: "test-user-id",
				guildId: guildId,
				db: db,
			}
		);

		console.log("📤 Tool Result:");
		console.log("=".repeat(80));

		if (typeof result === "string") {
			console.log(result);
		} else if (result.success) {
			console.log("Summary:", result.summary);
			console.log("\nFormatted Output:");
			console.log(result.formatted);
			console.log("\nRaw Data:");
			console.log(JSON.stringify(result.data, null, 2));
		} else {
			console.error("❌ Error:", result.error);
		}

		console.log("=".repeat(80));
	} catch (error) {
		console.error("❌ Test failed:", error);
	}

	// Clean up
	await db.disconnect();
	process.exit(0);
}

testDramaTool();
