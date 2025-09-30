import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const coupDeTaCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("coup-de-ta")
		.setDescription("Start a democratic vote to transfer channel ownership")
		.addUserOption((option) =>
			option
				.setName("target")
				.setDescription("The user to transfer ownership to")
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
				content: "🔸 You must be in a voice channel!",
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

		// Check if target user is in the channel
		const targetMember = channel.members.get(targetUser.id);
		if (!targetMember) {
			await interaction.reply({
				content: "🔸 The target user must be in this voice channel!",
				ephemeral: true,
			});
			return;
		}

		// Check if there's already a coup session
		const existingSession = await voiceManager.getCoupSession(channel.id);
		if (existingSession) {
			const timeLeft = Math.ceil(
				(existingSession.expiresAt.getTime() - Date.now()) / 1000,
			);
			await interaction.reply({
				content: `🔸 There's already a coup vote in progress! It expires in ${timeLeft} seconds.`,
				ephemeral: true,
			});
			return;
		}

		// Check if user is trying to coup themselves
		if (targetUser.id === interaction.user.id) {
			await interaction.reply({
				content:
					"🔸 You cannot start a coup to transfer ownership to yourself!",
				ephemeral: true,
			});
			return;
		}

		// Check if target is the current owner
		const isOwner = await voiceManager.isChannelOwner(
			channel.id,
			targetUser.id,
		);
		if (isOwner) {
			await interaction.reply({
				content: "🔸 The target user is already the channel owner!",
				ephemeral: true,
			});
			return;
		}

		// Start the coup vote
		const success = await voiceManager.startCoupVote(channel.id, targetUser.id);

		if (!success) {
			await interaction.reply({
				content: "🔸 Failed to start the coup vote!",
				ephemeral: true,
			});
			return;
		}

		const memberCount = channel.members.size;
		const requiredVotes = Math.ceil(memberCount / 2);

		const embed = new EmbedBuilder()
			.setTitle("🔹 Coup Vote Started!")
			.setDescription(
				`A democratic vote has been started to transfer ownership to ${targetUser.tag}.\n\n` +
					`**Votes needed:** ${requiredVotes} out of ${memberCount} members\n` +
					`**Time limit:** 5 minutes\n\n` +
					`Use \`/vote-coup ${targetUser.tag}\` to vote!`,
			)
			.setColor(0xff6b6b)
			.setTimestamp()
			.setFooter({ text: `Started by ${interaction.user.tag}` });

		await interaction.reply({ embeds: [embed] });
	},
};
