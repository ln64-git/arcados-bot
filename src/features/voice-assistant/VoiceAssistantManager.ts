import type { VoiceChannel, Snowflake, Client } from "discord.js";
import { VoiceConnectionManager } from "./services/VoiceConnectionManager.js";
import { AudioProcessor } from "./services/AudioProcessor.js";
import { WhisperTranscriber } from "./services/WhisperTranscriber.js";
import { TTSManager } from "./services/TTSManager.js";
import { TriggerWordDetector } from "./services/TriggerWordDetector.js";
import { AIManager } from "../../ai/core/AIManager.js";
import { config } from "../../config/index.js";
import { VoiceLogger } from "./utils/VoiceLogger.js";
import { AudioToneGenerator } from "./utils/AudioToneGenerator.js";
import { MediaPlayerManager } from "../media-player/MediaPlayerManager.js";
import type { VoiceSession, TranscriptionEntry, TTSChunk } from "./types.js";
import {
  VoiceAssistantEvent,
  VoiceAssistantErrorType,
  VoiceMode,
} from "./types.js";
import {
  TRANSCRIPTION_CONSTANTS,
  AI_CONSTANTS,
  CONVERSATION_CONSTANTS,
  AUDIO_CONSTANTS,
} from "./constants.js";

export enum VoiceControlCommand {
  LEAVE = "leave",
  STOP = "stop",
  PAUSE = "pause",
  PLAY = "play",
  SWITCH_TO_CONVERSATION = "switch_to_conversation",
  SWITCH_TO_COMMAND = "switch_to_command",
}

interface PlaybackControllerState {
  paused: boolean;
  aborted: boolean;
  resumeResolvers: Array<() => void>;
}

/**
 * Main orchestrator for voice assistant functionality
 * Coordinates all voice services to provide real-time voice conversation
 *
 * Pipeline:
 * 1. User speaks in voice channel
 * 2. Discord audio → AudioProcessor (chunking)
 * 3. Audio chunks → WhisperTranscriber (STT)
 * 4. Transcription → TriggerWordDetector (check for "Aria")
 * 5. If triggered → AIManager (generate response)
 * 6. AI response → TTSManager (TTS, chunked with Cartesia/Google fallback)
 * 7. TTS chunks → VoiceConnectionManager (playback)
 */
export class VoiceAssistantManager {
  private static instance: VoiceAssistantManager;

  private connectionManager: VoiceConnectionManager;
  private audioProcessor: AudioProcessor;
  private transcriber: WhisperTranscriber;
  private tts: TTSManager;
  private triggerDetector: TriggerWordDetector;
  private aiManager: AIManager;
  private mediaPlayer: MediaPlayerManager;
  private client?: Client;
  private logger: VoiceLogger;

  // Transcription interval timers
  private transcriptionTimers: Map<Snowflake, NodeJS.Timeout> = new Map();

  // Processing locks to prevent duplicate responses
  private processingLocks: Map<Snowflake, boolean> = new Map();

  // Playback controllers per guild for pause/stop coordination
  private playbackControllers: Map<Snowflake, PlaybackControllerState> =
    new Map();

  // Mode state tracking
  private sessionModes: Map<Snowflake, VoiceMode> = new Map();
  private conversationUsers: Map<Snowflake, string> = new Map();

  // Interruption tracking
  private interruptionCallbacks: Map<Snowflake, (userId: string) => void> =
    new Map();

  // Track when sessions started to ignore audio for a brief period after joining
  private sessionStartTimes: Map<Snowflake, number> = new Map();

  private readonly controlKeywords: Record<VoiceControlCommand, string[]> = {
    [VoiceControlCommand.LEAVE]: [
      "leave",
      "leave call",
      "leave the call",
      "disconnect",
      "exit",
      "exit call",
      "hop out",
      "go away",
      "drop off",
    ],
    [VoiceControlCommand.STOP]: [
      "stop",
      "stop talking",
      "stop playback",
      "stop audio",
      "clear",
      "clear audio",
      "clear response",
      "cancel response",
      "end response",
      "shut up",
    ],
    [VoiceControlCommand.PAUSE]: [
      "pause",
      "paz",
      "paws",
      "pause it",
      "pause audio",
      "hold on",
      "hold up",
      "wait",
      "hang on",
    ],
    [VoiceControlCommand.PLAY]: [
      "play",
      "resume",
      "continue",
      "keep going",
      "go ahead",
      "carry on",
      "start again",
    ],
    [VoiceControlCommand.SWITCH_TO_CONVERSATION]: [
      "switch to conversation mode",
      "conversation mode",
      "let's have a conversation",
      "let's talk",
      "start conversation",
      "conversation",
    ],
    [VoiceControlCommand.SWITCH_TO_COMMAND]: [
      "switch to command mode",
      "command mode",
      "back to commands",
      "exit conversation",
      "command",
    ],
  };

  private constructor() {
    this.connectionManager = VoiceConnectionManager.getInstance();
    this.audioProcessor = AudioProcessor.getInstance();
    this.transcriber = WhisperTranscriber.getInstance();
    this.tts = TTSManager.getInstance();
    this.triggerDetector = TriggerWordDetector.getInstance();
    this.aiManager = AIManager.getInstance();
    this.mediaPlayer = MediaPlayerManager.getInstance();
    this.logger = new VoiceLogger("🎧");
  }

  public static getInstance(): VoiceAssistantManager {
    if (!VoiceAssistantManager.instance) {
      VoiceAssistantManager.instance = new VoiceAssistantManager();
    }
    return VoiceAssistantManager.instance;
  }

  /**
   * Initialize voice assistant with Discord client
   *
   * @param client Discord client
   */
  public initialize(client: Client): void {
    this.client = client;

    // Check configuration
    if (!config.voiceAssistantEnabled) {
      this.logger.warn("Voice assistant is disabled in config");
      return;
    }

    if (!this.tts.isConfigured()) {
      this.logger.warn("Google TTS not configured. Set GOOGLE_TTS_API_KEY.");
    }

    if (!this.transcriber.isConfigured()) {
      this.logger.warn(
        "Whisper not configured. Set WHISPER_URL or OPENAI_API_KEY."
      );
    }

    // this.logger.info(
    //   `Trigger word: "${this.triggerDetector.getTriggerWord()}"`
    // );
    // this.logger.info(
    //   `TTS: ${this.tts.isConfigured() ? "Ready" : "Not configured"}`
    // );
    // this.logger.info(`STT: ${this.transcriber.getTranscriptionMethod()}`);
  }

