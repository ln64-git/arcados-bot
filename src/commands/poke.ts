import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../types";

export const pokeCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("poke")
		.setDescription("Poke another user, like on Facebook")
		.addUserOption((option) =>
			option
				.setName("target")
				.setDescription("The user you want to poke")
				.setRequired(true),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const target = interaction.options.getUser("target", true);

		// Prevent self-poking to keep the interaction meaningful
		if (target.id === interaction.user.id) {
			await interaction.reply("You can't poke yourself!");
			return;
		}

		const poker = interaction.user;
		await interaction.reply(`${poker.toString()} poked ${target.toString()} 👈`);
	},
};
