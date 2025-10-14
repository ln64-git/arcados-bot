import { config } from "../config";
import { DatabaseCore } from "../features/database-manager/PostgresCore";

async function checkChannelPositions() {
	console.log("🔍 Checking channel positions in database...");
	
	const guildId = "1254694808228986912";
	
	try {
		const dbCore = new DatabaseCore();
		
		// Get all active channels using the proper method
		console.log("📊 All active channels:");
		const channels = await dbCore.getActiveChannels(guildId);
		
		console.log(`Total channels found: ${channels.length}`);
		
		for (const channel of channels) {
			console.log(`\n📺 Position ${channel.position}:`);
			console.log(`  Name: ${channel.channelName}`);
			console.log(`  ID: ${channel.discordId}`);
			console.log(`  Active: ${channel.isActive}`);
			console.log(`  Members: ${channel.memberCount}`);
			console.log(`  Created: ${channel.createdAt}`);
			console.log(`  Updated: ${channel.updatedAt}`);
		}
		
		// Check specifically for AFK channel
		const afkChannel = channels.find(ch => 
			ch.channelName?.toLowerCase().includes('afk')
		);
		
		if (afkChannel) {
			console.log(`\n🎯 AFK Channel Details:`);
			console.log(`  Name: ${afkChannel.channelName}`);
			console.log(`  Position: ${afkChannel.position}`);
			console.log(`  ID: ${afkChannel.discordId}`);
			console.log(`  Active: ${afkChannel.isActive}`);
			
			// Check if there are duplicate positions
			const samePositionChannels = channels.filter(ch => 
				ch.position === afkChannel.position && ch.discordId !== afkChannel.discordId
			);
			
			if (samePositionChannels.length > 0) {
				console.log(`\n⚠️  Duplicate Position ${afkChannel.position}:`);
				for (const ch of samePositionChannels) {
					console.log(`  - ${ch.channelName} (${ch.discordId})`);
				}
			}
		} else {
			console.log(`\n❌ AFK channel not found in database`);
		}
		
		// Check for position gaps or duplicates
		console.log(`\n🔍 Position Analysis:`);
		const positions = channels.map(ch => ch.position).sort((a, b) => a - b);
		console.log(`Positions: ${positions.join(', ')}`);
		
		const duplicates = positions.filter((pos, index) => positions.indexOf(pos) !== index);
		if (duplicates.length > 0) {
			console.log(`⚠️  Duplicate positions found: ${[...new Set(duplicates)].join(', ')}`);
		}
		
		const gaps = [];
		for (let i = 0; i < positions.length - 1; i++) {
			if (positions[i + 1] - positions[i] > 1) {
				gaps.push(`${positions[i]} -> ${positions[i + 1]}`);
			}
		}
		if (gaps.length > 0) {
			console.log(`⚠️  Position gaps found: ${gaps.join(', ')}`);
		}
		
	} catch (error) {
		console.error("❌ Position check failed:", error);
	}
}

checkChannelPositions().catch(console.error);