import type { DatabaseTool, ToolContext } from "../registry/DatabaseTools.js";
import { VoiceAssistantManager } from "../../../handlers/voice/VoiceAssistantManager.js";
import { AIRequestBuilder } from "../../core/AIRequestBuilder.js";
import type { AIResponse } from "../../providers/base/AIProvider.js";
import type { TextChannel, Webhook } from "discord.js";

/**
 * Music control tools for AI assistant
 * Allows AI to play music and generate playlists by sending commands to the music bot
 */

/**
 * Find a text channel to send messages to
 * Priority:
 * 1. Use context.channelId if it's a text channel
 * 2. Find text channel associated with voice channel (same name/category)
 * 3. Fallback to first text channel in guild
 */
async function findTextChannel(
	context: ToolContext,
	session: any
): Promise<TextChannel | null> {
	const { channelId, guildId } = context;
	const client = session.channel.client;

	if (!client) {
		return null;
	}

	const guild = await client.guilds.fetch(guildId);
	if (!guild) {
		return null;
	}

	// Try to use context.channelId if provided
	if (channelId) {
		try {
			const channel = await client.channels.fetch(channelId);
			if (channel && "send" in channel && channel.isTextBased()) {
				return channel as TextChannel;
			}
		} catch (error) {
			// Channel not found or not accessible, continue to other methods
		}
	}

	// Find text channel associated with voice channel
	const voiceChannel = session.channel;
	const voiceChannelName = voiceChannel.name.toLowerCase();
	const voiceParentId = voiceChannel.parentId;

	// Look for text channel with same name or in same category
	const textChannels = guild.channels.cache.filter(
		(ch: any) => ch.isTextBased() && !ch.isDMBased()
	) as any;

	// First, try to find channel with same name
	for (const [, channel] of textChannels) {
		if (channel.name.toLowerCase() === voiceChannelName) {
			return channel as TextChannel;
		}
	}

	// Then, try to find channel in same category
	if (voiceParentId) {
		for (const [, channel] of textChannels) {
			if (channel.parentId === voiceParentId) {
				return channel as TextChannel;
			}
		}
	}

	// Fallback to first text channel
	const firstTextChannel = textChannels.first();
	if (firstTextChannel && firstTextChannel.isTextBased()) {
		return firstTextChannel as TextChannel;
	}

	return null;
}

/**
 * Get or create a webhook for the channel
 * Webhooks are needed so messages appear to come from a user, not a bot
 */
async function getOrCreateWebhook(
	channel: TextChannel
): Promise<Webhook | null> {
	try {
		// Check if bot has permission to manage webhooks
		const permissions = channel.permissionsFor(channel.client.user);
		if (!permissions?.has("ManageWebhooks")) {
			console.error(
				"[MusicTools] Bot does not have permission to manage webhooks"
			);
			return null;
		}

		// Try to find an existing webhook for this channel
		const webhooks = await channel.fetchWebhooks();
		const existingWebhook = webhooks.find(
			(w) => w.owner?.id === channel.client.user?.id
		);

		if (existingWebhook) {
			return existingWebhook;
		}

		// Create a new webhook if none exists
		const webhook = await channel.createWebhook({
			name: "Ariya Music Bot",
			avatar: channel.client.user?.avatarURL() || undefined,
		});

		return webhook;
	} catch (error) {
		console.error("[MusicTools] Error getting/creating webhook:", error);
		return null;
	}
}

/**
 * Parse song count from query string
 * Looks for patterns like "10 song", "5 songs", "20 track playlist"
 */
function parseSongCount(query: string): number {
	const patterns = [
		/(\d+)\s*(?:song|songs|track|tracks)/i,
		/(?:song|songs|track|tracks).*?(\d+)/i,
		/\b(\d+)\s*(?:song|track)/i,
	];

	for (const pattern of patterns) {
		const match = query.match(pattern);
		if (match && match[1]) {
			const count = parseInt(match[1], 10);
			if (count > 0 && count <= 30) {
				return count;
			}
		}
	}

	return 10; // Default
}

