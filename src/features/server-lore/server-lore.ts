import { AttachmentBuilder, ChatInputCommandInteraction, EmbedBuilder, TextChannel } from "discord.js";

export function createServerLoreEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("hello and welcome to my server")
    .setColor("#A03232")
    .setDescription(
      "**: name ** \n" +
      "a spanish twist on the greek myth of arcadia, domain of pan.\n\n" +
      "**: origin**\n" +
      "most of us come from internet communities based around anarchy and neurodivergence.\n\n" +
      "**: etiquette**\n" +
      "people here are pretty accepting but also brutal. we value connection and honest interaction."
    );
}

export async function setupServerLore(interaction: ChatInputCommandInteraction): Promise<void> {
  console.log(`Command executed by ${interaction.user.tag}`);

  await interaction.deferReply({ ephemeral: true });

  const loreChannel = interaction.guild?.channels.cache.find(
    (channel) => channel.name === "lore" && channel.isTextBased()
  ) as TextChannel | undefined;

  if (!loreChannel) {
    await interaction.followUp({
      content: "lore channel not found.",
      ephemeral: true,
    });
    return;
  }

  const imagePath = "src/assets/bonfire.gif";

  try {
    const imageAttachment = new AttachmentBuilder(imagePath);
    await loreChannel.send({ content: "\u200B", files: [imageAttachment] });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await loreChannel.send({ embeds: [createServerLoreEmbed()] });
    await interaction.followUp({
      content: "Setup complete. Messages have been sent to #lore.",
      ephemeral: true,
    });
  } catch (error) {
    console.error("Failed to send messages:", error);
    await interaction.followUp({
      content: "Failed to send messages in the lore channel.",
      ephemeral: true,
    });
  }
}