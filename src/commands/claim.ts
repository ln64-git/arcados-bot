import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const claimCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("claim")
		.setDescription(
			"Claim, reclaim, or unclaim ownership of the current voice channel",
		)
		.addStringOption((option) =>
			option
				.setName("action")
				.setDescription("Action to perform")
				.setRequired(false)
				.addChoices(
					{ name: "Claim/Reclaim", value: "claim" },
					{ name: "Unclaim (Make Available)", value: "unclaim" },
				),
		)
		.addStringOption((option) =>
			option
				.setName("reason")
				.setDescription("Reason for the action")
				.setRequired(false),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		// Defer the interaction to prevent timeout
		await interaction.deferReply({ ephemeral: true });

		const action = interaction.options.getString("action") || "claim";
		const reason =
			interaction.options.getString("reason") ||
			(action === "unclaim"
				? "Channel made available for claiming"
				: "User claimed ownership");

		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.editReply({
				content: "🔸 This command can only be used in a server!",
			});
			return;
		}

		const voiceChannel = member.voice.channel;
		if (!voiceChannel) {
			await interaction.editReply({
				content: "🔸 You must be in a voice channel to claim it!",
			});
			return;
		}

		const client = interaction.client as ClientWithVoiceManager;
		const voiceManager = client.voiceManager;

		if (!voiceManager) {
			await interaction.editReply({
				content: "🔸 Voice manager not available!",
			});
			return;
		}

		try {
			// Handle unclaim action
			if (action === "unclaim") {
				// Check if channel has an owner
				const currentOwner = await voiceManager.getChannelOwner(
					voiceChannel.id,
				);
				if (!currentOwner) {
					await interaction.editReply({
						content: "🔸 This channel doesn't have an owner to unclaim!",
					});
					return;
				}

				// Check if the user is the current owner
				if (currentOwner.userId !== member.id) {
					await interaction.editReply({
						content: "🔸 Only the current owner can unclaim this channel!",
					});
					return;
				}

				// Change channel name to indicate it's available (in background)
				const availableName = "Available Channel";
				(async () => {
					try {
						// Use REST API first with timeout
						const restPromise = client.rest.patch(
							`/channels/${voiceChannel.id}`,
							{
								body: { name: availableName },
							},
						);
						const restTimeoutPromise = new Promise((_, reject) =>
							setTimeout(
								() => reject(new Error("REST API rename timeout")),
								8000, // 8 second timeout for REST API
							),
						);
						await Promise.race([restPromise, restTimeoutPromise]);
						console.log(`🔹 Channel renamed to available: ${availableName}`);
					} catch (error) {
						console.log(
							`🔸 Failed to rename channel to available via REST API: ${error instanceof Error ? error.message : String(error)}`,
						);
						// Fallback to discord.js method with timeout
						try {
							const renamePromise = voiceChannel.setName(availableName);
							const timeoutPromise = new Promise((_, reject) =>
								setTimeout(
									() => reject(new Error("Channel rename timeout")),
									5000, // 5 second timeout for discord.js fallback
								),
							);
							await Promise.race([renamePromise, timeoutPromise]);
							console.log("🔹 Channel renamed to available via fallback");
						} catch (fallbackError) {
							console.log(
								`🔸 Failed to rename channel to available: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
							);
						}
					}
				})();

				// Remove ownership AFTER renaming to avoid ownership detection issues
				await voiceManager.removeChannelOwner(voiceChannel.id);

				const embed = new EmbedBuilder()
					.setColor(0xffa500)
					.setTitle("🔹 Channel Unclaimed Successfully")
					.setDescription(
						`You have successfully unclaimed <#${voiceChannel.id}>. The channel is now available for anyone to claim!`,
					)
					.addFields(
						{
							name: "Channel",
							value: `<#${voiceChannel.id}>`,
							inline: true,
						},
						{
							name: "Previous Owner",
							value: `<@${member.id}>`,
							inline: true,
						},
						{
							name: "Reason",
							value: reason,
							inline: false,
						},
					)
					.setTimestamp();

				await interaction.editReply({ embeds: [embed] });
				return;
			}
			// Check if channel already has an owner
			const currentOwner = await voiceManager.getChannelOwner(voiceChannel.id);
			if (currentOwner) {
				// Check if the user is the previous owner (can reclaim)
				const isPreviousOwner = await voiceManager.isPreviousChannelOwner(
					voiceChannel.id,
					member.id,
				);

				if (!isPreviousOwner) {
					const embed = new EmbedBuilder()
						.setColor(0xff6b6b)
						.setTitle("🔸 Channel Already Owned")
						.setDescription(
							`This channel is already owned by <@${currentOwner.userId}>. Only the previous owner can reclaim it.`,
						)
						.addFields({
							name: "Current Owner",
							value: `<@${currentOwner.userId}>`,
							inline: true,
						})
						.setTimestamp();

					await interaction.editReply({ embeds: [embed] });
					return;
				}

				// Previous owner is reclaiming - transfer ownership back
				await voiceManager.setChannelOwner(
					voiceChannel.id,
					member.id,
					voiceChannel.guild.id,
				);

				const reclaimReason =
					reason === "User claimed ownership"
						? "Previous owner reclaimed channel"
						: reason;

				const embed = new EmbedBuilder()
					.setColor(0x51cf66)
					.setTitle("🔹 Channel Reclaimed Successfully")
					.setDescription(
						`You have successfully reclaimed ownership of <#${voiceChannel.id}> from <@${currentOwner.userId}>!`,
					)
					.addFields(
						{
							name: "Channel",
							value: `<#${voiceChannel.id}>`,
							inline: true,
						},
						{
							name: "New Owner",
							value: `<@${member.id}>`,
							inline: true,
						},
						{
							name: "Previous Owner",
							value: `<@${currentOwner.userId}>`,
							inline: true,
						},
						{
							name: "Reason",
							value: reclaimReason,
							inline: false,
						},
					)
					.setTimestamp();

				// Respond immediately to avoid timeout
				await interaction.editReply({ embeds: [embed] });

				// Apply preferences in background (non-blocking)
				console.log(
					`🔍 Applying preferences for user ${member.id} to channel ${voiceChannel.id}`,
				);
				voiceManager
					.applyUserPreferencesToChannel(voiceChannel.id, member.id)
					.then(() => {
						console.log(
							`✅ Successfully applied preferences for user ${member.id}`,
						);
					})
					.catch((error) => {
						console.error(
							`🔸 Failed to apply preferences after reclaim: ${error}`,
						);
					});
				return;
			}

			// Claim the channel
			await voiceManager.setChannelOwner(
				voiceChannel.id,
				member.id,
				voiceChannel.guild.id,
			);

			const embed = new EmbedBuilder()
				.setColor(0x51cf66)
				.setTitle("🔹 Channel Claimed Successfully")
				.setDescription(
					`You have successfully claimed ownership of <#${voiceChannel.id}>!`,
				)
				.addFields(
					{
						name: "Channel",
						value: `<#${voiceChannel.id}>`,
						inline: true,
					},
					{
						name: "New Owner",
						value: `<@${member.id}>`,
						inline: true,
					},
					{
						name: "Reason",
						value: reason,
						inline: false,
					},
				)
				.setTimestamp();

			// Respond immediately to avoid timeout
			await interaction.editReply({ embeds: [embed] });

			// Apply preferences in background (non-blocking)
			console.log(
				`🔍 Applying preferences for user ${member.id} to channel ${voiceChannel.id}`,
			);
			voiceManager
				.applyUserPreferencesToChannel(voiceChannel.id, member.id)
				.then(() => {
					console.log(
						`✅ Successfully applied preferences for user ${member.id}`,
					);
				})
				.catch((error) => {
					console.error(`🔸 Failed to apply preferences after claim: ${error}`);
				});
		} catch (error) {
			console.error("Error claiming channel:", error);
			await interaction.editReply({
				content:
					"🔸 An error occurred while claiming the channel. Please try again later.",
				ephemeral: true,
			});
		}
	},
};
