import type { VoiceChannel, Snowflake, Client } from "discord.js";
import { VoiceConnectionManager } from "./services/VoiceConnectionManager.js";
import { AudioProcessor } from "./services/AudioProcessor.js";
import { WhisperTranscriber } from "./services/WhisperTranscriber.js";
import { GoogleTTSService } from "./services/GoogleTTSService.js";
import { TriggerWordDetector } from "./services/TriggerWordDetector.js";
import { AIManager } from "../../ai/core/AIManager.js";
import { config } from "../../config/index.js";
import { VoiceLogger } from "./utils/VoiceLogger.js";
import type { VoiceSession, TranscriptionEntry, TTSChunk } from "./types.js";
import { VoiceAssistantEvent, VoiceAssistantErrorType } from "./types.js";

export enum VoiceControlCommand {
	LEAVE = "leave",
	STOP = "stop",
	PAUSE = "pause",
	PLAY = "play",
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
 * 6. AI response → GoogleTTSService (TTS, chunked)
 * 7. TTS chunks → VoiceConnectionManager (playback)
 */
export class VoiceAssistantManager {
	private static instance: VoiceAssistantManager;

	private connectionManager: VoiceConnectionManager;
	private audioProcessor: AudioProcessor;
	private transcriber: WhisperTranscriber;
	private tts: GoogleTTSService;
	private triggerDetector: TriggerWordDetector;
	private aiManager: AIManager;
	private client?: Client;
	private logger: VoiceLogger;

	// Transcription interval timers
	private transcriptionTimers: Map<Snowflake, NodeJS.Timeout> = new Map();

	// Processing locks to prevent duplicate responses
	private processingLocks: Map<Snowflake, boolean> = new Map();

	// Playback controllers per guild for pause/stop coordination
	private playbackControllers: Map<Snowflake, PlaybackControllerState> = new Map();
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
	};

	private constructor() {
		this.connectionManager = VoiceConnectionManager.getInstance();
		this.audioProcessor = AudioProcessor.getInstance();
		this.transcriber = WhisperTranscriber.getInstance();
		this.tts = GoogleTTSService.getInstance();
		this.triggerDetector = TriggerWordDetector.getInstance();
		this.aiManager = AIManager.getInstance();
		this.logger = new VoiceLogger("VoiceAssistant");
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

		this.logger.info("Initialized");

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

		this.logger.info(
			`Trigger word: "${this.triggerDetector.getTriggerWord()}"`
		);
		this.logger.info(
			`TTS: ${this.tts.isConfigured() ? "Ready" : "Not configured"}`
		);
		this.logger.info(`STT: ${this.transcriber.getTranscriptionMethod()}`);
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

		this.logger.info(
			`Joining voice channel ${channel.name} (requested by ${requestedByUserId})`
		);

		// Join the voice channel
		const session = await this.connectionManager.joinChannel(channel);

		// Start receiving audio
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

		// Clean up audio processor
		const session = this.connectionManager.getSession(guildId);
		if (session) {
			this.audioProcessor.cleanup(session.sessionId);
		}

		// Leave the channel
		await this.connectionManager.leaveChannel(guildId);
	}

