import { executeQuery } from "../features/database-manager/PostgresConnection";
import { DatabaseCore } from "../features/database-manager/PostgresCore";

async function checkChannelPositions() {
	const dbCore = new DatabaseCore();
	await dbCore.initialize();

	try {
		console.log("🔍 Checking channel positions...");

		// Get all channels with their positions
		const channels = await executeQuery(`
			SELECT discord_id, channel_name, position, guild_id
			FROM channels 
			WHERE is_active = TRUE
			ORDER BY guild_id, position
		`);

		console.log(`Found ${channels.length} active channels:`);
		console.log("=".repeat(80));

		let currentGuild = "";
		for (const channel of channels) {
			const guildId = channel.guildId || "unknown";
			const channelName = channel.channelName || "unknown";
			const position = channel.position || 0;
			const discordId = channel.discordId || "unknown";

			if (guildId !== currentGuild) {
				currentGuild = guildId;
				console.log(`\nGuild: ${guildId}`);
				console.log("-".repeat(40));
			}
			console.log(
				`  ${channelName.padEnd(30)} | Position: ${position.toString().padStart(3)} | ID: ${discordId}`,
			);
		}

		// Check for duplicate positions within each guild
		console.log("\n🔍 Checking for duplicate positions...");
		const duplicates = await executeQuery(`
			SELECT guild_id, position, COUNT(*) as count
			FROM channels 
			WHERE is_active = TRUE
			GROUP BY guild_id, position
			HAVING COUNT(*) > 1
			ORDER BY guild_id, position
		`);

		if (duplicates.length > 0) {
			console.log("❌ Found duplicate positions:");
			for (const dup of duplicates) {
				console.log(
					`  Guild ${dup.guild_id}: Position ${dup.position} has ${dup.count} channels`,
				);
			}
		} else {
			console.log("✅ No duplicate positions found");
		}

		// Check for gaps in positions
		console.log("\n🔍 Checking for position gaps...");
		const gaps = await executeQuery(`
			WITH guild_positions AS (
				SELECT guild_id, position, 
					   LAG(position) OVER (PARTITION BY guild_id ORDER BY position) as prev_position
				FROM channels 
				WHERE is_active = TRUE
			)
			SELECT guild_id, position, prev_position
			FROM guild_positions
			WHERE prev_position IS NOT NULL AND position - prev_position > 1
			ORDER BY guild_id, position
		`);

		if (gaps.length > 0) {
			console.log("⚠️ Found position gaps:");
			for (const gap of gaps) {
				console.log(
					`  Guild ${gap.guild_id}: Gap between position ${gap.prev_position} and ${gap.position}`,
				);
			}
		} else {
			console.log("✅ No position gaps found");
		}
	} catch (error) {
		console.error("❌ Error checking channel positions:", error);
	}
}

checkChannelPositions().catch(console.error);
