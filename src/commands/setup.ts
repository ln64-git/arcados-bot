import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { setupServerLore } from "../features/server-lore/server-lore";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Post the bonfire image and server lore embed to #lore");

export async function execute(interaction: ChatInputCommandInteraction) {
  await setupServerLore(interaction);
}
