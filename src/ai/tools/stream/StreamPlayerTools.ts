import type {
  DatabaseTool,
  ToolContext,
  DatabaseToolResult,
} from "../registry/DatabaseTools.js";
import { StreamPlayerManager } from "../../../features/stream-player/StreamPlayerManager.js";
import type { SearchResult } from "../../../features/stream-player/types.js";
import type { VoiceChannel } from "discord.js";
import { ChannelType } from "discord.js";

/**
 * Stream player tools for AI assistant
 * Allows AI to stream video content to voice channels
 */

// Lock to prevent concurrent tool executions for the same guild+query
const executionLocks = new Map<string, Promise<any>>();

/**
 * Get a lock key for a request
 */
function getLockKey(guildId: string, query: string): string {
  return `${guildId}:${query.toLowerCase().trim()}`;
}

/**
 * Find voice channel from context
 */
async function findVoiceChannel(
  context: ToolContext,
  channelId?: string
): Promise<VoiceChannel | null> {
  if (!context.guildId) {
    return null;
  }

  // Try to get client from context (would need to be passed in)
  // For now, we'll need to get it from StreamPlayerManager
  const streamManager = StreamPlayerManager.getInstance();
  const session = streamManager.getActiveSession(context.guildId);

  if (channelId) {
    try {
      // This would need client access - we'll need to modify context or manager
      // For now, return null and handle in tool execution
      return null;
    } catch (error) {
      return null;
    }
  }

  return null;
}

export const streamContentTool: DatabaseTool = {
  name: "streamContent",
  description:
    "Stream a movie or TV show to a Discord voice channel. Use this when the user asks to stream content (e.g., 'stream the simpsons', 'stream Apocalypse Now', 'play a movie'). The bot will search for the content and start streaming it to the voice channel.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The movie or TV show name to stream (e.g., 'the simpsons', 'Apocalypse Now', 'Futurama')",
      },
      channelId: {
        type: "string",
        description:
          "Optional voice channel ID to stream to. If not provided, will use the user's current voice channel.",
      },
    },
    required: ["query"],
  },
  async execute(params, context): Promise<string | DatabaseToolResult> {
    try {
      const { query, channelId } = params;

      if (!query || typeof query !== "string") {
        return {
          success: false,
          error: "Query parameter is required",
        };
      }

      if (!context.guildId) {
        return {
          success: false,
          error: "Guild context required",
        };
      }

      // Get voice channel - auto-detect user's voice channel if not specified
      let voiceChannelId: string;

      if (channelId) {
        voiceChannelId = channelId;
      } else {
        // Try to find user's current voice channel
        const streamManager = StreamPlayerManager.getInstance();
        const client = (streamManager as any).client;

        if (!client) {
          return {
            success: false,
            error: "Bot client not available. Please specify a voice channel.",
          };
        }

        const guild = await client.guilds.fetch(context.guildId);
        if (!guild) {
          return {
            success: false,
            error: "Guild not found",
          };
        }

        // Get the user's voice channel
        const member = await guild.members.fetch(context.userId);
        if (!member?.voice?.channel) {
          return {
            success: false,
            error:
              "You need to be in a voice channel first! Please join a voice channel or specify which channel to stream to.",
          };
        }

        voiceChannelId = member.voice.channel.id;
        console.log(
          `[StreamPlayerTools] Auto-detected user's voice channel: ${member.voice.channel.name} (${voiceChannelId})`
        );
      }

      // Stream content
      const streamManager = StreamPlayerManager.getInstance();
      const result = await streamManager.streamContent({
        guildId: context.guildId,
        voiceChannelId,
        query,
      });

      if (result.success) {
        // If multiple results found, format them for user selection
        if (result.requiresSelection && result.searchResults) {
          const optionsText = result.searchResults
            .map(
              (r, i) => `${i + 1}. ${r.title}${r.year ? ` (${r.year})` : ""}`
            )
            .join("\n");

          const formattedMessage = `${result.message}\n\n${optionsText}\n\nReply with the number (1-${result.searchResults.length}) to select.\n\n[IMPORTANT: When the user replies with a number, you MUST immediately call the selectStreamResult tool with their selection.]`;

          return {
            success: true,
            formatted: formattedMessage,
            summary: `Found ${result.searchResults.length} results. Waiting for user selection. When user replies with a number, call selectStreamResult tool.`,
            data: {
              searchResults: result.searchResults,
              requiresSelection: true,
            },
          };
        }

        return {
          success: true,
          formatted: result.message,
          summary: `Started streaming "${query}"`,
        };
      } else {
        return {
          success: false,
          error: result.error || result.message,
        };
      }
    } catch (error) {
      console.error("[StreamPlayerTools] Error in streamContent:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to start stream",
      };
    }
  },
};

