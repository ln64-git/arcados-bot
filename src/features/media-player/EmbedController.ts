import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message,
  type TextChannel,
  type Snowflake,
} from "discord.js";
import type { MediaTrack, MediaPlayerState } from "./types.js";
import { PlaybackState, LoopMode } from "./types.js";

/**
 * Configuration for custom emoji IDs (for white/monochrome icons)
 *
 * To use custom emojis (like Euphony bot's white icons):
 * 1. Upload white/monochrome emoji images to your Discord server
 * 2. Get the emoji ID (right-click emoji > Copy ID, or use Developer Mode)
 * 3. Pass the emoji IDs in this config when creating EmbedController
 *
 * Example:
 * ```typescript
 * const emojiConfig: EmojiConfig = {
 *   play: "1234567890123456789",
 *   pause: "9876543210987654321",
 *   // ... etc
 * };
 * const embedController = new EmbedController(emojiConfig);
 * ```
 *
 * Leave undefined to use Unicode emojis (colored).
 */
export interface EmojiConfig {
  queue?: string; // Custom emoji ID for queue button
  previous?: string;
  back?: string;
  play?: string;
  pause?: string;
  forward?: string;
  next?: string;
  stop?: string;
  shuffle?: string;
  loop?: string;
  volumeDown?: string;
  volumeUp?: string;
}

/**
 * Creates and manages Discord embeds for media player
 */
