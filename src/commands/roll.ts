import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import { getCacheManager } from "../features/cache-management/DiscordDataCache";
import type {
	ClientWithVoiceManager,
	Command,
	RollData,
	RollResult,
} from "../types";

async function handleDiceRoll(
	interaction: ChatInputCommandInteraction,
	client: ClientWithVoiceManager,
	cache: any,
): Promise<void> {
	const userId = interaction.user.id;
	const guildId = interaction.guildId!;
	const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

	// Check if user has already rolled today
	const rollData = await cache.getRollData(userId, guildId);
	if (rollData && rollData.lastRollDate === today) {
		await interaction.reply({
			content: `🔸 You've already rolled today! Your last roll was **${rollData.lastRollValue}**. Try again tomorrow!`,
			ephemeral: true,
		});
		return;
	}

	// Roll the dice (1-20)
	const rollValue = Math.floor(Math.random() * 20) + 1;
	const isTwenty = rollValue === 20;

	// Get or create roll data
	const currentRollData: RollData = rollData || {
		userId,
		guildId,
		lastRollDate: "",
		totalRolls: 0,
		totalTwenties: 0,
		lastRollValue: 0,
		createdAt: new Date(),
		lastUpdated: new Date(),
	};

	// Update roll data
	currentRollData.lastRollDate = today;
	currentRollData.totalRolls += 1;
	currentRollData.lastRollValue = rollValue;
	currentRollData.lastUpdated = new Date();

	if (isTwenty) {
		currentRollData.totalTwenties += 1;
	}

	// Save updated data
	await cache.setRollData(userId, guildId, currentRollData);

	// Handle unbanning if they rolled a 20
	let unbannedFrom: string[] = [];
	if (isTwenty && client.voiceManager) {
		unbannedFrom = await handleUnban(interaction, client.voiceManager);
	}

	// Create result
	const result: RollResult = {
		value: rollValue,
		isTwenty,
		isDailyLimit: false,
		unbannedFrom,
		message: getRollMessage(rollValue, unbannedFrom),
	};

	// Create embed
	const embed = createRollEmbed(interaction.user, result, currentRollData);

	await interaction.reply({ embeds: [embed] });
}

async function handleUnban(
	interaction: ChatInputCommandInteraction,
	voiceManager: any,
): Promise<string[]> {
	const userId = interaction.user.id;
	const guildId = interaction.guildId!;
	const unbannedFrom: string[] = [];

	try {
		// Get all voice channels in the guild
		const guild = interaction.guild;
		if (!guild) return unbannedFrom;

		for (const channel of guild.channels.cache.values()) {
			if (channel.isVoiceBased()) {
				// Check if user is banned from this channel
				const isBanned = await voiceManager.isUserBannedFromChannel(
					channel.id,
					userId,
				);

				if (isBanned) {
					// Unban the user
					const success = await voiceManager.unbanUserFromChannel(
						channel.id,
						userId,
						interaction.user.id,
					);

					if (success) {
						unbannedFrom.push(channel.id);
					}
				}
			}
		}

		console.log(
			`🔹 User ${interaction.user.tag} rolled a 20 and was unbanned from ${unbannedFrom.length} channels`,
		);
	} catch (error) {
		console.error("🔸 Error handling unban for roll 20:", error);
	}

	return unbannedFrom;
}

function getRollMessage(rollValue: number, unbannedFrom: string[]): string {
	if (rollValue === 20) {
		if (unbannedFrom.length > 0) {
			return `🎉 **NATURAL 20!** You've been unbanned from ${unbannedFrom.length} channel(s)! You're free!`;
		} else {
			return `🎉 **NATURAL 20!** Lucky roll! (You weren't banned from any channels)`;
		}
	} else if (rollValue >= 15) {
		return `🔹 **${rollValue}** - Good roll! But not quite enough for freedom...`;
	} else if (rollValue >= 10) {
		return `🔸 **${rollValue}** - Decent roll, but you'll need better luck next time!`;
	} else if (rollValue >= 5) {
		return `🔸 **${rollValue}** - Not great, but not terrible either.`;
	} else {
		return `🔸 **${rollValue}** - Ouch! Better luck next time!`;
	}
}

function createRollEmbed(
	user: any,
	result: RollResult,
	rollData: RollData,
): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle("🎲 Dice Roll Result")
		.setColor(result.isTwenty ? 0x00ff00 : 0x5865f2)
		.setThumbnail(user.displayAvatarURL())
		.setDescription(result.message)
		.addFields(
			{
				name: "Roll Value",
				value: result.value.toString(),
				inline: true,
			},
			{
				name: "Total Rolls",
				value: rollData.totalRolls.toString(),
				inline: true,
			},
			{
				name: "Natural 20s",
				value: rollData.totalTwenties.toString(),
				inline: true,
			},
		)
		.setTimestamp();

	if (result.unbannedFrom.length > 0) {
		embed.addFields({
			name: "Unbanned From",
			value: `${result.unbannedFrom.length} channel(s)`,
			inline: true,
		});
	}

	return embed;
}

export const rollCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("roll")
		.setDescription(
			"Roll a 20-sided die! Get a 20 to unban yourself from all channels!",
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const client = interaction.client as ClientWithVoiceManager;

		if (!interaction.guildId) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}

		const cache = getCacheManager();

		try {
			await handleDiceRoll(interaction, client, cache);
		} catch (error) {
			console.error("Error in roll command:", error);
			await interaction.reply({
				content:
					"🔸 An error occurred while processing the roll command. Please try again later.",
				ephemeral: true,
			});
		}
	},
};