	/**
	 * Start receiving and processing audio from voice channel
	 *
	 * @param session Voice session
	 */
	private startReceivingAudio(session: VoiceSession): void {
		this.logger.debug(`Starting audio receiver for session ${session.sessionId}`);

		this.connectionManager.startReceiving(
			session.guildId,
			(userId, audioData) => {
				this.logger.debug(
					`Received audio from user ${userId}: ${audioData.length} bytes`
				);

				// Process received audio
				const chunk = this.audioProcessor.processAudio(
					session.sessionId,
					audioData
				);

				// If chunk is ready, transcribe it
				if (chunk) {
					this.logger.debug(
						`Audio chunk ready for transcription: ${chunk.duration}ms, ${chunk.data.length} bytes`
					);
					this.handleAudioChunk(session, chunk, userId);
				}
			}
		);
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
			// Transcribe the audio
			const transcription = await this.transcriber.transcribe(chunk);

			if (!transcription || transcription.trim().length === 0) {
				return; // Ignore empty transcriptions
			}

			this.logger.debug(`Transcription from ${userId}: "${transcription}"`);

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
			if (this.audioProcessor.isSilenceDetected(session.sessionId)) {
				await this.processCompleteUtterance(session);
			}
		}, 500); // Check every 500ms

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
		const utterance = session.transcriptionBuffer.trim();

		if (!utterance) {
			return;
		}

		// Clear buffer immediately to prevent reprocessing
		session.transcriptionBuffer = "";

		const controlCommand = this.detectVoiceControlCommand(utterance);
		if (controlCommand) {
			await this.handleVoiceControlCommand(session.guildId, controlCommand);
			return;
		}

		// Check if already processing for this guild
		if (this.processingLocks.get(session.guildId)) {
			this.logger.debug(
				`Already processing utterance for guild ${session.guildId}, skipping duplicate`
			);
			return;
		}

		this.logger.info(`Complete utterance: "${utterance}"`);

		// Check for trigger word
		const triggerResult = this.triggerDetector.detect(utterance);

		this.logger.debug(
			`Trigger word check: detected=${triggerResult.detected}, confidence=${triggerResult.confidence}, word="${triggerResult.triggerWord || "none"}"`
		);

		if (triggerResult.detected) {
			this.logger.info(
				`✓ Trigger word detected! Confidence: ${triggerResult.confidence}, processing response...`
			);

			// Set processing lock
			this.processingLocks.set(session.guildId, true);

			try {
				// Extract query (text after trigger word)
				const query = this.triggerDetector.extractQuery(
					utterance,
					triggerResult.position || 0
				);

				this.logger.debug(`Extracted query: "${query || utterance}"`);

				// Generate and speak response
				await this.generateAndSpeakResponse(session, query || utterance);
			} finally {
				// Release lock
				this.processingLocks.delete(session.guildId);
			}
		} else {
			this.logger.debug("✗ No trigger word detected, ignoring utterance");
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

	private detectVoiceControlCommand(utterance: string): VoiceControlCommand | null {
		const triggerResult = this.triggerDetector.detect(utterance);

		if (!triggerResult.detected) {
			return null;
		}

		const normalizedQuery = this.normalizeCommandText(
			this.triggerDetector.extractQuery(utterance, triggerResult.position || 0)
		);
		const normalizedUtterance = this.normalizeCommandText(utterance);

		const candidates = [normalizedQuery, normalizedUtterance].filter(
			(text): text is string => Boolean(text && text.length > 0)
		);

		for (const text of candidates) {
			if (this.matchesCommand(text, VoiceControlCommand.LEAVE)) {
				return VoiceControlCommand.LEAVE;
			}

			if (this.matchesCommand(text, VoiceControlCommand.STOP)) {
				return VoiceControlCommand.STOP;
			}

			if (this.matchesCommand(text, VoiceControlCommand.PAUSE)) {
				return VoiceControlCommand.PAUSE;
			}

			if (this.matchesCommand(text, VoiceControlCommand.PLAY)) {
				return VoiceControlCommand.PLAY;
			}
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

	private async handleVoiceControlCommand(
		guildId: Snowflake,
		command: VoiceControlCommand
	): Promise<void> {
		this.logger.info(`Handling voice command '${command}' for guild ${guildId}`);

		switch (command) {
			case VoiceControlCommand.LEAVE: {
				await this.stopActivePlayback(guildId);
				await this.leaveVoiceChannel(guildId);
				break;
			}
			case VoiceControlCommand.STOP: {
				await this.stopActivePlayback(guildId);
				break;
			}
			case VoiceControlCommand.PAUSE: {
				if (!this.pauseActivePlayback(guildId)) {
					this.logger.warn(
						`Pause requested for guild ${guildId} but no active playback`
					);
				}
				break;
			}
			case VoiceControlCommand.PLAY: {
				if (!this.resumeActivePlayback(guildId)) {
					this.logger.warn(
						`Resume requested for guild ${guildId} but no active playback`
					);
				}
				break;
			}
			default:
				this.logger.warn(`Unknown voice control command: ${command}`);
		}
	}

	/**
	 * Generate AI response and speak it in voice channel
	 *
	 * @param session Voice session
	 * @param query User query
	 */
	private async generateAndSpeakResponse(
		session: VoiceSession,
		query: string
	): Promise<void> {
		try {
			this.logger.info(`Generating response for: "${query}"`);

			// Get first participant (or use first user in channel)
			const userId = Array.from(session.participants)[0] || "unknown";

			// Generate AI response
			const response = await this.aiManager.runWithGuildContext(
				session.guildId,
				async () => {
					return await this.aiManager.generateVoiceResponse(
						query,
						userId,
						"grok",
						session.guildId,
						{
							personaKey: "casual",
							channelId: session.channelId,
						}
					);
				}
			);

			const responseText = response.content;

			this.logger.debug(
				`AI response (${responseText.length} chars): "${responseText}"`
			);

			if (!responseText || responseText.trim().length === 0) {
				this.logger.warn("Empty AI response, skipping TTS");
				return;
			}

			this.logger.debug("Starting TTS generation...");
			const { chunkCount, chunkPromises } = this.tts.createChunkSynthesisQueue(
				responseText
			);

			if (chunkCount === 0) {
				this.logger.warn("No TTS chunks generated, skipping playback");
				return;
			}

			this.logger.debug(
				`Scheduled ${chunkCount} chunk syntheses for playback`
			);

			this.logger.info("Starting audio playback...");
			await this.streamAndPlayChunks(
				session.guildId,
				chunkPromises,
				chunkCount
			);

			this.logger.info("Response playback complete");
		} catch (error) {
			this.logger.error("Error generating/speaking response:", error);

			// Try to speak error message
			try {
				const { chunkCount, chunkPromises } = this.tts.createChunkSynthesisQueue(
					"Sorry, I encountered an error processing your request."
				);
				await this.streamAndPlayChunks(
					session.guildId,
					chunkPromises,
					chunkCount
				);
			} catch {
				// Silently fail if error message can't be spoken
			}
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
					this.logger.debug(
						`Playback aborted before chunk ${completed + 1}`
					);
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
					`Playing chunk ${chunk.sequence + 1}/${totalChunks} (${chunk.audio.length} bytes): "${chunk.text}"`
				);

				try {
					await this.connectionManager.playAudio(guildId, chunk.audio);
					totalBytes += chunk.audio.length;
					this.logger.debug(
						`✓ Chunk ${chunk.sequence + 1} playback complete (total streamed: ${totalBytes} bytes)`
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

	private async waitForPlaybackResume(controller: PlaybackControllerState): Promise<void> {
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