  /**
   * Join a voice channel and start listening
   *
   * @param channel Voice channel to join
   * @param requestedByUserId User who requested the join
   * @returns Voice session
   */
  public async joinVoiceChannel(
    channel: VoiceChannel,
    requestedByUserId: string
  ): Promise<VoiceSession> {
    if (!config.voiceAssistantEnabled) {
      throw new Error("Voice assistant is disabled");
    }

    // Join the voice channel
    const session = await this.connectionManager.joinChannel(channel);

    // Stop any existing transcription interval first to prevent processing old audio
    this.stopTranscriptionInterval(session.guildId);

    // Stop any existing audio receiving to prevent processing old audio
    this.connectionManager.stopReceiving(session.guildId);

    // Clear any stale buffers and state when joining
    // Note: VoiceConnectionManager may have already generated a new sessionId
    // Store the current sessionId to clean up
    const currentSessionId = session.sessionId;

    // Clear all buffers and state
    session.transcriptionBuffer = "";
    session.transcriptions = [];
    session.conversationHistory = [];
    session.conversationUserId = undefined;
    session.lastActivity = new Date();

    // Cleanup audio processor buffer for current sessionId
    this.audioProcessor.cleanup(currentSessionId);

    // Clear processing state
    this.processingLocks.delete(session.guildId);
    this.conversationUsers.delete(session.guildId);
    this.playbackControllers.delete(session.guildId);

    // Initialize mode state
    this.sessionModes.set(session.guildId, VoiceMode.COMMAND);

    // Register cleanup callback for when connection is lost
    this.connectionManager.onDisconnect(session.guildId, () => {
      this.logger.info(
        `Connection lost for guild ${session.guildId}, cleaning up...`
      );
      this.stopTranscriptionInterval(session.guildId);
      this.audioProcessor.cleanup(session.sessionId);
      this.processingLocks.delete(session.guildId);
      this.playbackControllers.delete(session.guildId);
      this.sessionModes.delete(session.guildId);
      this.conversationUsers.delete(session.guildId);
      this.interruptionCallbacks.delete(session.guildId);
    });

    // Clear audio processor buffer one more time right before starting to receive
    // This ensures no stale audio from previous sessions
    this.audioProcessor.cleanup(session.sessionId);

    // Set session start time RIGHT BEFORE starting to receive audio
    // VoiceConnectionManager has already cleared all receiver subscriptions
    // at the connection level, so we can start immediately
    const sessionStartTime = Date.now();
    session.sessionStartTime = sessionStartTime;
    this.sessionStartTimes.set(session.guildId, sessionStartTime);

    // Set up interruption detection
    this.setupInterruptionDetection(session);

    // Start receiving audio (stopReceiving was already called earlier)
    this.startReceivingAudio(session);

    // Start transcription check interval
    this.startTranscriptionInterval(session);

    return session;
  }

  /**
   * Leave a voice channel
   *
   * @param guildId Guild ID
   */
  public async leaveVoiceChannel(guildId: Snowflake): Promise<void> {
    this.logger.info(`Leaving voice channel in guild ${guildId}`);

    // Stop transcription interval
    this.stopTranscriptionInterval(guildId);

    // Stop receiving audio
    this.connectionManager.stopReceiving(guildId);

    // Clean up audio processor
    const session = this.connectionManager.getSession(guildId);
    if (session) {
      this.audioProcessor.cleanup(session.sessionId);
    }

    // Clear session start time
    this.sessionStartTimes.delete(guildId);

    // Leave the channel
    await this.connectionManager.leaveChannel(guildId);
  }

  /**
   * Start receiving and processing audio from voice channel
   *
   * @param session Voice session
   */
  private startReceivingAudio(session: VoiceSession): void {
    this.connectionManager.startReceiving(
      session.guildId,
      async (userId, audioData) => {
        // Brief safety margin to catch any edge cases
        // VoiceConnectionManager clears receiver subscriptions at the source
        const sessionStartTime = session.sessionStartTime || this.sessionStartTimes.get(session.guildId);
        if (sessionStartTime && Date.now() - sessionStartTime < 100) {
          // Don't process audio in the first 100ms after starting
          return;
        }

        // Process received audio (buffers it, creates chunks when ready)
        const chunk = this.audioProcessor.processAudio(
          session.sessionId,
          audioData
        );

        if (chunk) {
          // Transcribe the chunk immediately
          await this.handleAudioChunk(session, chunk, userId);
        }
        // Note: We also check for complete utterances after silence in processCompleteUtterance
      }
    );
  }

  // Common Whisper hallucinations to filter out
  private readonly HALLUCINATION_PATTERNS = [
    /^applause$/i,
    /^music$/i,
    /^silence$/i,
    /^\[.*\]$/i, // [BLANK_AUDIO], [MUSIC], etc.
    /^thank you\.?$/i,
    /^thanks for watching\.?$/i,
    /^subscribe\.?$/i,
    /^\(.*\)$/i, // (music), (applause), etc.
    /^all right\.?$/i, // Very common filler hallucination
    /^alright\.?$/i,
    /^okay\.?$/i,
    /^ok\.?$/i,
    /^hmm\.?$/i,
    /^hm\.?$/i,
    /^uh\.?$/i,
    /^um\.?$/i,
    /^ah\.?$/i,
    /^bye\.?$/i, // Common hallucination on silence/background noise
    /^goodbye\.?$/i, // Common hallucination variant
    /^blank.*audio$/i, // [BLANK_AUDIO] variations
    /^blank_audio$/i,
  ];

