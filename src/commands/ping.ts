import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../types";

export const pingCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("ping")
		.setDescription("Replies with Pong!"),
	execute: async (interaction: ChatInputCommandInteraction) => {
		await interaction.reply("🔹 Pong!");
	},
};