export const playMusicTool: DatabaseTool = {
	name: "playMusic",
	description:
		"Play a single song by sending a music bot command. Use this when the user asks to play a specific song (e.g., 'play stairway to heaven', 'play bohemian rhapsody').",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description:
					"The song name or search query to play (e.g., 'stairway to heaven', 'bohemian rhapsody queen')",
			},
		},
		required: ["query"],
	},
	async execute(params, context: ToolContext) {
		const { guildId } = context;
		const { query } = params;

		if (!query || typeof query !== "string") {
			return JSON.stringify({
				success: false,
				error: "Song query is required",
			});
		}

		try {
			const voiceAssistant = VoiceAssistantManager.getInstance();

			// Check if bot is in voice channel
			if (!voiceAssistant.isInVoiceChannel(guildId)) {
				return JSON.stringify({
					success: false,
					error: "Bot is not currently in a voice channel",
				});
			}

			const session = voiceAssistant.getSession(guildId);
			if (!session) {
				return JSON.stringify({
					success: false,
					error: "Voice session not found",
				});
			}

			// Find text channel to send message to
			const textChannel = await findTextChannel(context, session);
			if (!textChannel) {
				return JSON.stringify({
					success: false,
					error: "Could not find a text channel to send the music command",
				});
			}

			// Get or create webhook for the channel
			const webhook = await getOrCreateWebhook(textChannel);
			if (!webhook) {
				return JSON.stringify({
					success: false,
					error: "Failed to get or create webhook for the channel",
				});
			}

			// Send music bot command via webhook
			await webhook.send(`m!p ${query}`);

			return JSON.stringify({
				success: true,
				message: `Queued song: ${query}`,
				channel: textChannel.name,
			});
		} catch (error) {
			console.error("[MusicTools] Error playing music:", error);
			return JSON.stringify({
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to play music",
			});
		}
	},
};