  /**
   * Check if transcription is likely a Whisper hallucination
   *
   * @param text Transcription text
   * @returns True if likely hallucination
   */
  private isHallucination(text: string): boolean {
    const normalized = text.trim().toLowerCase();

    // Check against known hallucination patterns
    if (
      this.HALLUCINATION_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      return true;
    }

    // Check for transcriptions that are mostly "bye" or "goodbye" with filler words
    // This catches cases like "Bye only the good day young. Bye."
    const words = normalized.split(/[\s.!?,;]+/).filter((w) => w.length > 0);
    const byeWords = words.filter(
      (w) => w === "bye" || w === "goodbye" || w === "by"
    );
    if (byeWords.length > 0 && words.length <= 10) {
      // If "bye" appears and the total word count is low, check if it's mostly filler
      const byeRatio = byeWords.length / words.length;
      // If "bye" makes up a significant portion (30%+) of short phrases, likely hallucination
      if (byeRatio >= 0.3) {
        return true;
      }
      // Also check if "bye" appears at both start and end (common hallucination pattern)
      if (
        (words[0] === "bye" || words[0] === "goodbye" || words[0] === "by") &&
        (words[words.length - 1] === "bye" ||
          words[words.length - 1] === "goodbye" ||
          words[words.length - 1] === "by")
      ) {
        return true;
      }
    }

    // Check for simple repetitions like "Bye. Bye." or "Bye. Bye. Bye."
    // Split by sentence boundaries and check for repeated sentences
    const sentences = normalized
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (sentences.length >= 2) {
      // Check if all sentences are identical (e.g., "Bye. Bye.")
      const uniqueSentences = new Set(sentences);
      if (uniqueSentences.size === 1) {
        return true;
      }

      // Check if there's a clear pattern of repetition (e.g., "A. B. A. B.")
      if (sentences.length >= 4 && uniqueSentences.size === 2) {
        // Check if it's an alternating pattern
        const [first, second] = Array.from(uniqueSentences);
        let isAlternating = true;
        for (let i = 0; i < sentences.length; i++) {
          const expected = i % 2 === 0 ? first : second;
          if (sentences[i] !== expected) {
            isAlternating = false;
            break;
          }
        }
        if (isAlternating) {
          return true;
        }
      }

      // Check if a sequence of sentences repeats (e.g., "A. B. C. A. B. C.")
      // This catches cases like "I didn't mean it. I'm sorry. I didn't mean it. I'm sorry."
      if (sentences.length >= 4) {
        // Try sequences of 2 or more sentences that might repeat
        for (
          let seqLength = 2;
          seqLength <= Math.floor(sentences.length / 2);
          seqLength++
        ) {
          const firstSequence = sentences.slice(0, seqLength);
          const firstSequenceText = firstSequence.join(" ");

          // Check if this sequence appears again later
          for (
            let start = seqLength;
            start <= sentences.length - seqLength;
            start++
          ) {
            const laterSequence = sentences.slice(start, start + seqLength);
            const laterSequenceText = laterSequence.join(" ");
            if (firstSequenceText === laterSequenceText) {
              // Found a repeated sequence - likely hallucination
              return true;
            }
          }
        }
      }
    }

    // Check for repeated phrases (longer sequences that repeat)
    // Reuse words array from earlier check (or create if not already created)
    if (words.length >= 2) {
      // Check for simple word repetition (e.g., "bye bye" or "bye bye bye")
      const uniqueWords = new Set(words);
      if (uniqueWords.size === 1) {
        // Single word repeated - likely hallucination
        return true;
      }

      // Check for phrase repetition by looking for subsequences
      // If the text is long enough, check if a significant portion repeats
      if (words.length >= 6) {
        // Try to find if a phrase of 3+ words repeats
        for (
          let phraseLength = 3;
          phraseLength <= Math.floor(words.length / 2);
          phraseLength++
        ) {
          const firstPhrase = words.slice(0, phraseLength).join(" ");
          // Check if this phrase appears again later in the text
          const remainingText = words.slice(phraseLength).join(" ");
          if (remainingText.includes(firstPhrase)) {
            // Found a repeated phrase - likely hallucination
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Calculate RMS (Root Mean Square) of audio to check if it's actual speech
   * Filters out silence and very quiet background noise
   * Handles both mono and stereo audio
   *
   * @param audioData PCM audio buffer (16-bit samples)
   * @param channels Number of audio channels (1 for mono, 2 for stereo)
   * @returns RMS value (higher = louder)
   */
  private calculateAudioRMS(audioData: Buffer, channels: number = 2): number {
    if (audioData.length === 0) {
      return 0;
    }

    let sumSquares = 0;
    const bytesPerSample = 2; // 16-bit = 2 bytes
    const bytesPerFrame = bytesPerSample * channels; // For stereo: 4 bytes per frame (L+R)
    const sampleCount = audioData.length / bytesPerFrame;

    // For stereo, average left and right channels for each frame
    // For mono, just read each sample
    for (let i = 0; i < audioData.length - (bytesPerFrame - 1); i += bytesPerFrame) {
      if (channels === 2) {
        // Stereo: average left and right channels
        const left = audioData.readInt16LE(i);
        const right = audioData.readInt16LE(i + 2);
        const sample = Math.floor((left + right) / 2);
        sumSquares += sample * sample;
      } else {
        // Mono: just read the sample
        const sample = audioData.readInt16LE(i);
        sumSquares += sample * sample;
      }
    }

    // RMS = sqrt(mean of squares)
    const meanSquare = sumSquares / sampleCount;
    return Math.sqrt(meanSquare);
  }

  /**
   * Handle a complete audio chunk
   *
   * @param session Voice session
   * @param chunk Audio chunk
   * @param userId User who spoke
   */
  private async handleAudioChunk(
    session: VoiceSession,
    chunk: any,
    userId: string
  ): Promise<void> {
    try {
      // Check audio level before transcription to filter out silence/noise
      const audioRMS = this.calculateAudioRMS(chunk.data, chunk.channels);
      
      // Use a slightly lower threshold for chunks that are long enough (more likely to be real speech)
      // But be stricter for very short chunks (more likely to be noise)
      const effectiveMinRMS = chunk.duration >= 3000 
        ? AUDIO_CONSTANTS.MIN_AUDIO_RMS * 0.8  // 80% of threshold for longer chunks
        : AUDIO_CONSTANTS.MIN_AUDIO_RMS;        // Full threshold for short chunks
      
      if (audioRMS < effectiveMinRMS) {
        return; // Skip transcription for silence/noise
      }

      // Convert stereo to mono for better Whisper transcription
      let audioChunkForTranscription = chunk;
      if (chunk.channels === 2) {
        const monoData = this.audioProcessor.stereoToMono(chunk.data);
        audioChunkForTranscription = {
          ...chunk,
          data: monoData,
          channels: 1,
          duration: chunk.duration, // Duration stays the same
        };
      }

      // Transcribe the audio (using mono version if converted)
      let transcription = await this.transcriber.transcribe(audioChunkForTranscription);

      if (!transcription || transcription.trim().length === 0) {
        return; // Ignore empty transcriptions
      }

      // Filter out [BLANK_AUDIO] and similar patterns explicitly
      const blankCheckNormalized = transcription.trim().toLowerCase();
      if (
        blankCheckNormalized === "[blank_audio]" ||
        blankCheckNormalized === "blank_audio" ||
        blankCheckNormalized === "blank audio" ||
        blankCheckNormalized.startsWith("[blank") ||
        blankCheckNormalized === ""
      ) {
        return;
      }

      // Explicitly filter "Bye." and variations - very common Whisper hallucination on silence
      // Also strip "Bye." from the start of transcriptions if there's other content
      let cleanedTranscription = transcription.trim();
      const normalizedTranscription = cleanedTranscription.toLowerCase();
      
      // Strip "Bye." or "Goodbye." from the start of transcriptions (common hallucination prefix)
      // Handles cases like "Bye.\n to where..." or "Bye. to where..." or "Bye.  to where..."
      const byePrefixPattern = /^(bye|goodbye)[.\s\n]+/i;
      if (byePrefixPattern.test(cleanedTranscription)) {
        cleanedTranscription = cleanedTranscription.replace(byePrefixPattern, "").trim();
        
        // If nothing left after stripping, it was just "Bye." - filter it out
        if (!cleanedTranscription || cleanedTranscription.length === 0) {
          return;
        }
        
        // Use the cleaned version
        transcription = cleanedTranscription;
      }
      
      // Check if the entire transcription is just "bye" or "goodbye" (after any cleaning)
      const finalNormalized = transcription.trim().toLowerCase();
      const trimmedTranscription = finalNormalized.replace(/[.!?]+$/, ""); // Remove trailing punctuation
      if (
        trimmedTranscription === "bye" ||
        trimmedTranscription === "goodbye" ||
        finalNormalized === "bye." ||
        finalNormalized === "goodbye." ||
        (finalNormalized.startsWith("bye ") && finalNormalized.split(/\s+/).length <= 3) ||
        (finalNormalized.startsWith("goodbye ") && finalNormalized.split(/\s+/).length <= 3)
      ) {
        return;
      }

      // Filter out Whisper hallucinations
      if (this.isHallucination(transcription)) {
        return;
      }

      // Filter out very short transcriptions (likely noise)
      if (transcription.trim().length < 3) {
        return;
      }

      // Check for duplicate transcriptions (prevent same text from being added multiple times)
      const recentTranscriptions = session.transcriptions.slice(-5); // Check last 5 transcriptions
      const isDuplicate = recentTranscriptions.some(
        (entry) => entry.text.toLowerCase().trim() === transcription.toLowerCase().trim()
      );
      
      if (isDuplicate) {
        return;
      }

      // Add to transcription buffer
      session.transcriptionBuffer += ` ${transcription}`;
      session.lastActivity = new Date();

      // Store transcription entry
      const entry: TranscriptionEntry = {
        text: transcription,
        timestamp: new Date(),
        containsTriggerWord: false,
        userId,
      };

      session.transcriptions.push(entry);
      
      // Limit transcription history to prevent unbounded growth
      if (session.transcriptions.length > 50) {
        session.transcriptions = session.transcriptions.slice(-50);
      }
      
      // Check if this session just started - brief safety margin
      const sessionStartTime = session.sessionStartTime || this.sessionStartTimes.get(session.guildId);
      if (sessionStartTime && Date.now() - sessionStartTime < 100) {
        // Session just started, ignore this transcription
        return;
      }

      // Process the transcription immediately for chunked transcriptions
      // This provides real-time responsiveness instead of waiting for silence
      await this.processTranscriptionBuffer(session, transcription.trim());
    } catch (error) {
      this.logger.error("Transcription error:", error);
    }
  }

  /**
   * Start interval to check for complete utterances and trigger word
   *
   * @param session Voice session
   */
  private startTranscriptionInterval(session: VoiceSession): void {
    const interval = setInterval(async () => {
      // Check if silence detected (utterance complete)
      const isSilence = this.audioProcessor.isSilenceDetected(session.sessionId);
      const bufferStatus = this.audioProcessor.getBufferStatus(session.sessionId);
      
      if (isSilence && bufferStatus.totalBytes > 0) {
        await this.processCompleteUtterance(session);
      }
    }, TRANSCRIPTION_CONSTANTS.TRANSCRIPTION_CHECK_INTERVAL_MS);

    this.transcriptionTimers.set(session.guildId, interval);
  }

  /**
   * Stop transcription interval
   *
   * @param guildId Guild ID
   */
  private stopTranscriptionInterval(guildId: Snowflake): void {
    const interval = this.transcriptionTimers.get(guildId);
    if (interval) {
      clearInterval(interval);
      this.transcriptionTimers.delete(guildId);
    }
  }

  /**
   * Process a complete utterance (after silence detected)
   *
   * @param session Voice session
   */
  private async processCompleteUtterance(session: VoiceSession): Promise<void> {
    // Clear old transcriptions from buffer before processing new utterance
    // This prevents accumulation of old transcriptions
    session.transcriptionBuffer = "";

    // Flush the complete audio buffer and transcribe it as one piece
    const completeAudioChunk = this.audioProcessor.flushBuffer(session.sessionId);
    
    if (!completeAudioChunk) {
      // No audio buffered, check if we have any text in transcription buffer
      // But wait - we just cleared it above! Let's check transcriptions array instead
      if (session.transcriptions.length > 0) {
        const lastTranscription = session.transcriptions[session.transcriptions.length - 1];
        // Process the last transcription if it exists
        if (lastTranscription) {
          await this.processTranscriptionBuffer(session, lastTranscription.text);
        }
        return;
      }
      return; // Nothing to process
    }

    // Check audio level before transcription
    const audioRMS = this.calculateAudioRMS(completeAudioChunk.data, completeAudioChunk.channels);
    if (audioRMS < AUDIO_CONSTANTS.MIN_AUDIO_RMS) {
      return; // Skip transcription for silence/noise
    }

    // Convert stereo to mono for better Whisper transcription
    let audioChunkForTranscription = completeAudioChunk;
    if (completeAudioChunk.channels === 2) {
      const monoData = this.audioProcessor.stereoToMono(completeAudioChunk.data);
      audioChunkForTranscription = {
        ...completeAudioChunk,
        data: monoData,
        channels: 1,
        duration: completeAudioChunk.duration,
      };
    }

    // Transcribe the complete audio chunk
    try {
      let transcription = await this.transcriber.transcribe(audioChunkForTranscription);
      
      if (!transcription || transcription.trim().length === 0) {
        return; // Ignore empty transcriptions
      }

      // Filter out [BLANK_AUDIO] and similar patterns explicitly
      const blankCheckNormalized = transcription.trim().toLowerCase();
      if (
        blankCheckNormalized === "[blank_audio]" ||
        blankCheckNormalized === "blank_audio" ||
        blankCheckNormalized === "blank audio" ||
        blankCheckNormalized.startsWith("[blank") ||
        blankCheckNormalized === ""
      ) {
        return;
      }

      // Explicitly filter "Bye." and variations - very common Whisper hallucination on silence
      // Also strip "Bye." from the start of transcriptions if there's other content
      let cleanedTranscription = transcription.trim();
      const normalizedTranscription = cleanedTranscription.toLowerCase();
      
      // Strip "Bye." or "Goodbye." from the start of transcriptions (common hallucination prefix)
      // Handles cases like "Bye.\n to where..." or "Bye. to where..."
      const byePrefixPattern = /^(bye|goodbye)[.\s\n]+/i;
      if (byePrefixPattern.test(cleanedTranscription)) {
        cleanedTranscription = cleanedTranscription.replace(byePrefixPattern, "").trim();
        
        // If nothing left after stripping, it was just "Bye." - filter it out
        if (!cleanedTranscription || cleanedTranscription.length === 0) {
          return;
        }
        
        // Use the cleaned version
        transcription = cleanedTranscription;
      }
      
      // Check if the entire transcription is just "bye" or "goodbye" (after any cleaning)
      const finalNormalized = transcription.trim().toLowerCase();
      const trimmedTranscription = finalNormalized.replace(/[.!?]+$/, ""); // Remove trailing punctuation
      if (
        trimmedTranscription === "bye" ||
        trimmedTranscription === "goodbye" ||
        finalNormalized === "bye." ||
        finalNormalized === "goodbye." ||
        (finalNormalized.startsWith("bye ") && finalNormalized.split(/\s+/).length <= 3) ||
        (finalNormalized.startsWith("goodbye ") && finalNormalized.split(/\s+/).length <= 3)
      ) {
        return;
      }

      // Filter out Whisper hallucinations
      if (this.isHallucination(transcription)) {
        return;
      }

      // Filter out very short transcriptions (likely noise)
      if (transcription.trim().length < 3) {
        return;
      }

      // Get user ID - try to get from recent transcriptions, otherwise use first participant
      const userId = session.transcriptions.length > 0 
        ? session.transcriptions[session.transcriptions.length - 1]?.userId 
        : Array.from(session.participants)[0] || "unknown";

      // Store transcription entry for logging/history
      const entry: TranscriptionEntry = {
        text: transcription,
        timestamp: new Date(),
        containsTriggerWord: false,
        userId,
      };
      // Check if this session just started - brief safety margin
      const sessionStartTime = session.sessionStartTime || this.sessionStartTimes.get(session.guildId);
      if (sessionStartTime && Date.now() - sessionStartTime < 100) {
        // Session just started, ignore this transcription
        return;
      }

      session.transcriptions.push(entry);
      session.lastActivity = new Date();

      // Process the complete transcription
      await this.processTranscriptionBuffer(session, transcription.trim());
    } catch (error) {
      this.logger.error("Transcription error in complete utterance:", error);
    }
  }

  /**
   * Process transcription buffer (common logic for both chunked and complete utterances)
   *
   * @param session Voice session
   * @param utterance Complete transcribed utterance
   */
  private async processTranscriptionBuffer(
    session: VoiceSession,
    utterance: string
  ): Promise<void> {
    // Check if this session just started - brief safety margin
    const sessionStartTime = session.sessionStartTime || this.sessionStartTimes.get(session.guildId);
    if (sessionStartTime && Date.now() - sessionStartTime < 100) {
      // Session just started, ignore this transcription
      return;
    }

    // Clear buffer immediately to prevent reprocessing
    // Also clear old transcriptions that are older than 30 seconds to prevent accumulation
    const now = Date.now();
    const thirtySecondsAgo = now - 30000;
    session.transcriptions = session.transcriptions.filter(
      (entry) => entry.timestamp.getTime() > thirtySecondsAgo
    );

    session.transcriptionBuffer = "";

    // Check for control commands (only when relevant)
    const controlCommand = this.detectVoiceControlCommand(utterance, session);
    if (controlCommand) {
      await this.handleVoiceControlCommand(session.guildId, controlCommand);
      return;
    }

    // Check if already processing for this guild
    const isLocked = this.processingLocks.get(session.guildId);
    if (isLocked) {
      return;
    }

    // Get display name for logging
    let displayName = "Unknown";
    if (session.transcriptions.length > 0) {
      const lastEntry =
        session.transcriptions[session.transcriptions.length - 1];
      if (lastEntry?.userId && session.channel?.guild) {
        try {
          const member = await session.channel.guild.members.fetch(
            lastEntry.userId
          );
          displayName = member.displayName;
        } catch {
          // Fallback to userId if fetch fails
          displayName = lastEntry.userId;
        }
      }
    }

    this.logger.info(`[${displayName}]: "${utterance}"`);

    // Get current mode
    const currentMode =
      this.sessionModes.get(session.guildId) || VoiceMode.COMMAND;
    session.mode = currentMode;

    // Get the user who spoke
    const lastEntry = session.transcriptions[session.transcriptions.length - 1];
    const userId =
      lastEntry?.userId || Array.from(session.participants)[0] || "unknown";

    // Check for conversation end phrases (only in conversation mode)
    if (currentMode === VoiceMode.CONVERSATION) {
      const conversationEndPhrases = [
        "thanks",
        "thank you",
        "end conversation",
        "that's all",
        "we're done",
        "that's it",
        "all done",
      ];
      const normalizedUtterance = utterance.toLowerCase().trim();
      if (
        conversationEndPhrases.some((phrase) =>
          normalizedUtterance.includes(phrase)
        )
      ) {
        this.logger.info(
          `Conversation end detected, switching to command mode`
        );
        await this.switchToCommandMode(session.guildId);
        return;
      }
    }

    // Check for trigger word
    const triggerResult = this.triggerDetector.detect(utterance);

    // In conversation mode, check if this is the same user continuing the conversation
    let shouldProcess = false;
    let query = utterance;

    if (currentMode === VoiceMode.CONVERSATION) {
      const activeConversationUser = this.conversationUsers.get(
        session.guildId
      );

      if (triggerResult.detected) {
        // Trigger word detected - start or restart conversation
        query =
          this.triggerDetector.extractQuery(
            utterance,
            triggerResult.position || 0,
            triggerResult.triggerWord
          ) || utterance;
        shouldProcess = true;
        this.conversationUsers.set(session.guildId, userId);
        session.conversationUserId = userId;
      } else if (activeConversationUser === userId) {
        // Same user continuing conversation - no trigger word needed
        shouldProcess = true;
        query = utterance;
      } else if (activeConversationUser && activeConversationUser !== userId) {
        // Different user - end previous conversation and start new one
        session.conversationHistory = [];
        this.conversationUsers.set(session.guildId, userId);
        session.conversationUserId = userId;
        // Still need trigger word to start new conversation
        if (triggerResult.detected) {
          query =
            this.triggerDetector.extractQuery(
              utterance,
              triggerResult.position || 0,
              triggerResult.triggerWord
            ) || utterance;
          shouldProcess = true;
        }
      } else {
        // No active conversation user - need trigger word
        if (triggerResult.detected) {
          query =
            this.triggerDetector.extractQuery(
              utterance,
              triggerResult.position || 0,
              triggerResult.triggerWord
            ) || utterance;
          shouldProcess = true;
          this.conversationUsers.set(session.guildId, userId);
          session.conversationUserId = userId;
        }
      }
    } else {
      // Command mode - require trigger word
      if (triggerResult.detected) {
        query =
          this.triggerDetector.extractQuery(
            utterance,
            triggerResult.position || 0,
            triggerResult.triggerWord
          ) || utterance;
        shouldProcess = true;
      }
    }

    if (shouldProcess) {
      // Play thinking sound when processing
      await this.playThinkingSound(session.guildId);

      // Set processing lock
      this.processingLocks.set(session.guildId, true);

      try {
        // Generate and speak response
        await this.generateAndSpeakResponse(
          session,
          query || utterance,
          userId
        );
      } catch (error) {
        this.logger.error("Error during response generation:", error);
        throw error;
      } finally {
        // Release lock
        this.processingLocks.delete(session.guildId);
      }
    }
  }

  public async executeVoiceCommand(
    guildId: Snowflake,
    command: VoiceControlCommand
  ): Promise<boolean> {
    const session = this.connectionManager.getSession(guildId);

    if (!session && command !== VoiceControlCommand.LEAVE) {
      this.logger.warn(
        `Cannot run command ${command} in guild ${guildId}: no active session`
      );
      return false;
    }

    await this.handleVoiceControlCommand(guildId, command);
    return true;
  }

  private detectVoiceControlCommand(
    utterance: string,
    session: VoiceSession
  ): VoiceControlCommand | null {
    const normalizedUtterance = this.normalizeCommandText(utterance);

    if (!normalizedUtterance) {
      return null;
    }

    // Check if there's active playback or processing
    const hasActivePlayback =
      session.isSpeaking || this.playbackControllers.has(session.guildId);
    const isProcessing = this.processingLocks.get(session.guildId);

    // For playback control commands (pause/resume/stop), allow WITHOUT trigger word if bot is speaking
    if (hasActivePlayback || isProcessing) {
      if (this.matchesCommand(normalizedUtterance, VoiceControlCommand.STOP)) {
        this.logger.debug(
          "Stop command detected during playback (no trigger word required)"
        );
        return VoiceControlCommand.STOP;
      }

      if (this.matchesCommand(normalizedUtterance, VoiceControlCommand.PAUSE)) {
        this.logger.debug(
          "Pause command detected during playback (no trigger word required)"
        );
        return VoiceControlCommand.PAUSE;
      }

      if (this.matchesPlayCommand(normalizedUtterance)) {
        this.logger.debug(
          "Resume command detected during playback (no trigger word required)"
        );
        return VoiceControlCommand.PLAY;
      }
    }

    // For leave command and trigger-based control, require trigger word
    const triggerResult = this.triggerDetector.detect(utterance);

    if (!triggerResult.detected) {
      return null;
    }

    const normalizedQuery = this.normalizeCommandText(
      this.triggerDetector.extractQuery(
        utterance,
        triggerResult.position || 0,
        triggerResult.triggerWord
      )
    );

    const candidates = [normalizedQuery, normalizedUtterance].filter(
      (text): text is string => Boolean(text && text.length > 0)
    );

    for (const text of candidates) {
      if (this.matchesCommand(text, VoiceControlCommand.LEAVE)) {
        return VoiceControlCommand.LEAVE;
      }

      // Also check playback commands with trigger word (fallback for when not actively playing)
      if (this.matchesCommand(text, VoiceControlCommand.STOP)) {
        return VoiceControlCommand.STOP;
      }

      if (this.matchesCommand(text, VoiceControlCommand.PAUSE)) {
        return VoiceControlCommand.PAUSE;
      }

      if (this.matchesPlayCommand(text)) {
        return VoiceControlCommand.PLAY;
      }

      // Check for mode switch commands
      if (
        this.matchesCommand(text, VoiceControlCommand.SWITCH_TO_CONVERSATION)
      ) {
        return VoiceControlCommand.SWITCH_TO_CONVERSATION;
      }

      if (this.matchesCommand(text, VoiceControlCommand.SWITCH_TO_COMMAND)) {
        return VoiceControlCommand.SWITCH_TO_COMMAND;
      }
    }

    // Also check mode switches without trigger word (for easier switching)
    const currentMode =
      this.sessionModes.get(session.guildId) || VoiceMode.COMMAND;
    if (
      this.matchesCommand(
        normalizedUtterance,
        VoiceControlCommand.SWITCH_TO_CONVERSATION
      )
    ) {
      return VoiceControlCommand.SWITCH_TO_CONVERSATION;
    }
    if (
      this.matchesCommand(
        normalizedUtterance,
        VoiceControlCommand.SWITCH_TO_COMMAND
      )
    ) {
      return VoiceControlCommand.SWITCH_TO_COMMAND;
    }

    return null;
  }

  private normalizeCommandText(text?: string | null): string | undefined {
    if (!text) {
      return undefined;
    }

    const normalized = text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    return normalized.length > 0 ? normalized : undefined;
  }

  private matchesCommand(text: string, command: VoiceControlCommand): boolean {
    const keywords = this.controlKeywords[command] || [];
    return keywords.some((keyword) => text.includes(keyword));
  }

  /**
   * Special handling for PLAY command to avoid false positives with music queries.
   * Only matches "play" if it's:
   * 1. Just "play" by itself (or with common filler words)
   * 2. Followed by playback-related words (resume, continue, etc.)
   * 3. NOT followed by what looks like a song/artist name
   */
  private matchesPlayCommand(text: string): boolean {
    const keywords = this.controlKeywords[VoiceControlCommand.PLAY] || [];

    // Check for non-"play" keywords first (resume, continue, etc.)
    const otherKeywords = keywords.filter((k) => k !== "play");
    if (otherKeywords.some((keyword) => text.includes(keyword))) {
      return true;
    }

    // Check if text contains "play"
    if (!text.includes("play")) {
      return false;
    }

    // If "play" is in the text, check if it's followed by a song/artist name
    // Extract text after "play"
    const playIndex = text.indexOf("play");
    const afterPlay = text.substring(playIndex + 4).trim();

    // If nothing after "play" or just common filler, it's a control command
    if (!afterPlay || afterPlay.length === 0) {
      return true;
    }

    // Common filler words that might appear after "play"
    const fillerWords = [
      "the",
      "a",
      "an",
      "it",
      "that",
      "this",
      "music",
      "audio",
      "sound",
    ];
    const firstWord = afterPlay.split(/\s+/)[0]?.toLowerCase();

    // If it's a filler word, check if there's more substantial content
    if (firstWord && fillerWords.includes(firstWord)) {
      const rest = afterPlay.substring(firstWord.length).trim();
      // If there's substantial content after the filler, it's likely a music query
      if (rest.length > 3) {
        return false;
      }
      return true;
    }

    // If "play" is followed by something substantial (more than 2 chars),
    // it's likely a music query, not a control command
    if (afterPlay.length > 2) {
      return false;
    }

    return true;
  }

  private async handleVoiceControlCommand(
    guildId: Snowflake,
    command: VoiceControlCommand
  ): Promise<void> {
    this.logger.info(
      `Handling voice command '${command}' for guild ${guildId}`
    );

    switch (command) {
      case VoiceControlCommand.LEAVE: {
        await this.stopActivePlayback(guildId);
        this.mediaPlayer.stop(guildId);
        await this.leaveVoiceChannel(guildId);
        break;
      }
      case VoiceControlCommand.STOP: {
        // Stop both voice assistant and media player
        await this.stopActivePlayback(guildId);
        this.mediaPlayer.stop(guildId);
        break;
      }
      case VoiceControlCommand.PAUSE: {
        // Pause both voice assistant and media player
        const voicePaused = this.pauseActivePlayback(guildId);
        this.mediaPlayer.pause(guildId);
        
        if (!voicePaused) {
          // Media player pause is always attempted, so no warning needed
        }
        break;
      }
      case VoiceControlCommand.PLAY: {
        const session = this.connectionManager.getSession(guildId);
        const currentMode = this.sessionModes.get(guildId) || VoiceMode.COMMAND;

        // Try to resume both voice assistant and media player
        const voiceResumed = this.resumeActivePlayback(guildId);
        this.mediaPlayer.resume(guildId);

        if (!voiceResumed) {
          // If no voice playback to resume, check if we're in conversation mode
          if (currentMode === VoiceMode.CONVERSATION && session) {
            // In conversation mode, "continue" or "resume" without playback
            // can be treated as the user wanting to continue the conversation
            // This will be handled naturally by the next utterance processing
          }
        }
        break;
      }
      case VoiceControlCommand.SWITCH_TO_CONVERSATION: {
        await this.switchToConversationMode(guildId);
        break;
      }
      case VoiceControlCommand.SWITCH_TO_COMMAND: {
        await this.switchToCommandMode(guildId);
        break;
      }
      default:
        this.logger.warn(`Unknown voice control command: ${command}`);
    }
  }

  /**
   * Play a light "thinking" sound to acknowledge the trigger word
   * This lets the user know their request was received
   *
   * @param guildId Guild ID
   */
  private async playThinkingSound(guildId: Snowflake): Promise<void> {
    try {
      // Generate a pleasant two-tone chime
      const chimeBuffer = AudioToneGenerator.generateThinkingChime();
      await this.connectionManager.playAudio(guildId, chimeBuffer);
      this.logger.debug("Played thinking chime");
    } catch (error) {
      // Don't throw - thinking sound is nice-to-have, not critical
      this.logger.warn("Failed to play thinking sound:", error);
    }
  }

  /**
   * Play error tone and optionally send a message to the voice channel
   * Provides user feedback when something goes wrong
   *
   * @param session Voice session
   * @param errorType Type of error that occurred
   * @param message Optional message to send in chat
   */
  private async handleErrorFeedback(
    session: VoiceSession,
    errorType: VoiceAssistantErrorType,
    message?: string
  ): Promise<void> {
    try {
      // Play error tone in voice channel
      const errorTone = AudioToneGenerator.generateErrorTone();
      await this.connectionManager.playAudio(session.guildId, errorTone);
      this.logger.debug("Played error tone");
    } catch (error) {
      this.logger.warn("Failed to play error tone:", error);
    }

    // Send error message to text channel if provided
    if (message && session.channel) {
      try {
        // Get the text channel associated with the voice channel
        const guild = session.channel.guild;
        const textChannel = session.channel;

        // Try to send to the same channel or a default channel
        if (textChannel && "send" in textChannel) {
          await textChannel.send(`⚠️ ${message}`);
        }
      } catch (error) {
        this.logger.warn("Failed to send error message to channel:", error);
      }
    }
  }

  /**
   * Switch to conversation mode
   *
   * @param guildId Guild ID
   */
  private async switchToConversationMode(guildId: Snowflake): Promise<void> {
    const session = this.connectionManager.getSession(guildId);
    if (!session) {
      this.logger.warn(`Cannot switch mode: no session for guild ${guildId}`);
      return;
    }

    this.sessionModes.set(guildId, VoiceMode.CONVERSATION);
    session.mode = VoiceMode.CONVERSATION;
    this.logger.info(`Switched to conversation mode for guild ${guildId}`);

    // Acknowledge mode switch with TTS
    const acknowledgment = "Alright, switched to conversation mode";
    await this.speakText(guildId, acknowledgment);
  }

  /**
   * Switch to command mode
   *
   * @param guildId Guild ID
   */
  private async switchToCommandMode(guildId: Snowflake): Promise<void> {
    const session = this.connectionManager.getSession(guildId);
    if (!session) {
      this.logger.warn(`Cannot switch mode: no session for guild ${guildId}`);
      return;
    }

    this.sessionModes.set(guildId, VoiceMode.COMMAND);
    session.mode = VoiceMode.COMMAND;

    // Clear conversation history and user tracking
    session.conversationHistory = [];
    session.conversationUserId = undefined;
    this.conversationUsers.delete(guildId);

    this.logger.info(`Switched to command mode for guild ${guildId}`);

    // Acknowledge mode switch with TTS
    const acknowledgment = "Alright, switched to command mode";
    await this.speakText(guildId, acknowledgment);
  }

  /**
   * Speak text using TTS (for acknowledgments, etc.)
   *
   * @param guildId Guild ID
   * @param text Text to speak
   */
  private async speakText(guildId: Snowflake, text: string): Promise<void> {
    try {
      const { chunkCount, chunkPromises } =
        this.tts.createChunkSynthesisQueue(text);

      if (chunkCount === 0) {
        this.logger.warn("No TTS chunks generated for acknowledgment");
        return;
      }

      await this.streamAndPlayChunks(guildId, chunkPromises, chunkCount);
    } catch (error) {
      this.logger.error("Error speaking text:", error);
    }
  }

  /**
   * Set up interruption detection for a session
   *
   * @param session Voice session
   */
  private setupInterruptionDetection(session: VoiceSession): void {
    const { connection } = session;

    // Listen for when users start speaking
    connection.receiver.speaking.on("start", (userId) => {
      // Only handle interruptions if bot is currently speaking
      if (session.isSpeaking) {
        this.logger.info(
          `Interruption detected: user ${userId} started speaking while bot is speaking`
        );

        // Pause playback immediately
        this.pauseActivePlayback(session.guildId);

        // Abort current playback
        const controller = this.playbackControllers.get(session.guildId);
        if (controller) {
          controller.aborted = true;
        }

        // Stop current playback
        this.connectionManager.stopPlayback(session.guildId);

        // Clear transcription buffer for this user to avoid processing partial utterance
        // The new utterance will be captured in the next silence detection cycle
      }
    });
  }

  /**
   * Generate AI response and speak it in voice channel
   *
   * @param session Voice session
   * @param query User query
   * @param userId User ID who made the query
   */
  /**
   * Generate AI response and speak it
   *
   * @param session Voice session
   * @param query User query
   * @param userId User ID
   */
  private async generateAndSpeakResponse(
    session: VoiceSession,
    query: string,
    userId: string
  ): Promise<void> {
    try {
      this.logger.info(`Generating response for: "${query}"`);

      const currentMode =
        this.sessionModes.get(session.guildId) || VoiceMode.COMMAND;

      // Generate AI response with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `AI response timeout after ${AI_CONSTANTS.RESPONSE_TIMEOUT_MS}ms`
              )
            ),
          AI_CONSTANTS.RESPONSE_TIMEOUT_MS
        );
      });

      const responsePromise = this.aiManager.runWithGuildContext(
        session.guildId,
        async () => {
          if (currentMode === VoiceMode.CONVERSATION) {
            // In conversation mode, use generateText with history
            // Initialize history if not present
            if (!session.conversationHistory) {
              session.conversationHistory = [];
            }

            // Add user message to history
            session.conversationHistory.push({ role: "user", content: query });

            // Limit history to prevent token overflow
            if (
              session.conversationHistory.length >
              CONVERSATION_CONSTANTS.MAX_HISTORY_TURNS * 2
            ) {
              session.conversationHistory = session.conversationHistory.slice(
                -CONVERSATION_CONSTANTS.MAX_HISTORY_TURNS * 2
              );
            }

            return await this.aiManager.generateText(query, userId, "grok", {
              personaKey: AI_CONSTANTS.DEFAULT_PERSONA,
              history: session.conversationHistory.slice(0, -1), // Exclude current user message
              channelId: session.channelId,
              useDiscordFormatting: false,
              mode: "chat",
            });
          } else {
            // Command mode - use generateVoiceResponse
            return await this.aiManager.generateVoiceResponse(
              query,
              userId,
              "grok",
              session.guildId,
              {
                personaKey: AI_CONSTANTS.DEFAULT_PERSONA,
                channelId: session.channelId,
              }
            );
          }
        }
      );

      const response = await Promise.race([responsePromise, timeoutPromise]);

      const responseText = response.content;

      if (!responseText || responseText.trim().length === 0) {
        this.logger.warn("Empty AI response, skipping TTS");
        return;
      }

      // Add bot response to conversation history in conversation mode
      if (
        currentMode === VoiceMode.CONVERSATION &&
        session.conversationHistory
      ) {
        session.conversationHistory.push({
          role: "assistant",
          content: responseText,
        });
      }

      const { chunkCount, chunkPromises } =
        this.tts.createChunkSynthesisQueue(responseText);

      if (chunkCount === 0) {
        this.logger.warn("No TTS chunks generated, skipping playback");
        return;
      }

      this.logger.info("Starting audio playback...");
      await this.streamAndPlayChunks(
        session.guildId,
        chunkPromises,
        chunkCount
      );

      this.logger.info("Response playback complete");
    } catch (error) {
      this.logger.error("Error generating/speaking response:", error);

      // Determine error type
      const errorType =
        error instanceof Error && error.message.includes("timeout")
          ? VoiceAssistantErrorType.AI_FAILED
          : VoiceAssistantErrorType.UNKNOWN;

      // Provide error feedback
      await this.handleErrorFeedback(
        session,
        errorType,
        "I encountered an error processing your request. Please try again."
      );
    }
  }

