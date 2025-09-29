import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const voteCoupCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("vote-coup")
		.setDescription("Vote in an ongoing democratic coup")
		.addUserOption((option) =>
			option
				.setName("target")
				.setDescription("The user you're voting to transfer ownership to")
				.setRequired(true),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const targetUser = interaction.options.getUser("target", true);

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

		// Check if there's an active coup session
		const session = await voiceManager.getCoupSession(channel.id);
		if (!session) {
			await interaction.reply({
				content: "🔸 There's no active coup vote in this channel!",
				ephemeral: true,
			});
			return;
		}

		// Check if the target matches the session
		if (session.targetUserId !== targetUser.id) {
			await interaction.reply({
				content: `🔸 You must vote for ${targetUser.tag}, not ${targetUser.tag}!`,
				ephemeral: true,
			});
			return;
		}

		// Vote
		const success = await voiceManager.voteCoup(
			channel.id,
			interaction.user.id,
			targetUser.id,
		);

		if (!success) {
			await interaction.reply({
				content:
					"🔸 Failed to vote! You may have already voted or the vote has expired.",
				ephemeral: true,
			});
			return;
		}

		// Get updated session info
		const updatedSession = await voiceManager.getCoupSession(channel.id);
		if (!updatedSession) {
			// Coup was executed
			const embed = new EmbedBuilder()
				.setTitle("🔹 Coup Successful!")
				.setDescription(
					`The democratic coup has succeeded! ${targetUser.tag} is now the channel owner.`,
				)
				.setColor(0x00ff00)
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
		} else {
			// Vote was recorded
			const memberCount = channel.members.size;
			const requiredVotes = Math.ceil(memberCount / 2);
			const timeLeft = Math.ceil(
				(updatedSession.expiresAt.getTime() - Date.now()) / 1000,
			);

			const embed = new EmbedBuilder()
				.setTitle("🔹 Vote Recorded!")
				.setDescription(
					`Your vote has been recorded.\n\n` +
						`**Progress:** ${updatedSession.votes.length}/${requiredVotes} votes\n` +
						`**Time remaining:** ${timeLeft} seconds`,
				)
				.setColor(0xffff00)
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
		}
	},
};
