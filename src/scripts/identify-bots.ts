import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function identifyBots() {
	const db = new PostgreSQLManager();

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect");
			return;
		}

		const guildId = process.argv[2] || process.env.GUILD_ID;
		if (!guildId) {
			console.error("🔸 Usage: npx tsx src/scripts/identify-bots.ts <guild_id>");
			return;
		}

		console.log(`\n🔹 Finding bot users in guild ${guildId}...\n`);

		// Query for members with bot flag
		const result = await db.query(
			`
			SELECT DISTINCT
				user_id as id,
				username,
				bot
			FROM members
			WHERE guild_id = $1 AND bot = true
			ORDER BY username ASC
			`,
			[guildId]
		);

		if (result.success && result.data) {
			console.log("🤖 Identified Bot Users:\n");
			console.log("User ID                | Username            | Messages");
			console.log("─".repeat(60));

			const botIds: string[] = [];
			for (const member of result.data) {
				console.log(
					`${member.id.padEnd(22)} | ${member.username.substring(0, 18).padEnd(18)}`
				);
				botIds.push(member.id);
			}

			console.log("\n📋 Bot IDs for filtering:\n");
			console.log("Add this to your scripts as BOT_USER_IDS:");
			console.log(`const BOT_USER_IDS = [${botIds.map(id => `'${id}'`).join(', ')}];`);
		}

		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error:", error);
	}
}

identifyBots();