  /**
   * Stream and play chunks as soon as their synthesis completes.
   *
   * @param guildId Guild ID
   * @param chunkPromises Promises that resolve to synthesized chunks
   * @param totalChunks Total number of chunks expected
   */
  private async streamAndPlayChunks(
    guildId: Snowflake,
    chunkPromises: Array<Promise<TTSChunk | null>>,
    totalChunks: number
  ): Promise<void> {
    const controller = this.resetPlaybackController(guildId);
    let completed = 0;
    let totalBytes = 0;

    try {
      for (const chunkPromise of chunkPromises) {
        if (controller.aborted) {
          this.logger.debug(`Playback aborted before chunk ${completed + 1}`);
          break;
        }

        const chunk = await chunkPromise;
        completed++;

        if (!chunk) {
          this.logger.warn(
            `Skipping chunk ${completed}/${totalChunks} due to synthesis failure`
          );
          continue;
        }

        await this.waitForPlaybackResume(controller);

        if (controller.aborted) {
          this.logger.debug(
            `Playback aborted while waiting for chunk ${chunk.sequence + 1}`
          );
          break;
        }

        this.logger.debug(
          `Playing chunk ${chunk.sequence + 1}/${totalChunks} (${
            chunk.audio.length
          } bytes): "${chunk.text}"`
        );

        try {
          await this.connectionManager.playAudio(guildId, chunk.audio);
          totalBytes += chunk.audio.length;
          this.logger.debug(
            `✓ Chunk ${
              chunk.sequence + 1
            } playback complete (total streamed: ${totalBytes} bytes)`
          );
        } catch (error) {
          this.logger.error(
            `✗ Error playing chunk ${chunk.sequence + 1}:`,
            error
          );
          throw error;
        }
      }
    } finally {
      if (this.playbackControllers.get(guildId) === controller) {
        this.playbackControllers.delete(guildId);
      }
    }
  }