export const generatePlaylistTool: DatabaseTool = {
	name: "generatePlaylist",
	description:
		"Generate a playlist based on a theme or description and queue multiple songs. Use this when the user asks for a playlist (e.g., 'give me a 10 song 80s playlist', 'playlist to kill nazi zombies to'). The bot will generate appropriate songs and queue them sequentially.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description:
					"The playlist theme or description (e.g., '10 song 80s playlist', 'playlist to kill nazi zombies to', '20 songs for working out')",
			},
			count: {
				type: "number",
				description:
					"Number of songs to generate (optional, will be parsed from query if not provided). Defaults to 10, maximum 30.",
			},
		},
		required: ["query"],
	},
	async execute(params, context: ToolContext) {
		const { guildId, userId } = context;
		const { query, count: providedCount } = params;

		if (!query || typeof query !== "string") {
			return JSON.stringify({
				success: false,
				error: "Playlist query is required",
			});
		}

		try {
			const voiceAssistant = VoiceAssistantManager.getInstance();

			// Check if bot is in voice channel
			if (!voiceAssistant.isInVoiceChannel(guildId)) {
				return JSON.stringify({
					success: false,
					error: "Bot is not currently in a voice channel",
				});
			}

			const session = voiceAssistant.getSession(guildId);
			if (!session) {
				return JSON.stringify({
					success: false,
					error: "Voice session not found",
				});
			}

			// Parse song count
			let songCount = providedCount
				? Math.min(Math.max(1, Math.floor(providedCount)), 30)
				: parseSongCount(query);

			// Ensure count is within valid range
			songCount = Math.min(Math.max(1, songCount), 30);

			// Find text channel to send messages to
			const textChannel = await findTextChannel(context, session);
			if (!textChannel) {
				return JSON.stringify({
					success: false,
					error: "Could not find a text channel to send the music commands",
				});
			}

			// Get or create webhook for the channel
			const webhook = await getOrCreateWebhook(textChannel);
			if (!webhook) {
				return JSON.stringify({
					success: false,
					error: "Failed to get or create webhook for the channel",
				});
			}

			// Generate playlist using AI
			if (!context.aiEngine) {
				return JSON.stringify({
					success: false,
					error: "AI engine not available in tool context",
				});
			}

			const playlistPrompt = `Generate a playlist of exactly ${songCount} songs based on this request: "${query}"

Return ONLY a JSON array of song titles, one per line, in this exact format:
["Song Title 1", "Song Title 2", "Song Title 3", ...]

Do not include any explanations, descriptions, or additional text. Only return the JSON array.`;

			const builder = new AIRequestBuilder(context.aiEngine);
			const result = await builder
				.chat()
				.blocking()
				.provider("grok")
				.persona("casual")
				.withoutTools() // Don't need database tools for playlist generation
				.generate(playlistPrompt);

			const playlistResponse = result as AIResponse;

			if (!playlistResponse.success || !playlistResponse.content) {
				return JSON.stringify({
					success: false,
					error: "Failed to generate playlist",
				});
			}

			// Parse playlist from response
			let songs: string[] = [];
			const content = playlistResponse.content.trim();

			// Try to extract JSON array from response
			try {
				// Look for JSON array in the response
				const jsonMatch = content.match(/\[[\s\S]*?\]/);
				if (jsonMatch) {
					songs = JSON.parse(jsonMatch[0]);
				} else {
					// Fallback: try to parse entire content as JSON
					songs = JSON.parse(content);
				}

				// Validate it's an array of strings
				if (!Array.isArray(songs)) {
					throw new Error("Response is not an array");
				}

				songs = songs
					.filter((s) => typeof s === "string" && s.trim().length > 0)
					.map((s) => s.trim())
					.slice(0, songCount); // Limit to requested count
			} catch (parseError) {
				// Fallback: try to extract song titles from lines
				const lines = content
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0 && !line.startsWith("```"));

				// Remove markdown code blocks if present
				const cleanedLines = lines
					.map((line) => line.replace(/^```(?:json)?/i, "").replace(/```$/, ""))
					.map((line) => line.trim())
					.filter((line) => line.length > 0);

				// Try to extract quoted strings or just use lines as-is
				songs = cleanedLines
					.map((line) => {
						// Try to extract quoted string
						const quotedMatch = line.match(/["']([^"']+)["']/);
						if (quotedMatch && quotedMatch[1]) {
							return quotedMatch[1];
						}
						// Remove list markers and numbers
						return line.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "");
					})
					.filter((s): s is string => typeof s === "string" && s.length > 0)
					.slice(0, songCount);
			}

			if (songs.length === 0) {
				return JSON.stringify({
					success: false,
					error: "Could not parse songs from playlist generation",
				});
			}

			// Send music bot commands for each song sequentially via webhook
			const sentSongs: string[] = [];
			for (let i = 0; i < songs.length; i++) {
				const song = songs[i];
				if (!song) continue;
				try {
					await webhook.send(`m!p ${song}`);
					sentSongs.push(song);

					// Add small delay between messages to avoid rate limits
					if (i < songs.length - 1) {
						await new Promise((resolve) => setTimeout(resolve, 150));
					}
				} catch (error) {
					console.error(
						`[MusicTools] Error sending song ${i + 1}/${songs.length}:`,
						error
					);
					// Continue with other songs even if one fails
				}
			}

			return JSON.stringify({
				success: true,
				message: `Generated and queued ${sentSongs.length} songs`,
				songCount: sentSongs.length,
				songs: sentSongs,
				channel: textChannel.name,
			});
		} catch (error) {
			console.error("[MusicTools] Error generating playlist:", error);
			return JSON.stringify({
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to generate playlist",
			});
		}
	},
};

/**
 * Export all music tools for registration
 */
export const musicTools: DatabaseTool[] = [playMusicTool, generatePlaylistTool];