export const selectStreamResultTool: DatabaseTool = {
  name: "selectStreamResult",
  description:
    "IMPORTANT: Use this tool when the user replies with a number (like '1', '2', '3') or text containing a number (like 'option 2', 'the second one', 'number 2') after you have presented them with multiple search results for streaming. This tool selects which search result to stream based on the user's choice. Always call this tool immediately when the user provides a selection number.",
  parameters: {
    type: "object",
    properties: {
      selection: {
        type: "string",
        description:
          "The user's selection - extract the number from their message (e.g., if they say '2' or 'option 2' or 'the second one', extract '2').",
      },
    },
    required: ["selection"],
  },
  async execute(params, context): Promise<string | DatabaseToolResult> {
    console.log(
      "[StreamPlayerTools] selectStreamResult called with params:",
      params
    );

    try {
      if (!context.guildId) {
        console.error("[StreamPlayerTools] No guildId in context");
        return {
          success: false,
          error: "Guild context required",
        };
      }

      const { selection } = params;
      console.log(`[StreamPlayerTools] Processing selection: "${selection}"`);

      if (!selection) {
        return {
          success: false,
          error: "Selection is required",
        };
      }

      // Parse selection - extract number from text
      const selectionMatch = selection.match(/\d+/);
      if (!selectionMatch) {
        console.error(
          `[StreamPlayerTools] Could not extract number from selection: "${selection}"`
        );
        return {
          success: false,
          error: "Invalid selection format. Please provide a number.",
        };
      }

      const selectionIndex = parseInt(selectionMatch[0], 10);
      console.log(
        `[StreamPlayerTools] Parsed selection index: ${selectionIndex}`
      );

      const streamManager = StreamPlayerManager.getInstance();
      console.log(
        `[StreamPlayerTools] Calling streamWithSelection for guild ${context.guildId}`
      );
      const result = await streamManager.streamWithSelection(
        context.guildId,
        selectionIndex
      );

      console.log(
        `[StreamPlayerTools] streamWithSelection result: success=${result.success}, message=${result.message}`
      );

      if (result.success) {
        return {
          success: true,
          formatted: result.message,
          summary: `Selected and started streaming option ${selectionIndex}`,
        };
      } else {
        return {
          success: false,
          error: result.error || result.message,
        };
      }
    } catch (error) {
      console.error("[StreamPlayerTools] Error in selectStreamResult:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to select result",
      };
    }
  },
};

export const stopStreamTool: DatabaseTool = {
  name: "stopStream",
  description:
    "Stop, close, or end the current stream if one is playing. Use this when the user asks to stop, close, or end streaming. Common phrases include: 'stop stream', 'close stream', 'end stream', 'stop the stream', 'close the stream', 'end the stream', 'stop streaming', 'quit stream', 'cancel stream'. Always call this tool when the user wants to stop any active stream.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(params, context): Promise<string | DatabaseToolResult> {
    try {
      if (!context.guildId) {
        return {
          success: false,
          error: "Guild context required",
        };
      }

      const streamManager = StreamPlayerManager.getInstance();

      // Check if a stream is active (in any state)
      if (!streamManager.isStreaming(context.guildId)) {
        return {
          success: false,
          error: "No stream is currently active",
        };
      }

      // Stop the stream (works for any active state)
      await streamManager.stopStream(context.guildId);

      return {
        success: true,
        formatted: "✅ Stream stopped successfully.",
        summary: "Stopped the current stream",
      };
    } catch (error) {
      console.error("[StreamPlayerTools] Error in stopStream:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to stop stream",
      };
    }
  },
};

