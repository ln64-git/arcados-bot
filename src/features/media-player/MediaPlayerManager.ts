import type {
  Client,
  Snowflake,
  TextChannel,
  VoiceChannel,
  User,
} from "discord.js";
import {
  createAudioPlayer,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { VoiceConnectionManager } from "../../handlers/voice/tts/services/VoiceConnectionManager.js";
import { AudioQueue } from "./AudioQueue.js";
import { PlaybackController } from "./PlaybackController.js";
import { EmbedController } from "./EmbedController.js";
import { YouTubeService } from "./services/YouTubeService.js";
import type { MediaTrack, MediaPlayerState } from "./types.js";
import { PlaybackState, LoopMode } from "./types.js";

/**
 * Main orchestrator for media player functionality
 * Manages playback, queue, and UI for each guild
 */
export class MediaPlayerManager {
  private static instance: MediaPlayerManager;

  private players: Map<Snowflake, PlaybackController> = new Map();
  private queues: Map<Snowflake, AudioQueue> = new Map();
  private states: Map<Snowflake, MediaPlayerState> = new Map();
  private connectionManager: VoiceConnectionManager;
  private embedController: EmbedController;
  private youtubeService: YouTubeService;
  private client?: Client;
  private embedUpdateIntervals: Map<Snowflake, NodeJS.Timeout> = new Map();

  private constructor() {
    this.connectionManager = VoiceConnectionManager.getInstance();
    this.embedController = new EmbedController();
    this.youtubeService = YouTubeService.getInstance();
  }

  public static getInstance(): MediaPlayerManager {
    if (!MediaPlayerManager.instance) {
      MediaPlayerManager.instance = new MediaPlayerManager();
    }
    return MediaPlayerManager.instance;
  }

  /**
   * Initialize with Discord client
   */
  public initialize(client: Client): void {
    this.client = client;
  }

  /**
   * Get Discord client
   */
  public getClient(): Client | undefined {
    return this.client;
  }

  /**
   * Play a track or search query
   */
  async play(
    guildId: Snowflake,
    query: string,
    user: User,
    channel: TextChannel,
    voiceChannel?: VoiceChannel
  ): Promise<MediaTrack | null> {
    try {
      // Ensure player exists for this guild
      this.ensurePlayer(guildId);

      // Search YouTube
      const track = await this.youtubeService.search(query);
      if (!track) {
        return null;
      }

      // Set queued by
      track.queuedBy = user;

      // Get or create queue
      const queue = this.getQueue(guildId);
      const wasEmpty = queue.isEmpty();

      // Add to queue
      queue.add(track);

      // Join voice channel if needed
      if (voiceChannel) {
        let session = this.connectionManager.getSession(guildId);
        if (!session) {
          await this.connectionManager.joinChannel(voiceChannel);
          session = this.connectionManager.getSession(guildId);
        }

        // Ensure player is subscribed to connection
        this.ensurePlayer(guildId);

        // Wait for connection to be ready (max 10 seconds)
        if (session?.connection) {
          try {
            await entersState(session.connection, VoiceConnectionStatus.Ready, 10_000);
          } catch (error) {
            console.error(
              "[MediaPlayerManager] Connection failed to become ready:",
              error,
            );
            throw new Error("Failed to establish voice connection");
          }
        }
      }

      // Start playback if queue was empty
      if (wasEmpty) {
        await this.startPlayback(guildId, channel);
      } else {
        // Update embed to show new track in queue
        await this.updateEmbed(guildId, channel);
      }

      return track;
    } catch (error) {
      console.error("[MediaPlayerManager] Play error:", error);
      return null;
    }
  }

  /**
   * Start playback from queue
   */
  private async startPlayback(
    guildId: Snowflake,
    channel: TextChannel
  ): Promise<void> {
    const queue = this.getQueue(guildId);
    const player = this.getPlayer(guildId);
    const state = this.getState(guildId);

    const track = queue.getNext();
    if (!track) {
      return;
    }

    // Update state
    state.currentTrack = track;
    state.state = PlaybackState.PLAYING;

    // If channel changed, clear old embed message ID so we create a new embed
    if (state.embedChannelId !== channel.id) {
      console.log(
        `[MediaPlayerManager] Channel changed from ${state.embedChannelId} to ${channel.id}, clearing old embed`
      );
      state.embedMessageId = null;
    }
    state.embedChannelId = channel.id;

    // Ensure player is subscribed to voice connection
    this.ensurePlayer(guildId);

    // Verify connection is ready
    const session = this.connectionManager.getSession(guildId);
    if (!session) {
      throw new Error("No voice connection available");
    }

    // Ensure audio player is subscribed
    const audioPlayer = player.getPlayer();
    try {
      session.connection.subscribe(audioPlayer);
    } catch (error) {
      // Might already be subscribed, that's okay
      console.log("[MediaPlayerManager] Audio player subscription:", error);
    }

    // Play track
    try {
      await player.play(track);
    } catch (error) {
      console.error("[MediaPlayerManager] Failed to play track:", error);

      // Provide specific error message based on error type
      const errorMsg = error instanceof Error ? error.message.toLowerCase() : String(error);
      let userMessage = "❌ Failed to play track";

      if (errorMsg.includes("yt-dlp") && errorMsg.includes("not found")) {
        userMessage += ": yt-dlp is not installed on this server";
      } else if (errorMsg.includes("ffmpeg") && errorMsg.includes("not found")) {
        userMessage += ": ffmpeg is not installed on this server";
      } else if (errorMsg.includes("network") || errorMsg.includes("econnrefused")) {
        userMessage += ": Network connection failed. Please try again later";
      } else if (errorMsg.includes("timeout")) {
        userMessage += ": Request timed out. The video may be too long or unavailable";
      } else if (errorMsg.includes("unavailable") || errorMsg.includes("private")) {
        userMessage += ": Video is unavailable or private";
      } else {
        userMessage += ". Please try another song";
      }

      // Send error message to channel
      await channel.send(userMessage);

      // Reset state
      state.currentTrack = null;
      state.state = PlaybackState.IDLE;

      // Try playing next track if available
      const nextTrack = queue.getNext();
      if (nextTrack) {
        await this.startPlayback(guildId, channel);
      }

      return;
    }

    // Create/update embed
    const message = await this.embedController.createOrUpdateEmbed(
      channel,
      state,
      queue.getLength()
    );

    if (message) {
      state.embedMessageId = message.id;
    }

    // Start embed update interval
    this.startEmbedUpdates(guildId);

    // Set track end callback
    player.setOnTrackEnd(() => {
      this.onTrackEnd(guildId);
    });
  }

  /**
   * Handle track end
   */
  private async onTrackEnd(guildId: Snowflake): Promise<void> {
    const queue = this.getQueue(guildId);
    const state = this.getState(guildId);

    // Get next track
    const nextTrack = queue.getNext();
    if (nextTrack) {
      // Play next track
      const player = this.getPlayer(guildId);
      state.currentTrack = nextTrack;
      state.state = PlaybackState.PLAYING;

      await player.play(nextTrack);

      // Update embed
      if (state.embedChannelId && this.client) {
        const channel = await this.client.channels.fetch(state.embedChannelId);
        if (channel && channel.isTextBased()) {
          await this.updateEmbed(guildId, channel as TextChannel);
        }
      }
    } else {
      // Queue empty - delete the embed
      state.currentTrack = null;
      state.state = PlaybackState.IDLE;
      this.stopEmbedUpdates(guildId);

      // Delete embed if it exists
      if (state.embedChannelId && state.embedMessageId && this.client) {
        try {
          const channel = await this.client.channels.fetch(
            state.embedChannelId
          );
          if (channel && channel.isTextBased()) {
            await this.embedController.deleteEmbed(
              channel as TextChannel,
              state.embedMessageId
            );
          }
        } catch (error) {
          console.error("[MediaPlayerManager] Failed to delete embed:", error);
        }
      }

      // Clear embed references
      state.embedMessageId = null;
      state.embedChannelId = null;
    }
  }

  /**
   * Pause playback
   */
  pause(guildId: Snowflake): void {
    const player = this.getPlayer(guildId);
    const state = this.getState(guildId);

    player.pause();
    state.state = PlaybackState.PAUSED;

    this.updateEmbedIfNeeded(guildId);
  }

  /**
   * Resume playback
   */
  resume(guildId: Snowflake): void {
    const player = this.getPlayer(guildId);
    const state = this.getState(guildId);

    // Ensure the media player's audio is subscribed to the voice connection.
    // TTS or other systems may have temporarily subscribed a different player.
    const session = this.connectionManager.getSession(guildId);
    if (session?.connection) {
      try {
        session.connection.subscribe(player.getPlayer());
      } catch (error) {
        console.error(
          "[MediaPlayerManager] Failed to resubscribe audio player on resume:",
          error
        );
      }
    }

    player.resume();
    state.state = PlaybackState.PLAYING;

    this.updateEmbedIfNeeded(guildId);
  }

  /**
   * Stop playback
   */
  async stop(guildId: Snowflake): Promise<void> {
    const player = this.getPlayer(guildId);
    const queue = this.getQueue(guildId);
    const state = this.getState(guildId);

    player.stop();
    queue.clear();
    state.currentTrack = null;
    state.state = PlaybackState.STOPPED;

    this.stopEmbedUpdates(guildId);

    // Delete embed if it exists
    if (state.embedChannelId && state.embedMessageId && this.client) {
      try {
        const channel = await this.client.channels.fetch(state.embedChannelId);
        if (channel && channel.isTextBased()) {
          await this.embedController.deleteEmbed(
            channel as TextChannel,
            state.embedMessageId
          );
        }
      } catch (error) {
        console.error("[MediaPlayerManager] Failed to delete embed:", error);
      }
    }

    // Clear embed references
    state.embedMessageId = null;
    state.embedChannelId = null;
  }

  /**
   * Skip to next track
   */
  async skip(guildId: Snowflake): Promise<void> {
    const player = this.getPlayer(guildId);
    const state = this.getState(guildId);

    player.stop();
    await this.onTrackEnd(guildId);
  }

  /**
   * Skip to previous track
   */
  async skipBack(guildId: Snowflake): Promise<void> {
    const queue = this.getQueue(guildId);
    const player = this.getPlayer(guildId);
    const state = this.getState(guildId);

    const previousTrack = queue.getPrevious();
    if (previousTrack) {
      player.stop();
      state.currentTrack = previousTrack;
      state.state = PlaybackState.PLAYING;

      await player.play(previousTrack);
      this.updateEmbedIfNeeded(guildId);
    }
  }

  /**
   * Seek forward by specified seconds
   */
  async seekForward(guildId: Snowflake, seconds: number): Promise<void> {
    const player = this.getPlayer(guildId);
    const currentPosition = player.getPosition();
    const newPosition = currentPosition + seconds;

    try {
      await player.seek(newPosition);
      this.updateEmbedIfNeeded(guildId);
    } catch (error) {
      console.error("[MediaPlayerManager] Seek forward error:", error);
    }
  }

  /**
   * Seek backward by specified seconds
   */
  async seekBackward(guildId: Snowflake, seconds: number): Promise<void> {
    const player = this.getPlayer(guildId);
    const currentPosition = player.getPosition();
    const newPosition = Math.max(0, currentPosition - seconds);

    try {
      await player.seek(newPosition);
      this.updateEmbedIfNeeded(guildId);
    } catch (error) {
      console.error("[MediaPlayerManager] Seek backward error:", error);
    }
  }

  /**
   * Set volume
   */
  setVolume(guildId: Snowflake, volume: number): void {
    const player = this.getPlayer(guildId);
    const state = this.getState(guildId);

    // If setting volume while muted, unmute first
    if (state.muted && volume > 0) {
      state.muted = false;
    }

    player.setVolume(volume);
    state.volume = volume;
    if (!state.muted) {
      state.previousVolume = volume;
    }

    this.updateEmbedIfNeeded(guildId);
  }

  /**
   * Star the current track
   * TODO: Implement star functionality (save to favorites, etc.)
   */
  async starTrack(guildId: Snowflake, channel: TextChannel): Promise<void> {
    // Placeholder for future star functionality
    // Could save to database, add to favorites list, etc.
  }

  /**
   * Show queue list as ephemeral message
   */
  async showQueue(guildId: Snowflake, interaction?: any): Promise<void> {
    if (!interaction || !interaction.isRepliable()) {
      return;
    }

    const queue = this.getQueue(guildId);
    const state = this.getState(guildId);
    const allTracks = queue.getAll();
    const currentTrack = state.currentTrack;

    if (allTracks.length === 0 && !currentTrack) {
      await interaction.reply({
        content: "📋 **Queue is empty**",
        ephemeral: true,
      });
      return;
    }

    // Helper to extract clean song title and artist
    const parseTrack = (track: MediaTrack) => {
      let songTitle = track.title;
      let artist = track.channel || "Unknown Artist";

      // Try to parse "Artist - Song" format
      const titleMatch = track.title.match(/^(.+?)\s*-\s*(.+)$/);
      if (titleMatch && titleMatch[1] && titleMatch[2]) {
        artist = titleMatch[1].trim();
        songTitle = titleMatch[2].trim();
      }

      // Clean title (remove things like "(Official Audio)", etc.)
      songTitle = songTitle
        .replace(/\s*\(Official\s+(Audio|Video|Music\s+Video)\)/gi, "")
        .replace(/\s*\[Official\s+(Audio|Video|Music\s+Video)\]/gi, "")
        .trim();

      return { songTitle, artist, duration: track.durationFormatted };
    };

    let queueText = "";

    // Show currently playing track
    if (currentTrack) {
      const { songTitle, artist, duration } = parseTrack(currentTrack);
      queueText += `**Now Playing**\n`;
      queueText += `${songTitle}\n`;
      queueText += `${artist} • ${duration}\n\n`;
    }

    // Show queued tracks
    if (allTracks.length > 0) {
      queueText += `**Up Next** (${allTracks.length})\n`;
      allTracks.forEach((track, index) => {
        const { songTitle, artist, duration } = parseTrack(track);
        const position = index + 1;
        queueText += `\n${position}. **${songTitle}**\n`;
        queueText += `   ${artist} • ${duration}`;
      });
    } else if (!currentTrack) {
      queueText += "No tracks in queue";
    }

    // Discord message limit is 2000 characters
    if (queueText.length > 2000) {
      queueText = queueText.substring(0, 1997) + "...";
    }

    await interaction.reply({
      content: queueText,
      ephemeral: true,
    });
  }

  /**
   * Get current state
   */
  getState(guildId: Snowflake): MediaPlayerState {
    if (!this.states.has(guildId)) {
      this.states.set(guildId, {
        state: PlaybackState.IDLE,
        currentTrack: null,
        position: 0,
        volume: 100,
        muted: false,
        previousVolume: 100,
        loopMode: LoopMode.OFF,
        shuffle: false,
        embedChannelId: null,
        embedMessageId: null,
      });
    }
    return this.states.get(guildId)!;
  }

  /**
   * Get queue
   */
  getQueue(guildId: Snowflake): AudioQueue {
    if (!this.queues.has(guildId)) {
      this.queues.set(guildId, new AudioQueue());
    }
    return this.queues.get(guildId)!;
  }

  /**
   * Get player
   */
  private getPlayer(guildId: Snowflake): PlaybackController {
    if (!this.players.has(guildId)) {
      this.ensurePlayer(guildId);
    }
    return this.players.get(guildId)!;
  }

  /**
   * Ensure player exists for guild
   */
  private ensurePlayer(guildId: Snowflake): void {
    if (!this.players.has(guildId)) {
      const audioPlayer = createAudioPlayer();
      const player = new PlaybackController(audioPlayer);

      // Subscribe to voice connection if available
      const session = this.connectionManager.getSession(guildId);
      if (session) {
        session.connection.subscribe(audioPlayer);
      }

      this.players.set(guildId, player);
    } else {
      // Ensure subscription is active
      const player = this.players.get(guildId)!;
      const session = this.connectionManager.getSession(guildId);
      if (session) {
        const audioPlayer = player.getPlayer();
        try {
          session.connection.subscribe(audioPlayer);
        } catch {
          // Already subscribed, ignore
        }
      }
    }
  }

  /**
   * Update embed if channel is available
   */
  private async updateEmbedIfNeeded(guildId: Snowflake): Promise<void> {
    const state = this.getState(guildId);
    if (state.embedChannelId && this.client) {
      try {
        const channel = await this.client.channels.fetch(state.embedChannelId);
        if (channel && channel.isTextBased()) {
          await this.updateEmbed(guildId, channel as TextChannel);
        }
      } catch (error) {
        console.error("[MediaPlayerManager] Failed to update embed:", error);
      }
    }
  }

  /**
   * Update embed
   */
  private async updateEmbed(
    guildId: Snowflake,
    channel: TextChannel
  ): Promise<void> {
    const state = this.getState(guildId);
    const queue = this.getQueue(guildId);

    // Update position from player
    const player = this.getPlayer(guildId);
    state.position = player.getPosition();

    await this.embedController.createOrUpdateEmbed(
      channel,
      state,
      queue.getLength()
    );
  }

  /**
   * Start periodic embed updates
   */
  private startEmbedUpdates(guildId: Snowflake): void {
    this.stopEmbedUpdates(guildId);

    const interval = setInterval(async () => {
      await this.updateEmbedIfNeeded(guildId);
    }, 5000); // Update every 5 seconds

    this.embedUpdateIntervals.set(guildId, interval);
  }

  /**
   * Stop periodic embed updates
   */
  private stopEmbedUpdates(guildId: Snowflake): void {
    const interval = this.embedUpdateIntervals.get(guildId);
    if (interval) {
      clearInterval(interval);
      this.embedUpdateIntervals.delete(guildId);
    }
  }

  /**
   * Handle button interaction
   */
  async handleButtonInteraction(
    guildId: Snowflake,
    buttonId: string,
    channel: TextChannel,
    interaction?: any
  ): Promise<void> {
    switch (buttonId) {
      case "media_queue":
        await this.showQueue(guildId, interaction);
        break;
      case "media_play":
        this.resume(guildId);
        break;
      case "media_pause":
        this.pause(guildId);
        break;
      case "media_stop":
        await this.stop(guildId);
        break;
      case "media_next":
        await this.skip(guildId);
        break;
      case "media_previous":
        await this.skipBack(guildId);
        break;
      case "media_forward":
        await this.seekForward(guildId, 10);
        break;
      case "media_back":
        await this.seekBackward(guildId, 10);
        break;
      case "media_shuffle":
        const state = this.getState(guildId);
        state.shuffle = !state.shuffle;
        if (state.shuffle) {
          this.getQueue(guildId).shuffle();
        }
        await this.updateEmbed(guildId, channel);
        break;
      case "media_loop":
        const queue = this.getQueue(guildId);
        const newLoopMode = queue.toggleLoopMode();
        const state2 = this.getState(guildId);
        state2.loopMode = newLoopMode;
        await this.updateEmbed(guildId, channel);
        break;
      case "media_volume_down":
        const currentVol = this.getState(guildId).volume;
        this.setVolume(guildId, Math.max(0, currentVol - 10));
        break;
      case "media_volume_up":
        const currentVol2 = this.getState(guildId).volume;
        this.setVolume(guildId, Math.min(100, currentVol2 + 10));
        break;
      case "media_star":
        await this.starTrack(guildId, channel);
        break;
    }
  }

  /**
   * Cleanup resources for a specific guild
   * Called when bot leaves voice channel or guild
   */
  cleanupGuild(guildId: Snowflake): void {
    // Stop embed updates
    this.stopEmbedUpdates(guildId);

    // Cleanup player and kill any active processes
    const player = this.players.get(guildId);
    if (player) {
      player.cleanup();
      this.players.delete(guildId);
    }

    // Clear queue
    const queue = this.queues.get(guildId);
    if (queue) {
      queue.clear();
      this.queues.delete(guildId);
    }

    // Clear state
    this.states.delete(guildId);

    console.log(`[MediaPlayerManager] Cleaned up resources for guild ${guildId}`);
  }

  /**
   * Cleanup all resources
   * Called when bot shuts down
   */
  cleanupAll(): void {
    console.log("[MediaPlayerManager] Cleaning up all resources...");

    // Cleanup all guilds
    for (const guildId of this.players.keys()) {
      this.cleanupGuild(guildId);
    }

    console.log("[MediaPlayerManager] All resources cleaned up");
  }
}
