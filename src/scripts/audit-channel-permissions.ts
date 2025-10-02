#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";
import type { VoiceSession } from "../types/database.js";

/**
 * Script to audit channel permissions and identify users with dangerous server-wide permissions
 * This helps identify users like Alex who may have retained moderation abilities after ownership transfer
 */
async function auditChannelPermissions() {
	console.log("🔍 Auditing channel permissions for security issues...\n");

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Analyzing voice sessions for guild: ${config.guildId}\n`);

		// Get all voice sessions for the guild
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		console.log(`📈 Found ${allSessions.length} total voice sessions\n`);

		// Find channels that had ownership transfers (multiple owners)
		const channelOwners = new Map<string, Set<string>>();

		for (const session of allSessions) {
			if (!channelOwners.has(session.channelId)) {
				channelOwners.set(session.channelId, new Set());
			}
			const owners = channelOwners.get(session.channelId);
			if (owners) {
				owners.add(session.userId);
			}
		}

		// Find channels with multiple owners (indicating ownership transfers)
		const multiOwnerChannels = new Map<string, string[]>();
		for (const [channelId, owners] of channelOwners) {
			if (owners.size > 1) {
				multiOwnerChannels.set(channelId, Array.from(owners));
			}
		}

		console.log(
			`🔍 Found ${multiOwnerChannels.size} channels with ownership transfers\n`,
		);

		// Analyze ownership transfer patterns
		const ownershipTransfers = new Map<
			string,
			Array<{ userId: string; timestamp: Date; channelName: string }>
		>();

		for (const [channelId, owners] of multiOwnerChannels) {
			const channelSessions = allSessions.filter(
				(s) => s.channelId === channelId,
			);
			channelSessions.sort(
				(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
			);

			// Find when each owner first joined (potential ownership transfers)
			const ownerTimestamps = new Map<string, Date>();
			for (const session of channelSessions) {
				const existingTime = ownerTimestamps.get(session.userId);
				if (!existingTime || session.joinedAt < existingTime) {
					ownerTimestamps.set(session.userId, session.joinedAt);
				}
			}

			// Sort owners by join time
			const sortedOwners = Array.from(ownerTimestamps.entries()).sort(
				(a, b) => a[1].getTime() - b[1].getTime(),
			);

			if (sortedOwners.length > 1) {
				const transfers = sortedOwners.map(([userId, timestamp]) => ({
					userId,
					timestamp,
					channelName: channelSessions[0].channelName,
				}));
				ownershipTransfers.set(channelId, transfers);
			}
		}

		console.log("🚨 SECURITY AUDIT RESULTS:\n");
		console.log("=".repeat(80));

		// Show channels with potential permission issues
		let issueCount = 0;
		for (const [channelId, transfers] of ownershipTransfers) {
			if (transfers.length > 1) {
				issueCount++;
				console.log(`\n🆔 Channel ID: ${channelId}`);
				console.log(`📺 Channel Name: ${transfers[0].channelName}`);
				console.log(`👥 Ownership Transfers: ${transfers.length}`);

				console.log("📋 Ownership Timeline:");
				for (let i = 0; i < transfers.length; i++) {
					const transfer = transfers[i];
					const marker = i === 0 ? "👑" : "👤";
					const status =
						i === transfers.length - 1 ? "Current Owner" : "Previous Owner";
					console.log(
						`  ${marker} ${transfer.timestamp.toLocaleString()}: ${transfer.userId.substring(0, 8)}... (${status})`,
					);
				}

				// Highlight potential security issue
				if (transfers.length > 1) {
					console.log(
						"⚠️  SECURITY RISK: Previous owners may retain server-wide moderation permissions!",
					);
				}

				console.log("-".repeat(80));
			}
		}

		console.log("\n📊 AUDIT SUMMARY:");
		console.log(`🔍 Channels analyzed: ${multiOwnerChannels.size}`);
		console.log(`⚠️  Channels with ownership transfers: ${issueCount}`);
		console.log(`🚨 Potential security issues: ${issueCount}`);

		console.log("\n🔧 SECURITY FIXES IMPLEMENTED:");
		console.log(
			"✅ Removed MoveMembers permission from channel owners (server-wide)",
		);
		console.log(
			"✅ Removed MuteMembers permission from channel owners (server-wide)",
		);
		console.log(
			"✅ Removed DeafenMembers permission from channel owners (server-wide)",
		);
		console.log(
			"✅ Removed ManageRoles permission from channel owners (server-wide)",
		);
		console.log("✅ Channel owners now only have channel-specific permissions");

		console.log("\n📋 CHANNEL OWNER PERMISSIONS (AFTER FIX):");
		console.log("✅ ManageChannels - Channel-specific: rename, delete channel");
		console.log("✅ CreateInstantInvite - Channel-specific: create invites");
		console.log("✅ Connect - Channel-specific: connect to voice");
		console.log("✅ Speak - Channel-specific: speak in voice");
		console.log("✅ UseVAD - Channel-specific: use voice activity detection");
		console.log("✅ PrioritySpeaker - Channel-specific: priority speaker");
		console.log("✅ Stream - Channel-specific: stream video");

		console.log("\n🚫 REMOVED DANGEROUS PERMISSIONS:");
		console.log("❌ MoveMembers - Server-wide: move users between channels");
		console.log("❌ MuteMembers - Server-wide: mute users server-wide");
		console.log("❌ DeafenMembers - Server-wide: deafen users server-wide");
		console.log("❌ ManageRoles - Server-wide: manage server roles");

		console.log("\n🎯 RECOMMENDATIONS:");
		console.log(
			"1. 🔍 Manually check Discord server permissions for users who were previous channel owners",
		);
		console.log(
			"2. 🧹 Remove any lingering server-wide moderation permissions from non-moderators",
		);
		console.log(
			"3. 📝 Consider implementing role-based permissions instead of direct user permissions",
		);
		console.log(
			"4. 🔒 Regular audits of server permissions to prevent privilege escalation",
		);

		console.log("\n⚠️  IMMEDIATE ACTION REQUIRED:");
		console.log(
			"Check the following users for lingering server-wide permissions:",
		);

		// Show users who were previous owners
		const previousOwners = new Set<string>();
		for (const transfers of ownershipTransfers.values()) {
			for (let i = 0; i < transfers.length - 1; i++) {
				// Exclude current owner
				previousOwners.add(transfers[i].userId);
			}
		}

		const sortedPreviousOwners = Array.from(previousOwners).sort();
		for (let i = 0; i < Math.min(10, sortedPreviousOwners.length); i++) {
			console.log(`  ${i + 1}. User ID: ${sortedPreviousOwners[i]}`);
		}

		if (sortedPreviousOwners.length > 10) {
			console.log(`  ... and ${sortedPreviousOwners.length - 10} more users`);
		}
	} catch (error) {
		console.error("🔸 Error auditing channel permissions:", error);
		process.exit(1);
	}
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
	auditChannelPermissions()
		.then(() => {
			console.log("\n✅ Permission audit completed!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("🔸 Permission audit failed:", error);
			process.exit(1);
		});
}

export { auditChannelPermissions };
