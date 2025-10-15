import {
	AttachmentBuilder,
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import { OpenAIManager } from "../features/ai-assistant/OpenAIManager";
import type { Command } from "../types";
import { isGuildMember } from "../types";

let openaiManager: OpenAIManager | null = null;

// Initialize OpenAIManager lazily
function getOpenAIManager(): OpenAIManager {
	if (!openaiManager) {
		try {
			openaiManager = new OpenAIManager();
		} catch (error) {
			throw new Error(
				"🔸 AI service is not available. Please check configuration.",
			);
		}
	}
	return openaiManager;
}

export const aiCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("ai")
		.setDescription("Interact with AI using different modes")
		.addStringOption((option) =>
			option
				.setName("mode")
				.setDescription("Choose the AI mode")
				.setRequired(true)
				.addChoices(
					{ name: "Ask", value: "ask" },
					{ name: "Imagine", value: "imagine" },
					{ name: "Fact Check", value: "fact-check" },
					{ name: "Source", value: "source" },
				),
		)
		.addStringOption((option) =>
			option
				.setName("prompt")
				.setDescription("Your prompt for the AI")
				.setRequired(true)
				.setMaxLength(500),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}

		const mode = interaction.options.getString("mode", true);
		const prompt = interaction.options.getString("prompt", true);

		// Defer reply since AI requests can take time
		await interaction.deferReply();

		try {
			const manager = getOpenAIManager();
			const userId = interaction.user.id;

			let response: {
				success: boolean;
				content: string;
				error?: string;
				imageUrl?: string;
			};
			let title: string;
			let color: number;

			switch (mode) {
				case "ask": {
					response = await manager.askQuestion(prompt, userId);
					title = `Ask gpt-4o-mini\n*${prompt}*`;
					color = 0x3c3d7d; // Same as starboard
					break;
				}
				case "imagine": {
					response = await manager.generateCreative(prompt, userId);
					title = `*${prompt}*`;
					color = 0x3c3d7d; // Same as starboard
					break;
				}
				case "fact-check": {
					response = await manager.factCheck(prompt, userId);
					title = `Fact Check gpt-4o-mini\n*${prompt}*`;
					color = 0x3c3d7d; // Same as starboard
					break;
				}
				case "source": {
					response = await manager.citeSources(prompt, userId);
					title = `Source gpt-4o-mini\n*${prompt}*`;
					color = 0x3c3d7d; // Same as starboard
					break;
				}
				default: {
					await interaction.editReply({
						content: "🔸 Invalid AI mode specified!",
					});
					return;
				}
			}

			if (!response.success) {
				await interaction.editReply({
					content: `🔸 ${response.error}`,
				});
				return;
			}

			// Get rate limit info for footer
			const rateLimitInfo = manager.getRateLimitInfo(userId);
			const resetTime =
				rateLimitInfo.resetTime > 0
					? new Date(rateLimitInfo.resetTime).toLocaleTimeString()
					: "Now";

			const embed = new EmbedBuilder()
				.setTitle(title)
				.setColor(color)
				.setFooter({
					text: `Rate limit: ${rateLimitInfo.remaining} remaining | Resets at: ${resetTime}\nToday at ${new Date().toLocaleTimeString()}`,
				})
				.setTimestamp();

			// Only add description for non-imagine modes
			if (mode !== "imagine") {
				embed.setDescription(response.content);
			}

			// Add image if available (prefer attachment to avoid URL expiry)
			let files: AttachmentBuilder[] | undefined;
			if (response.imageBuffer && response.imageFilename) {
				const attachment = new AttachmentBuilder(response.imageBuffer, {
					name: response.imageFilename,
				});
				files = [attachment];
				embed.setImage(`attachment://${response.imageFilename}`);
			} else if (response.imageUrl) {
				embed.setImage(response.imageUrl);
			}

			await interaction.editReply({ embeds: [embed], files });
		} catch (error) {
			console.error("🔸 Error in AI command:", error);
			await interaction.editReply({
				content:
					"🔸 An error occurred while processing your AI request. Please try again later.",
			});
		}
	},
};
