import {
  type VoiceConnection,
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState,
  type AudioPlayer,
  EndBehaviorType,
} from "@discordjs/voice";
import type { VoiceChannel, Snowflake } from "discord.js";
import { Readable, pipeline } from "node:stream";
import { promisify } from "node:util";
import prism from "prism-media";
import type { VoiceSession } from "../types.js";
import { VoiceConnectionState } from "../types.js";
import { VoiceLogger } from "../utils/VoiceLogger.js";

const pipelineAsync = promisify(pipeline);

/**
 * Manages Discord voice connections and audio playback
 * Handles joining/leaving voice channels and streaming audio
 */
export class VoiceConnectionManager {
  private static instance: VoiceConnectionManager;

  // Active voice sessions by guild ID
  private sessions: Map<Snowflake, VoiceSession> = new Map();

  // Audio players by guild ID
  private audioPlayers: Map<Snowflake, AudioPlayer> = new Map();

  private logger: VoiceLogger;

  private constructor() {
    this.logger = new VoiceLogger("VoiceConnection");
  }

  public static getInstance(): VoiceConnectionManager {
    if (!VoiceConnectionManager.instance) {
      VoiceConnectionManager.instance = new VoiceConnectionManager();
    }
    return VoiceConnectionManager.instance;
  }

  /**
   * Join a voice channel
   *
   * @param channel Voice channel to join
   * @returns Voice session
   */
  public async joinChannel(channel: VoiceChannel): Promise<VoiceSession> {
    const { guild, id: channelId } = channel;

    // Check if already connected
    const existingSession = this.sessions.get(guild.id);
    if (existingSession) {
      // If connected to the same channel, return existing session
      if (existingSession.channelId === channelId) {
        return existingSession;
      }

      // Otherwise, disconnect from current channel first
      await this.leaveChannel(guild.id);
    }

    try {
      // Join the voice channel
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false, // Don't self-deafen so we can hear users
        selfMute: false,
      });

      // Wait for connection to be ready
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

      // Create audio player
      const player = createAudioPlayer();
      connection.subscribe(player);

      // Store the player
      this.audioPlayers.set(guild.id, player);

      // Get current participants
      const participants = new Set<string>();
      for (const [userId] of channel.members) {
        if (userId !== channel.client.user?.id) {
          participants.add(userId);
        }
      }

      // Create voice session
      const session: VoiceSession = {
        sessionId: `${guild.id}-${Date.now()}`,
        guildId: guild.id,
        channelId: channel.id,
        channel,
        connection,
        participants,
        transcriptionBuffer: "",
        lastActivity: new Date(),
        isListening: true,
        isSpeaking: false,
        transcriptions: [],
      };

      // Set up connection event handlers
      this.setupConnectionHandlers(session);

      // Store session
      this.sessions.set(guild.id, session);

      this.logger.info(
        `Joined voice channel ${channel.name} in guild ${guild.name}`
      );

