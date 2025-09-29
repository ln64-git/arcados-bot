import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const revokeThisRoomCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("revoke-this-room")
		.setDescription("Admin: Revoke ownership of the current voice channel")
		.addStringOption((option) =>
			option
				.setName("reason")
				.setDescription("Reason for revoking ownership")
				.setRequired(false),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

	async execute(interaction: ChatInputCommandInteraction) {
		const reason = interaction.options.getString("reason") || "Admin override";

		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}
		const channel = member.voice?.channel;

		if (!channel) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel to use this command!",
				ephemeral: true,
			});
			return;
		}

		const voiceManager = (interaction.client as ClientWithVoiceManager)
			.voiceManager;
		if (!voiceManager) {
			await interaction.reply({
				content: "🔸 Voice manager not available!",
				ephemeral: true,
			});
			return;
		}

		// Check if there's an owner to revoke
		const owner = await voiceManager.getChannelOwner(channel.id);
		if (!owner) {
			await interaction.reply({
				content: "🔸 This voice channel doesn't have an owner to revoke!",
				ephemeral: true,
			});
			return;
		}

		try {
			const success = await voiceManager.revokeChannelOwnership(
				channel.id,
				interaction.user.id,
			);

			if (success) {
				const embed = new EmbedBuilder()
					.setTitle("🔹 Ownership Revoked")
					.setDescription(`Voice channel ownership has been revoked by admin`)
					.addFields(
						{
							name: "Previous Owner",
							value: `<@${owner.userId}>`,
							inline: true,
						},
						{ name: "Admin", value: interaction.user.tag, inline: true },
						{ name: "Reason", value: reason, inline: false },
					)
					.setColor(0xff6b6b)
					.setTimestamp();

				await interaction.reply({ embeds: [embed] });
			} else {
				await interaction.reply({
					content: "🔸 Failed to revoke ownership!",
					ephemeral: true,
				});
			}
		} catch (error) {
			await interaction.reply({
				content: "🔸 Failed to revoke ownership. Please try again.",
				ephemeral: true,
			});
		}
	},
};