  private resetPlaybackController(guildId: Snowflake): PlaybackControllerState {
    const existing = this.playbackControllers.get(guildId);

    if (existing) {
      existing.aborted = true;
      existing.paused = false;
      this.resolvePlaybackController(existing);
    }

    const controller: PlaybackControllerState = {
      paused: false,
      aborted: false,
      resumeResolvers: [],
    };

    this.playbackControllers.set(guildId, controller);
    return controller;
  }

  private resolvePlaybackController(controller: PlaybackControllerState): void {
    while (controller.resumeResolvers.length > 0) {
      const resolver = controller.resumeResolvers.shift();
      if (resolver) {
        resolver();
      }
    }
  }

  private async waitForPlaybackResume(
    controller: PlaybackControllerState
  ): Promise<void> {
    if (!controller.paused) {
      return;
    }

    await new Promise<void>((resolve) => {
      controller.resumeResolvers.push(resolve);
    });
  }

  private pauseActivePlayback(guildId: Snowflake): boolean {
    const controller = this.playbackControllers.get(guildId);

    if (controller) {
      if (controller.paused) {
        return true;
      }
      controller.paused = true;
    }

    return this.connectionManager.pausePlayback(guildId);
  }

  private resumeActivePlayback(guildId: Snowflake): boolean {
    const controller = this.playbackControllers.get(guildId);

    if (controller) {
      if (!controller.paused) {
        return true;
      }
      controller.paused = false;
      this.resolvePlaybackController(controller);
    }

    return this.connectionManager.resumePlayback(guildId);
  }