      return session;
    } catch (error) {
      this.logger.error(`Failed to join voice channel:`, error);
      throw new Error(
        `Failed to join voice channel: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Leave a voice channel
   *
   * @param guildId Guild ID
   */
  public async leaveChannel(guildId: Snowflake): Promise<void> {
    const session = this.sessions.get(guildId);

    if (!session) {
      this.logger.warn(`No active session found for guild ${guildId}`);
      return;
    }

    try {
      // Stop the audio player
      const player = this.audioPlayers.get(guildId);
      if (player) {
        player.stop();
        this.audioPlayers.delete(guildId);
      }

      // Destroy the connection
      session.connection.destroy();

      // Remove session
      this.sessions.delete(guildId);

      this.logger.info(`Left voice channel in guild ${guildId}`);
    } catch (error) {
      this.logger.error(`Error leaving voice channel:`, error);
    }
  }

  /**
   * Play audio in the voice channel
   *
   * @param guildId Guild ID
   * @param audioBuffer Audio buffer (PCM or other format supported by Discord)
   * @returns Promise that resolves when audio finishes playing
   */
  public async playAudio(
    guildId: Snowflake,
    audioBuffer: Buffer
  ): Promise<void> {
    const session = this.sessions.get(guildId);
    const player = this.audioPlayers.get(guildId);

    this.logger.debug(
      `playAudio called for guild ${guildId}, buffer size: ${audioBuffer.length} bytes`
    );

    if (!session || !player) {
      throw new Error(`No active voice session for guild ${guildId}`);
    }

    this.logger.debug(
      `Session found: ${session.sessionId}, player state: ${player.state.status}`
    );

    // If player is already playing, wait for it to finish first
    if (
      player.state.status === AudioPlayerStatus.Playing ||
      player.state.status === AudioPlayerStatus.Buffering
    ) {
      this.logger.debug(
        `Player is ${player.state.status}, waiting for current playback to finish...`
      );
      await new Promise<void>((resolve) => {
        player.once(AudioPlayerStatus.Idle, () => {
          this.logger.debug("Previous playback finished, ready for next chunk");
          resolve();
        });
      });
    }

    // Mark as speaking
    session.isSpeaking = true;

    try {
      // Create a readable stream from the buffer
      const stream = Readable.from(audioBuffer);
      this.logger.debug("Created readable stream from buffer");

      // Create audio resource (no inputType needed, defaults to Arbitrary)
      const resource = createAudioResource(stream);
      this.logger.debug(
        `Created audio resource, playbackDuration: ${resource.playbackDuration}ms`
      );

      // Play the audio
      player.play(resource);
      this.logger.debug(
        `Started playback, player state: ${player.state.status}`
      );

      // Wait for playback to finish with proper cleanup
      await new Promise<void>((resolve, reject) => {
        let timeoutHandle: NodeJS.Timeout;

        const onIdle = () => {
          clearTimeout(timeoutHandle);
          player.off("error", onError);
          this.logger.debug("Player became idle (playback finished)");
          resolve();
        };

        const onError = (error: Error) => {
          clearTimeout(timeoutHandle);
          player.off(AudioPlayerStatus.Idle, onIdle);
          this.logger.error("Player error:", error);
          reject(error);
        };

        player.once(AudioPlayerStatus.Idle, onIdle);
        player.once("error", onError);

        // Timeout after 60 seconds
        timeoutHandle = setTimeout(() => {
          player.off(AudioPlayerStatus.Idle, onIdle);
          player.off("error", onError);
          this.logger.error(
            `Playback timeout after 60s, player state: ${player.state.status}`
          );
          reject(new Error("Audio playback timeout"));
        }, 60000);
      });

      this.logger.debug("Audio playback completed successfully");
    } catch (error) {
      this.logger.error("Error during playback:", error);
      throw error;
    } finally {
      // Mark as not speaking
      session.isSpeaking = false;
      this.logger.debug("Marked session as not speaking");
    }
  }

  /**
   * Pause current playback if active.
   */
  public pausePlayback(guildId: Snowflake): boolean {
    const player = this.audioPlayers.get(guildId);

    if (!player) {
      this.logger.warn(
        `Cannot pause playback: no audio player for guild ${guildId}`
      );
      return false;
    }

    const paused = player.pause(true);

    if (paused) {
      this.logger.info(`Paused playback in guild ${guildId}`);
    } else {
      this.logger.warn(
        `Failed to pause playback in guild ${guildId}, player state: ${player.state.status}`
      );
    }

    return paused;
  }

  /**
   * Resume playback if it was previously paused.
   */
  public resumePlayback(guildId: Snowflake): boolean {
    const player = this.audioPlayers.get(guildId);

    if (!player) {
      this.logger.warn(
        `Cannot resume playback: no audio player for guild ${guildId}`
      );
      return false;
    }

    const resumed = player.unpause();

    if (resumed) {
      this.logger.info(`Resumed playback in guild ${guildId}`);
    } else {
      this.logger.warn(
        `Failed to resume playback in guild ${guildId}, player state: ${player.state.status}`
      );
    }

    return resumed;
  }

  /**
   * Stop playback and clear any queued audio.
   */
  public stopPlayback(guildId: Snowflake): boolean {
    const player = this.audioPlayers.get(guildId);
    const session = this.sessions.get(guildId);

    if (!player) {
      this.logger.warn(
        `Cannot stop playback: no audio player for guild ${guildId}`
      );
      return false;
    }

    player.stop(true);

    if (session) {
      session.isSpeaking = false;
    }

    this.logger.info(`Stopped playback in guild ${guildId}`);
    return true;
  }

  /**
   * Play audio chunks sequentially for streaming playback
   * Starts playing first chunk immediately while others are being generated
   *
   * @param guildId Guild ID
   * @param audioChunks Async iterator of audio buffers
   */
  public async playAudioStream(
    guildId: Snowflake,
    audioChunks: AsyncIterable<Buffer>
  ): Promise<void> {
    const session = this.sessions.get(guildId);
    const player = this.audioPlayers.get(guildId);

    if (!session || !player) {
      throw new Error(`No active voice session for guild ${guildId}`);
    }

    session.isSpeaking = true;

    try {
      for await (const chunk of audioChunks) {
        await this.playAudio(guildId, chunk);
      }
    } finally {
      session.isSpeaking = false;
    }
  }

  /**
   * Start receiving audio from the voice channel
   * Sets up audio receive stream for transcription
   *
   * @param guildId Guild ID
   * @param onAudioReceived Callback for received audio data
   */
  public startReceiving(
    guildId: Snowflake,
    onAudioReceived: (userId: string, audioData: Buffer) => void
  ): void {
    const session = this.sessions.get(guildId);

    if (!session) {
      throw new Error(`No active voice session for guild ${guildId}`);
    }

    this.logger.debug(`Setting up audio receiver for guild ${guildId}`);

    const { connection } = session;

    // Set up receiver for each user
    connection.receiver.speaking.on("start", (userId) => {
      this.logger.debug(`User ${userId} started speaking`);

      // Create opus stream for this user
      const opusStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000, // End after 1 second of silence
        },
      });

      this.logger.debug(`Created opus stream for user ${userId}`);

      // Decode Opus to PCM
      const decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2, // Stereo
        rate: 48000, // 48kHz
      });

      this.logger.debug(`Created Opus decoder for user ${userId}`);

      // Collect decoded PCM audio data
      const audioChunks: Buffer[] = [];

      // Pipe opus stream through decoder
      opusStream.pipe(decoder);

      decoder.on("data", (chunk: Buffer) => {
        audioChunks.push(chunk);
      });

      decoder.on("end", () => {
        this.logger.debug(
          `Decoder ended for user ${userId}, collected ${audioChunks.length} PCM chunks`
        );

        if (audioChunks.length > 0) {
          const combinedAudio = Buffer.concat(audioChunks);
          this.logger.debug(
            `Sending combined PCM audio to callback: ${combinedAudio.length} bytes`
          );
          onAudioReceived(userId, combinedAudio);
        } else {
          this.logger.warn(
            `No PCM audio chunks collected for user ${userId}`
          );
        }
      });

      decoder.on("error", (error) => {
        this.logger.error(`Decoder error for user ${userId}:`, error);
      });

      opusStream.on("error", (error) => {
        this.logger.error(`Opus stream error for user ${userId}:`, error);
      });
    });

    this.logger.debug(
      "Audio receiver setup complete, waiting for users to speak..."
    );
  }

  /**
   * Get current voice session
   *
   * @param guildId Guild ID
   * @returns Voice session or undefined
   */
  public getSession(guildId: Snowflake): VoiceSession | undefined {
    return this.sessions.get(guildId);
  }

  /**
   * Check if bot is connected to voice channel in a guild
   *
   * @param guildId Guild ID
   * @returns True if connected
   */
  public isConnected(guildId: Snowflake): boolean {
    return this.sessions.has(guildId);
  }

  /**
   * Get connection state
   *
   * @param guildId Guild ID
   * @returns Connection state
   */
  public getConnectionState(guildId: Snowflake): VoiceConnectionState {
    const session = this.sessions.get(guildId);

    if (!session) {
      return VoiceConnectionState.DISCONNECTED;
    }

    const { connection } = session;

    switch (connection.state.status) {
      case VoiceConnectionStatus.Ready:
        if (session.isSpeaking) {
          return VoiceConnectionState.SPEAKING;
        }
        if (session.isListening) {
          return VoiceConnectionState.LISTENING;
        }
        return VoiceConnectionState.READY;

      case VoiceConnectionStatus.Connecting:
      case VoiceConnectionStatus.Signalling:
        return VoiceConnectionState.CONNECTING;

      case VoiceConnectionStatus.Disconnected:
      case VoiceConnectionStatus.Destroyed:
        return VoiceConnectionState.DISCONNECTED;

      default:
        return VoiceConnectionState.ERROR;
    }
  }

  /**
   * Set up connection event handlers
   *
   * @param session Voice session
   */
  private setupConnectionHandlers(session: VoiceSession): void {
    const { connection } = session;

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Try to reconnect
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // Disconnect if reconnection fails
        this.logger.warn(
          `Failed to reconnect in guild ${session.guildId}`
        );
        connection.destroy();
        this.sessions.delete(session.guildId);
      }
    });

    connection.on("error", (error) => {
      this.logger.error(
        `Connection error in guild ${session.guildId}:`,
        error
      );
    });
  }

  /**
   * Get all active sessions
   */
  public getAllSessions(): VoiceSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clean up all connections
   */
  public cleanup(): void {
    for (const [guildId] of this.sessions) {
      this.leaveChannel(guildId);
    }
  }
}