export class EmbedController {
  /**
   * Crop thumbnail URL to square format
   * Uses an image proxy service to crop the image to a square
   */
  private cropThumbnailToSquare(thumbnailUrl: string): string {
    // Use images.weserv.nl to crop to square (centered crop)
    // This service crops images to square format on the fly
    if (
      thumbnailUrl.includes("youtube.com") ||
      thumbnailUrl.includes("img.youtube.com")
    ) {
      // Extract the video ID if it's a YouTube URL
      const videoIdMatch = thumbnailUrl.match(
        /[?&]v=([^&]+)|youtu\.be\/([^?]+)|vi\/([^\/]+)/
      );
      if (videoIdMatch) {
        const videoId = videoIdMatch[1] || videoIdMatch[2] || videoIdMatch[3];
        // Use YouTube's thumbnail and crop to square via proxy
        return `https://images.weserv.nl/?url=https://img.youtube.com/vi/${videoId}/maxresdefault.jpg&w=512&h=512&fit=cover&output=webp`;
      }
    }

    // For other URLs, use the proxy service to crop to square
    return `https://images.weserv.nl/?url=${encodeURIComponent(
      thumbnailUrl
    )}&w=512&h=512&fit=cover&output=webp`;
  }
  /**
   * Delete the media player embed
   */
  async deleteEmbed(
    channel: TextChannel,
    messageId: Snowflake
  ): Promise<boolean> {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
      return true;
    } catch (error) {
      // Message might have been deleted already or doesn't exist
      return false;
    }
  }

  /**
   * Create or update the media player embed
   */
  async createOrUpdateEmbed(
    channel: TextChannel,
    state: MediaPlayerState,
    queueLength: number
  ): Promise<Message | null> {
    const embed = this.buildEmbed(state, queueLength);
    const components = this.buildComponents(state);

    try {
      // If we have an existing message, try to update it
      if (state.embedMessageId) {
        try {
          const message = await channel.messages.fetch(state.embedMessageId);
          // Verify the message is in the correct channel
          if (message.channel.id === channel.id) {
            await message.edit({
              embeds: [embed],
              components: components,
            });
            return message;
          } else {
            // Message is in a different channel, create new one
            console.log(
              `[EmbedController] Embed message is in different channel (${message.channel.id} vs ${channel.id}), creating new embed`
            );
          }
        } catch (error) {
          // Message might have been deleted or doesn't exist in this channel, create new one
          console.log(
            "[EmbedController] Failed to fetch embed message, creating new one:",
            error
          );
        }
      }

      // Create new embed in the specified channel
      const message = await channel.send({
        embeds: [embed],
        components: components,
      });

      console.log(
        `[EmbedController] Created new embed in channel: ${channel.name} (${channel.id})`
      );

      return message;
    } catch (error) {
      console.error("[EmbedController] Error creating/updating embed:", error);
      return null;
    }
  }

  /**
   * Build the embed
   */
  private buildEmbed(
    state: MediaPlayerState,
    queueLength: number
  ): EmbedBuilder {
    const embed = new EmbedBuilder();

    if (state.currentTrack) {
      const track = state.currentTrack;

      // Extract song title and artist from track title
      // Format is usually "Artist - Song Title" or just "Song Title"
      let songTitle = track.title;
      let artist = track.channel || "Unknown Artist";

      // Try to parse "Artist - Song" format
      const titleMatch = track.title.match(/^(.+?)\s*-\s*(.+)$/);
      if (titleMatch && titleMatch[1] && titleMatch[2]) {
        artist = titleMatch[1].trim();
        songTitle = titleMatch[2].trim();
      }

      // Clean title (remove things like "(Official Audio)", "(Official Video)", etc.)
      songTitle = songTitle
        .replace(/\s*\(Official\s+(Audio|Video|Music\s+Video)\)/gi, "")
        .replace(/\s*\[Official\s+(Audio|Video|Music\s+Video)\]/gi, "")
        .trim();

      // Format duration as [MM:SS] or [H:MM:SS]
      const duration = this.formatTime(Math.floor(track.duration));

      // Set title to just the song name (cleaner)
      embed.setTitle(songTitle);
      embed.setURL(track.url);
      // Thumbnail in top right corner - crop to square
      const squareThumbnail = this.cropThumbnailToSquare(track.thumbnail);
      embed.setThumbnail(squareThumbnail);

      // Description: Queued by user at top, then artist and duration
      embed.setDescription(
        `**Queued by:** <@${track.queuedBy.id}>\n**${artist}** [${duration}]`
      );

      // Volume
      embed.addFields({
        name: "Volume",
        value: `${state.volume}%`,
        inline: true,
      });

      // Queue info (only if there are more tracks)
      if (queueLength > 1) {
        embed.addFields({
          name: "Queue",
          value: `${queueLength - 1} track${queueLength - 1 === 1 ? "" : "s"}`,
          inline: true,
        });
      }

      // Color: Use a nice blue color like Euphony (or keep it subtle gray)
      embed.setColor(0x5865f2); // Discord blurple
    } else {
      embed.setTitle("Media Player");
      embed.setDescription("No track currently playing");
      embed.setColor(0x808080);
    }

    return embed;
  }

  /**
   * Build button components
   * Cleaner layout like Euphony bot - monochromatic emojis, no colored backgrounds
   */
  private buildComponents(
    state: MediaPlayerState
  ): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    // Row 1: Main playback controls (like Euphony: playlist, skip back, pause, skip forward, shuffle)
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("media_queue")
        .setLabel("📋")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null),
      new ButtonBuilder()
        .setCustomId("media_back")
        .setLabel("⏪")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null),
      new ButtonBuilder()
        .setCustomId(
          state.state === PlaybackState.PLAYING ? "media_pause" : "media_play"
        )
        .setLabel(state.state === PlaybackState.PLAYING ? "⏸️" : "▶️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null),
      new ButtonBuilder()
        .setCustomId("media_forward")
        .setLabel("⏩")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null),
      new ButtonBuilder()
        .setCustomId("media_shuffle")
        .setLabel("🔀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null)
    );

    // Row 2: Secondary controls (like Euphony: stop, loop, volume, previous)
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("media_stop")
        .setLabel("⏹️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null),
      new ButtonBuilder()
        .setCustomId("media_loop")
        .setLabel(
          state.loopMode === LoopMode.ONE
            ? "🔂" // Loop one
            : state.loopMode === LoopMode.ALL
            ? "🔁" // Loop all
            : "🔁" // Loop off (same icon, but different style)
        )
        .setStyle(
          state.loopMode !== LoopMode.OFF
            ? ButtonStyle.Primary
            : ButtonStyle.Secondary
        )
        .setDisabled(state.currentTrack === null),
      new ButtonBuilder()
        .setCustomId("media_volume_down")
        .setLabel("🔉")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null),
      new ButtonBuilder()
        .setCustomId("media_volume_up")
        .setLabel("🔊")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null),
      new ButtonBuilder()
        .setCustomId("media_star")
        .setLabel("⭐")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.currentTrack === null)
    );

    rows.push(row1, row2);
    return rows;
  }

  /**
   * Format progress bar
   */
  private formatProgress(current: number, total: number): string {
    const totalSeconds = Math.floor(total);
    const currentSeconds = Math.floor(current);
    const percentage = total > 0 ? current / total : 0;

    const barLength = 20;
    const filled = Math.floor(percentage * barLength);
    const empty = barLength - filled;

    const bar = "█".repeat(filled) + "░".repeat(empty);
    const currentTime = this.formatTime(currentSeconds);
    const totalTime = this.formatTime(totalSeconds);

    return `${bar} ${currentTime}/${totalTime}`;
  }

  /**
   * Format time in seconds to MM:SS or HH:MM:SS
   */
  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }

    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }
}