  private async stopActivePlayback(guildId: Snowflake): Promise<void> {
    const controller = this.playbackControllers.get(guildId);

    if (controller) {
      controller.aborted = true;
      controller.paused = false;
      this.resolvePlaybackController(controller);
    }

    this.connectionManager.stopPlayback(guildId);
  }

  /**
   * Check if voice assistant is enabled and configured
   */
  public isEnabled(): boolean {
    return (
      config.voiceAssistantEnabled &&
      this.tts.isConfigured() &&
      this.transcriber.isConfigured()
    );
  }

  /**
   * Get voice session for a guild
   *
   * @param guildId Guild ID
   * @returns Voice session or undefined
   */
  public getSession(guildId: Snowflake): VoiceSession | undefined {
    return this.connectionManager.getSession(guildId);
  }

  /**
   * Check if bot is in a voice channel in a guild
   *
   * @param guildId Guild ID
   * @returns True if in voice channel
   */
  public isInVoiceChannel(guildId: Snowflake): boolean {
    return this.connectionManager.isConnected(guildId);
  }

  /**
   * Get all active voice sessions
   */
  public getAllSessions(): VoiceSession[] {
    return this.connectionManager.getAllSessions();
  }

  /**
   * Clean up all voice connections
   */
  public cleanup(): void {
    for (const session of this.getAllSessions()) {
      this.stopTranscriptionInterval(session.guildId);
      this.audioProcessor.cleanup(session.sessionId);
    }

    this.connectionManager.cleanup();
  }
}
