import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

export const hideCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("hide")
		.setDescription("Hide your voice channel")
		.addBooleanOption((option) =>
			option
				.setName("unhide")
				.setDescription("Set to true to unhide instead")
				.setRequired(false),
		),

	async execute(interaction) {
		if (!interaction.guild || !interaction.member) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server.",
				ephemeral: true,
			});
			return;
		}

		const member = interaction.member;
		if (!("voice" in member)) {
			await interaction.reply({
				content: "🔸 This command requires a guild member.",
				ephemeral: true,
			});
			return;
		}

		const voiceChannel = member.voice.channel;

		if (!voiceChannel) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel to use this command.",
				ephemeral: true,
			});
			return;
		}

		// Get the voice state coordinator from the bot
		const bot = interaction.client as BotClient;
		const coordinator = bot.voiceStateCoordinator;

		if (!coordinator) {
			await interaction.reply({
				content: "🔸 Voice state coordinator is not available.",
				ephemeral: true,
			});
			return;
		}

		try {
			// Defer reply since permission updates can take time
			await interaction.deferReply({ ephemeral: false });

			// Check if user has ManageChannels permission OR is the registered owner
			const permissions = voiceChannel.permissionsFor(member);
			const hasManagePermission = permissions?.has("ManageChannels") ?? false;

			// Check if this is a registered user-owned channel
			const ownershipService = coordinator.getOwnershipService();
			const currentOwner = await ownershipService.getOwner(voiceChannel.id);
			const isRegisteredOwner = currentOwner === member.user.id;

			// User must either have ManageChannels permission OR be the registered owner
			if (!hasManagePermission && !isRegisteredOwner) {
				if (currentOwner) {
					await interaction.editReply({
						content: "🔸 You are not the owner of this channel and don't have Manage Channels permission.",
					});
				} else {
					await interaction.editReply({
						content: "🔸 You don't have Manage Channels permission for this channel.",
					});
				}
				return;
			}

			// Get toggle option (true = unhide, false/default = hide)
			const shouldUnhide = interaction.options.getBoolean("unhide") ?? false;

			// Get @everyone role
			const everyoneRole = interaction.guild.roles.everyone;

			// Update permissions
			if (shouldUnhide) {
				// Unhide: Remove the override to restore default/category permissions
				await voiceChannel.permissionOverwrites.delete(everyoneRole.id);

				// Save preference: channel should be visible
				const spawnChannelService = coordinator.getSpawnChannelService();
				await spawnChannelService.updatePreferences(
					member.user.id,
					interaction.guild.id,
					{ hidden: false },
				);

				await interaction.editReply({
					content: "Unhid the channel. It is now visible to everyone.",
				});
			} else {
				// Hide: Deny ViewChannel permission for @everyone
				const everyoneOverride = voiceChannel.permissionOverwrites.cache.get(everyoneRole.id);
				
				if (everyoneOverride) {
					await voiceChannel.permissionOverwrites.edit(everyoneRole.id, {
						ViewChannel: false,
					});
				} else {
					await voiceChannel.permissionOverwrites.create(everyoneRole.id, {
						ViewChannel: false,
					});
				}

				// Ensure the channel owner can still see the channel
				const ownerOverride = voiceChannel.permissionOverwrites.cache.get(member.id);
				if (ownerOverride) {
					await voiceChannel.permissionOverwrites.edit(member.id, {
						ViewChannel: true,
					});
				} else {
					await voiceChannel.permissionOverwrites.create(member.id, {
						ViewChannel: true,
					});
				}

				// Ensure bot can see the channel
				if (interaction.client.user) {
					const botOverride = voiceChannel.permissionOverwrites.cache.get(interaction.client.user.id);
					if (botOverride) {
						await voiceChannel.permissionOverwrites.edit(interaction.client.user.id, {
							ViewChannel: true,
						});
					} else {
						await voiceChannel.permissionOverwrites.create(interaction.client.user.id, {
							ViewChannel: true,
						});
					}
				}

				// Grant ViewChannel to all members currently in the voice channel
				// so they can still see the sidechat
				for (const [memberId] of voiceChannel.members) {
					if (memberId === member.id) continue; // Owner already handled
					if (memberId === interaction.client.user?.id) continue; // Bot already handled
					try {
						await voiceChannel.permissionOverwrites.edit(memberId, {
							ViewChannel: true,
						});
					} catch (error) {
						console.error(`🔸 [HIDE] Failed to grant ViewChannel for member ${memberId}:`, error);
					}
				}

				// Deny ViewChannel for all roles that currently have it allowed
				// This ensures the channel is truly hidden from everyone except the owner
				for (const [id, overwrite] of voiceChannel.permissionOverwrites.cache) {
					// Only process role overwrites (type 0), skip member overwrites (type 1)
					// Skip @everyone as we already handled it
					if (overwrite.type === 0 && id !== everyoneRole.id && overwrite.allow.has("ViewChannel")) {
						try {
							await voiceChannel.permissionOverwrites.edit(id, {
								ViewChannel: false,
							});
						} catch (error) {
							console.error(`🔸 [HIDE] Failed to deny ViewChannel for role ${id}:`, error);
						}
					}
				}

				// Save preference: channel should be hidden
				const spawnChannelService = coordinator.getSpawnChannelService();
				await spawnChannelService.updatePreferences(
					member.user.id,
					interaction.guild.id,
					{ hidden: true },
				);

				await interaction.editReply({
					content: "Hid the channel. It is now invisible to others.",
				});
			}
		} catch (error) {
			console.error("🔸 Error in hide command:", error);

			// Try to respond with error
			try {
				if (interaction.deferred) {
					await interaction.editReply({
						content: "🔸 An error occurred while trying to hide/unhide the channel.",
					});
				} else {
					await interaction.reply({
						content: "🔸 An error occurred while trying to hide/unhide the channel.",
						ephemeral: true,
					});
				}
			} catch {
				// Ignore if we can't send error message
			}
		}
	},
};

