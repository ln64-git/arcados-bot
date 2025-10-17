import type {
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";

export interface Command {
	data: SlashCommandBuilder | unknown;
	execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
