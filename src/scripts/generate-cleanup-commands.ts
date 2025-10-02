#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";
import type { VoiceSession } from "../types/database.js";

/**
 * Script to generate Discord slash commands for cleaning up dangerous permissions
 * This creates a list of commands you can run to clean up all previous channel owners
 */
async function generateCleanupCommands() {
	console.log("🔧 Generating cleanup commands for dangerous permissions...\n");

	try {
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		console.log(`📈 Found ${allSessions.length} total voice sessions\n`);

		// Group sessions by channel ID to identify ownership transfers
		const channelOwnershipMap = new Map<string, Set<string>>(); // channelId -> Set<userId>
		for (const session of allSessions) {
			if (!channelOwnershipMap.has(session.channelId)) {
				channelOwnershipMap.set(session.channelId, new Set<string>());
			}
			const owners = channelOwnershipMap.get(session.channelId);
			if (owners) {
				owners.add(session.userId);
			}
		}

		const channelsWithMultipleOwners = Array.from(
			channelOwnershipMap.entries(),
		).filter(([_channelId, owners]) => owners.size > 1);

		console.log(
			`🔍 Found ${channelsWithMultipleOwners.length} channels with ownership transfers\n`,
		);

		// Collect all unique users who were previous owners
		const allPreviousOwners = new Set<string>();
		for (const [_channelId, owners] of channelsWithMultipleOwners) {
			for (const userId of owners) {
				allPreviousOwners.add(userId);
			}
		}

		console.log(
			`👥 Found ${allPreviousOwners.size} unique users who were channel owners\n`,
		);

		// Generate cleanup commands
		console.log("📋 DISCORD SLASH COMMANDS TO RUN:\n");
		console.log("=".repeat(80));
		console.log(
			"Copy and paste these commands in Discord (replace USER_ID with actual user IDs):\n",
		);

		const sortedUsers = Array.from(allPreviousOwners).sort();
		let commandCount = 0;

		for (const userId of sortedUsers) {
			commandCount++;
			console.log(
				`${commandCount}. /cleanup-permissions user:<@${userId}> dry-run:true`,
			);
		}

		console.log("\n" + "=".repeat(80));
		console.log("📝 INSTRUCTIONS:");
		console.log(
			"1. First run all commands with dry-run:true to see what would be changed",
		);
		console.log("2. Review the results and confirm they look correct");
		console.log(
			"3. Run the same commands again with dry-run:false to actually clean up",
		);
		console.log("4. Or run: /cleanup-permissions user:@username dry-run:false");

		console.log(
			"\n🔧 BULK CLEANUP COMMANDS (if you have a bot with admin access):\n",
		);
		console.log("=".repeat(80));

		// Generate a script that could be run by a bot with admin access
		console.log("// Run this in a bot with admin permissions:");
		console.log("const dangerousPermissions = [");
		console.log("  PermissionFlagsBits.MoveMembers,");
		console.log("  PermissionFlagsBits.MuteMembers,");
		console.log("  PermissionFlagsBits.DeafenMembers,");
		console.log("  PermissionFlagsBits.ManageRoles,");
		console.log("];");
		console.log("");
		console.log("const usersToCleanup = [");

		for (const userId of sortedUsers.slice(0, 10)) {
			// Show first 10 as example
			console.log(`  '${userId}',`);
		}
		if (sortedUsers.length > 10) {
			console.log(`  // ... and ${sortedUsers.length - 10} more users`);
		}
		console.log("];");
		console.log("");
		console.log("for (const userId of usersToCleanup) {");
		console.log("  const member = await guild.members.fetch(userId);");
		console.log("  await member.roles.set(");
		console.log(
			"    member.roles.cache.filter(role => !role.permissions.has(dangerousPermissions)),",
		);
		console.log(
			"    'Cleaning up dangerous permissions from previous channel owner'",
		);
		console.log("  );");
		console.log("}");

		console.log("\n⚠️  SECURITY NOTES:");
		console.log(
			"• Only run these commands if you're sure the users shouldn't have these permissions",
		);
		console.log("• Always test with dry-run:true first");
		console.log(
			"• These permissions should only be given to actual moderators/admins",
		);
		console.log(
			"• The bot has already been fixed to prevent future permission escalation",
		);

		console.log("\n✅ Command generation completed!\n");
	} catch (error) {
		console.error("🔸 Error generating cleanup commands:", error);
	} finally {
		console.log("📋 Next steps:");
		console.log("1. Register the cleanup-permissions command in your bot");
		console.log(
			"2. Run the generated commands to clean up dangerous permissions",
		);
		console.log("3. Monitor your server for any permission-related issues");
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	generateCleanupCommands().catch(console.error);
}
