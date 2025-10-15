import {
	AttachmentBuilder,
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import { OpenAIManager } from "../features/ai-assistant/OpenAIManager";
import type { Command } from "../types";
import { isGuildMember } from "../types";

interface DiscordField {
	name: string;
	value: string;
	inline?: boolean;
}

interface StructuredContent {
	description?: string;
	fields: DiscordField[];
}

function normalizeBullets(text: string): string {
	// Replace various bullet styles with consistent filled bullet (•)
	return text
		.replace(/^[\s]*[o○◦‣⁃▪▫‥][\s]*/gm, "• ") // Replace unfilled bullets
		.replace(/^[\s]*[-–—][\s]*/gm, "• ") // Replace dashes
		.replace(/^[\s]*[∗][\s]*/gm, "• ") // Replace asterisk bullets
		.replace(/^[\s]*[→][\s]*/gm, "• ") // Replace arrow bullets
		.replace(/^[\s]*[▪][\s]*/gm, "• ") // Replace square bullets
		.replace(/^[\s]*[▫][\s]*/gm, "• "); // Replace hollow square bullets
}

function parseContentForDiscord(content: string): StructuredContent {
	const lines = content.split("\n");
	const result: StructuredContent = {
		fields: [],
	};

	let currentField: DiscordField | null = null;
	const descriptionLines: string[] = [];
	let isInDescription = true;

	for (const line of lines) {
		const trimmedLine = normalizeBullets(line.trim());

		// Check if this is a bold header (potential field name)
		if (
			trimmedLine.startsWith("**") &&
			trimmedLine.endsWith("**") &&
			trimmedLine.length > 4
		) {
			// Save previous field if exists
			if (currentField) {
				result.fields.push(currentField);
			}

			// Start new field
			const fieldName = trimmedLine.slice(2, -2); // Remove **
			currentField = {
				name: fieldName,
				value: "",
				inline: false,
			};
			isInDescription = false;
		}
		// Check if this is a bullet point or content line
		else if (
			trimmedLine.startsWith("•") ||
			(trimmedLine.length > 0 && !trimmedLine.startsWith("**"))
		) {
			if (currentField) {
				// Add to current field
				if (currentField.value) {
					currentField.value += "\n";
				}
				currentField.value += trimmedLine;
			} else if (isInDescription) {
				// Add to description
				descriptionLines.push(trimmedLine);
			}
		}
		// Empty line - continue current context
		else if (trimmedLine === "") {
			if (currentField && currentField.value) {
				currentField.value += "\n";
			} else if (isInDescription) {
				descriptionLines.push("");
			}
		}
	}

	// Save final field
	if (currentField) {
		result.fields.push(currentField);
	}

	// Set description if we have content
	if (descriptionLines.length > 0) {
		result.description = descriptionLines.join("\n").trim();
	}

	// If no fields were created but we have content, put it all in description
	if (result.fields.length === 0 && content.trim()) {
		result.description = content.trim();
	}

	return result;
}

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
					{ name: "Define", value: "define" },
					{ name: "Context", value: "context" },
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
				case "define": {
					response = await manager.defineTerm(prompt, userId);
					title = `Define gpt-4o-mini\n*${prompt}*`;
					color = 0x3c3d7d; // Same as starboard
					break;
				}
				case "context": {
					response = await manager.provideContext(prompt, userId);
					title = `Context gpt-4o-mini\n*${prompt}*`;
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

			// Parse and structure content for Discord embeds
			if (mode !== "imagine") {
				const structuredContent = parseContentForDiscord(response.content);

				if (structuredContent.description) {
					embed.setDescription(structuredContent.description);
				}

				// Add fields for better organization
				structuredContent.fields.forEach((field) => {
					embed.addFields({
						name: field.name,
						value: field.value,
						inline: field.inline || false,
					});
				});
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
