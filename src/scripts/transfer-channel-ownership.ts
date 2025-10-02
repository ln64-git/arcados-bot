#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";

/**
 * Script to transfer channel ownership between users
 */
async function transferChannelOwnership(
	channelId: string,
	fromUserId: string,
	toUserId: string,
) {
	console.log(`🔄 Transferring ownership for channel: ${channelId}\n`);

	try {
		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Transferring ownership in guild: ${config.guildId}\n`);

		// Get current owner
		const currentOwner = await cache.getChannelOwner(channelId);
		if (!currentOwner) {
			console.log("🔸 No current owner found");
			return;
		}

		if (currentOwner.userId !== fromUserId) {
			console.log(
				`🔸 Current owner (${currentOwner.userId}) doesn't match expected owner (${fromUserId})`,
			);
			return;
		}

		console.log(`👤 Current owner: ${fromUserId}`);
		console.log(`👤 New owner: ${toUserId}`);
		console.log(
			`📅 Current owner since: ${currentOwner.createdAt.toLocaleString()}`,
		);

		// Transfer ownership
		await cache.setChannelOwner(channelId, {
			userId: toUserId,
			channelId,
			guildId: config.guildId,
			createdAt: currentOwner.createdAt, // Keep original creation time
			lastActivity: new Date(),
			previousOwnerId: fromUserId, // Track the previous owner
		});

		console.log(`✅ Ownership transferred successfully!`);

		console.log(`\n📋 TRANSFER DETAILS:`);
		console.log("=".repeat(50));
		console.log(`👤 Previous owner: ${fromUserId}`);
		console.log(`👤 New owner: ${toUserId}`);
		console.log(`📅 Transferred: ${new Date().toLocaleString()}`);
		console.log(`📝 Channel: ${channelId}`);

		console.log(`\n💡 The new owner can now:`);
		console.log(`- Use /rename to change the channel name`);
		console.log(`- Use /limit to set user limits`);
		console.log(`- Use /lock to lock/unlock the channel`);
		console.log(`- Use moderation commands like /kick, /mute, etc.`);
	} catch (error) {
		console.error("🔸 Error transferring ownership:", error);
		process.exit(1);
	}
}

// Get arguments from command line
const channelId = process.argv[2];
const fromUserId = process.argv[3];
const toUserId = process.argv[4];

if (!channelId || !fromUserId || !toUserId) {
	console.error("🔸 Please provide all required arguments");
	console.log(
		"Usage: tsx transfer-channel-ownership.ts <channelId> <fromUserId> <toUserId>",
	);
	process.exit(1);
}

// Run the script
transferChannelOwnership(channelId, fromUserId, toUserId)
	.then(() => {
		console.log("\n✅ Ownership transfer completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Ownership transfer failed:", error);
		process.exit(1);
	});