export const searchYouTubeTool: DatabaseTool = {
  name: "searchYouTube",
  description:
    "Search YouTube for videos. Use this when the user asks to find or search for a video on YouTube (e.g., 'find the video on youtube charlie the unicorn', 'search youtube for X', 'play video from youtube'). The bot will search YouTube, show results, and allow the user to select which video to stream. IMPORTANT: Call this tool ONCE when the user wants to search YouTube. The tool will automatically detect if the user is in a voice channel. If the user is not in a voice channel, the search will still work and you can ask them to join one when they select a video. Do NOT call this tool multiple times for the same request.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The search query for YouTube (e.g., 'charlie the unicorn', 'funny cat videos', 'tutorial python')",
      },
      channelId: {
        type: "string",
        description:
          "Optional voice channel ID to stream to. If not provided, will try to auto-detect the user's current voice channel. If user is not in a voice channel, the search will still proceed and voice channel will be needed when user selects a video.",
      },
    },
    required: ["query"],
  },
  async execute(params, context): Promise<string | DatabaseToolResult> {
    const { query, channelId } = params;

    if (!query || typeof query !== "string") {
      return {
        success: false,
        error: "Query parameter is required",
      };
    }

    if (!context.guildId) {
      return {
        success: false,
        error: "Guild context required",
      };
    }

    // Check for existing execution lock (prevent concurrent calls)
    const lockKey = getLockKey(context.guildId, query);
    const existingLock = executionLocks.get(lockKey);
    if (existingLock) {
      console.log(
        `[StreamPlayerTools] Concurrent request detected for "${query}", waiting for existing execution...`
      );
      try {
        const existingResult = await existingLock;
        // If the existing execution returned results, return those
        if (
          existingResult &&
          typeof existingResult === "object" &&
          "success" in existingResult &&
          existingResult.success
        ) {
          return existingResult;
        }
      } catch (error) {
        // If existing execution failed, continue with new execution
        console.log(
          `[StreamPlayerTools] Existing execution failed, proceeding with new request`
        );
      }
    }

    // Check if there's already an active search session for this query
    const streamManagerCheck = StreamPlayerManager.getInstance();
    const existingSession = streamManagerCheck.getActiveSession(
      context.guildId
    );
    if (
      existingSession &&
      existingSession.state === "searching" &&
      existingSession.query.toLowerCase() === query.toLowerCase()
    ) {
      console.log(
        `[StreamPlayerTools] Active search session found for "${query}", returning existing results`
      );
      const searchResults = (existingSession as any).pendingSearchResults as
        | SearchResult[]
        | undefined;
      if (searchResults && searchResults.length > 0) {
        const optionsText = searchResults
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}${
                r.description ? ` - ${r.description}` : ""
              }`
          )
          .join("\n");

        const formattedMessage = `Found ${searchResults.length} results for "${query}". Please select one:\n\n${optionsText}\n\nReply with the number (1-${searchResults.length}) to select.`;

        return {
          success: true,
          formatted: formattedMessage,
          summary: `Found ${searchResults.length} YouTube results (returning existing results).`,
          data: {
            searchResults,
            requiresSelection: true,
          },
        };
      }
    }

    // Create execution lock
    const executionPromise = (async (): Promise<
      string | DatabaseToolResult
    > => {
      try {
        // Get voice channel - auto-detect user's voice channel if not specified
        // But don't fail if user is not in a voice channel - we'll need it later when they select
        let voiceChannelId: string | undefined;

        if (channelId) {
          voiceChannelId = channelId;
        } else {
          // Try to find user's current voice channel
          const streamManager = StreamPlayerManager.getInstance();
          const client = (streamManager as any).client;

          if (client) {
            try {
              const guild = await client.guilds.fetch(context.guildId);
              if (guild) {
                const member = await guild.members.fetch(context.userId);
                if (member?.voice?.channel) {
                  voiceChannelId = member.voice.channel.id;
                  console.log(
                    `[StreamPlayerTools] Auto-detected user's voice channel: ${member.voice.channel.name} (${voiceChannelId})`
                  );
                } else {
                  console.log(
                    `[StreamPlayerTools] User is not in a voice channel, will need it when they select a video`
                  );
                }
              }
            } catch (error) {
              console.warn(
                `[StreamPlayerTools] Could not fetch voice channel info:`,
                error
              );
              // Continue without voice channel - we'll need it later
            }
          }
        }

        // If no voice channel found, we can still search, but we'll need it later
        if (!voiceChannelId) {
          console.log(
            `[StreamPlayerTools] No voice channel specified or detected, proceeding with search anyway`
          );
        }

        // Stream content with YouTube provider
        const streamManager = StreamPlayerManager.getInstance();

        // If no voice channel detected, we still want to search, but we'll need it later
        // For now, we'll use a placeholder or try to get it one more time
        if (!voiceChannelId) {
          // Try one more time to get voice channel
          const client = (streamManager as any).client;
          if (client) {
            try {
              const guild = await client.guilds.fetch(context.guildId);
              const member = await guild.members.fetch(context.userId);
              if (member?.voice?.channel) {
                voiceChannelId = member.voice.channel.id;
              }
            } catch (error) {
              // Ignore
            }
          }
        }

        // If still no voice channel, we can't proceed with streaming
        // But we should still try to search and show results, then ask for voice channel
        if (!voiceChannelId) {
          // For now, we need a voice channel to proceed
          // In the future, we could modify streamContent to allow search without voice channel
          return {
            success: false,
            error:
              "You need to be in a voice channel to stream videos. Please join a voice channel first, then try again.",
          };
        }

        const result = await streamManager.streamContent({
          guildId: context.guildId,
          voiceChannelId,
          query,
          provider: "youtube", // Use YouTube provider
        });

        if (result.success) {
          // If multiple results found, format them for user selection
          if (result.requiresSelection && result.searchResults) {
            const optionsText = result.searchResults
              .map(
                (r, i) =>
                  `${i + 1}. ${r.title}${
                    r.description ? ` - ${r.description}` : ""
                  }`
              )
              .join("\n");

            const formattedMessage = `Found ${result.searchResults.length} results for "${query}". Please select one:\n\n${optionsText}\n\nReply with the number (1-${result.searchResults.length}) to select.`;

            return {
              success: true,
              formatted: formattedMessage,
              summary: `Found ${result.searchResults.length} YouTube results. Waiting for user selection.`,
              data: {
                searchResults: result.searchResults,
                requiresSelection: true,
              },
            };
          }

          return {
            success: true,
            formatted: result.message,
            summary: `Started streaming YouTube video "${query}"`,
          };
        } else {
          return {
            success: false,
            error: result.error || result.message,
          };
        }
      } catch (error) {
        console.error("[StreamPlayerTools] Error in searchYouTube:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to search YouTube",
        };
      } finally {
        // Remove lock after execution completes
        executionLocks.delete(lockKey);
      }
    })();

    // Store the lock
    executionLocks.set(lockKey, executionPromise);

    // Return the result
    return executionPromise;
  },
};

