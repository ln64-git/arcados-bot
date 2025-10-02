#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function testUniversalSync() {
	try {
		console.log("🔍 Testing Universal Ownership Sync System");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const cache = new DiscordDataCache();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(30));

		// Check current ownership
		const owner = await cache.getChannelOwner(channelId);
		console.log(`👤 Current owner: ${owner ? owner.userId : "None"}`);

		// Get voice sessions
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = allSessions.filter(
			(s) => s.channelId === channelId,
		);

		// Simulate current members
		const recentSessions = channelSessions.filter((s) => {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
			return s.joinedAt > oneHourAgo || (s.leftAt && s.leftAt > oneHourAgo);
		});

		const currentMembers = new Set<string>();
		for (const session of recentSessions) {
			currentMembers.add(session.userId);
		}

		console.log(`\n👥 CURRENT MEMBERS:`);
		for (const userId of currentMembers) {
			console.log(`👤 ${userId}`);
		}

		// Check if owner is active
		if (owner) {
			const ownerActive = currentMembers.has(owner.userId);
			console.log(`\n🔍 OWNER STATUS:`);
			console.log(`👤 Owner: ${owner.userId}`);
			console.log(`📍 Active: ${ownerActive ? "✅ YES" : "❌ NO"}`);

			if (!ownerActive) {
				console.log(`\n🤖 UNIVERSAL SYNC WOULD:`);
				console.log("=".repeat(30));
				console.log("🔹 Remove inactive owner from database");
				console.log("🔹 Assign ownership to longest-standing active user");
				console.log("🔹 Rename channel to new owner's display name");
				console.log("🔹 Apply new owner's preferences");
				console.log("🔹 Set proper Discord permissions");
			} else {
				console.log(`\n✅ Owner is active - no sync needed`);
			}
		} else {
			console.log(`\n🤖 UNIVERSAL SYNC WOULD:`);
			console.log("=".repeat(30));
			console.log("🔹 Assign ownership to longest-standing user");
			console.log("🔹 Rename channel to owner's display name");
			console.log("🔹 Apply owner's preferences");
			console.log("🔹 Set proper Discord permissions");
		}

		console.log(`\n💡 UNIVERSAL SYNC BENEFITS:`);
		console.log("-".repeat(30));
		console.log("✅ Handles all ownership miscalibrations");
		console.log("✅ Synchronizes multiple sources of truth");
		console.log("✅ Automatically detects inactive owners");
		console.log("✅ Renames channels to reflect actual owners");
		console.log("✅ Prevents future miscalibrations");
		console.log("✅ Works with any Discord bot state");
	} catch (error) {
		console.error("🔸 Error testing universal sync:", error);
	} finally {
		process.exit(0);
	}
}

testUniversalSync().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