export const searchJellyfinTool: DatabaseTool = {
  name: "searchJellyfin",
  description:
    "Search Jellyfin for movies or TV shows and stream them to a Discord voice channel. Use this when the user asks to search or stream content from Jellyfin (e.g., 'search for the labyrinth on jellyfin', 'play movie from jellyfin', 'stream from jellyfin'). The bot will search Jellyfin, show results, and allow the user to select which content to stream.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The search query for Jellyfin (e.g., 'the labyrinth', 'apocalypse now', 'the simpsons')",
      },
      channelId: {
        type: "string",
        description:
          "Optional voice channel ID to stream to. If not provided, will use the user's current voice channel.",
      },
    },
    required: ["query"],
  },
  async execute(params, context): Promise<string | DatabaseToolResult> {
    try {
      const { query, channelId } = params;

      if (!query || typeof query !== "string") {
        return {
          success: false,
          error: "Query parameter is required",
        };
      }

      if (!context.guildId) {
        return {
          success: false,
          error: "Guild context required",
        };
      }

      // Get voice channel - auto-detect user's voice channel if not specified
      let voiceChannelId: string;

      if (channelId) {
        voiceChannelId = channelId;
      } else {
        // Try to find user's current voice channel
        const streamManager = StreamPlayerManager.getInstance();
        const client = (streamManager as any).client;

        if (!client) {
          return {
            success: false,
            error: "Bot client not available. Please specify a voice channel.",
          };
        }

        const guild = await client.guilds.fetch(context.guildId);
        if (!guild) {
          return {
            success: false,
            error: "Guild not found",
          };
        }

        // Get the user's voice channel
        const member = await guild.members.fetch(context.userId);
        if (!member?.voice?.channel) {
          return {
            success: false,
            error:
              "You need to be in a voice channel first! Please join a voice channel or specify which channel to stream to.",
          };
        }

        voiceChannelId = member.voice.channel.id;
        console.log(
          `[StreamPlayerTools] Auto-detected user's voice channel: ${member.voice.channel.name} (${voiceChannelId})`
        );
      }

      // Stream content with Jellyfin provider
      const streamManager = StreamPlayerManager.getInstance();
      const result = await streamManager.streamContent({
        guildId: context.guildId,
        voiceChannelId,
        query,
        provider: "jellyfin", // Use Jellyfin provider
      });

      if (result.success) {
        // If multiple results found, format them for user selection
        if (result.requiresSelection && result.searchResults) {
          const optionsText = result.searchResults
            .map(
              (r, i) =>
                `${i + 1}. ${r.title}${r.year ? ` (${r.year})` : ""}${
                  r.description ? ` - ${r.description}` : ""
                }`
            )
            .join("\n");

          const formattedMessage = `${result.message}\n\n${optionsText}\n\nReply with the number (1-${result.searchResults.length}) to select.\n\n[IMPORTANT: When the user replies with a number, you MUST immediately call the selectStreamResult tool with their selection.]`;

          return {
            success: true,
            formatted: formattedMessage,
            summary: `Found ${result.searchResults.length} Jellyfin results. Waiting for user selection. When user replies with a number, call selectStreamResult tool.`,
            data: {
              searchResults: result.searchResults,
              requiresSelection: true,
            },
          };
        }

        return {
          success: true,
          formatted: result.message,
          summary: `Started streaming Jellyfin content "${query}"`,
        };
      } else {
        return {
          success: false,
          error: result.error || result.message,
        };
      }
    } catch (error) {
      console.error("[StreamPlayerTools] Error in searchJellyfin:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to search Jellyfin",
      };
    }
  },
};

/**
 * Export all stream player tools for registration
 */
export const streamPlayerTools: DatabaseTool[] = [
  streamContentTool,
  searchYouTubeTool,
  searchJellyfinTool,
  selectStreamResultTool,
  stopStreamTool,
];
