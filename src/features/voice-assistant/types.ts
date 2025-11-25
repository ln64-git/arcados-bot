import type { VoiceConnection } from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";

/**
 * Represents an active voice session with a user or group of users
 */
export interface VoiceSession {
	/** Unique session ID */
	sessionId: string;

	/** Discord guild ID */
	guildId: string;

	/** Voice channel ID where the bot is connected */
	channelId: string;

	/** Voice channel object */
	channel: VoiceChannel;

	/** Discord.js voice connection */
	connection: VoiceConnection;

	/** User IDs currently in the voice channel */
	participants: Set<string>;

	/** Accumulated transcription buffer (until silence detected) */
	transcriptionBuffer: string;

	/** Last activity timestamp */
	lastActivity: Date;

	/** Whether the session is actively listening */
	isListening: boolean;

	/** Whether the bot is currently speaking */
	isSpeaking: boolean;

	/** Conversation ID in the database (once created) */
	conversationId?: string;

	/** All transcribed utterances in this session */
	transcriptions: TranscriptionEntry[];

	/** Current voice mode (command or conversation) */
	mode: VoiceMode;

	/** Active conversation user ID (per-user conversations) */
	conversationUserId?: string;

	/** Conversation history for maintaining context */
	conversationHistory?: Array<{ role: string; content: string }>;

	/** Timestamp when this session started (used to ignore old audio) */
	sessionStartTime?: number;
}

/**
 * Individual transcription entry with metadata
 */
export interface TranscriptionEntry {
	/** Transcribed text */
	text: string;

	/** Timestamp of transcription */
	timestamp: Date;

	/** Whether "Aria" was detected in this transcription */
	containsTriggerWord: boolean;

	/** User ID who spoke (if identifiable) */
	userId?: string;
}

/**
 * Audio chunk for processing
 */
export interface AudioChunk {
	/** PCM audio data */
	data: Buffer;

	/** Timestamp when chunk was received */
	timestamp: Date;

	/** Duration in milliseconds */
	duration: number;

	/** Sample rate (e.g., 48000) */
	sampleRate: number;

	/** Number of channels (1 = mono, 2 = stereo) */
	channels: number;

	/** Indicates this chunk came from a forced buffer flush */
	forced?: boolean;

	/** Reason the flush occurred (duration, size, etc.) */
	flushReason?: string;
}

/**
 * TTS response chunk for streaming playback
 */
export interface TTSChunk {
	/** Audio data ready for playback */
	audio: Buffer;

	/** Text that was synthesized */
	text: string;

	/** Sequence number for ordering */
	sequence: number;

	/** Whether this is the last chunk */
	isFinal: boolean;
}

/**
 * Trigger word detection result
 */
export interface TriggerWordResult {
	/** Whether the trigger word was detected */
	detected: boolean;

	/** Confidence score (0-1) */
	confidence: number;

	/** Normalized trigger word that was found */
	triggerWord?: string;

	/** Position in text where trigger word was found */
	position?: number;
}

/**
 * Voice assistant response
 */
export interface VoiceResponse {
	/** The text response from AI */
	text: string;

	/** TTS audio chunks for streaming */
	chunks: TTSChunk[];

	/** Total audio duration in milliseconds */
	duration: number;
}

/**
 * Voice assistant operational mode
 */
export enum VoiceMode {
	COMMAND = "command",
	CONVERSATION = "conversation",
}

/**
 * Voice connection state
 */
export enum VoiceConnectionState {
	DISCONNECTED = "disconnected",
	CONNECTING = "connecting",
	CONNECTED = "connected",
	READY = "ready",
	SPEAKING = "speaking",
	LISTENING = "listening",
	ERROR = "error",
}

/**
 * Voice assistant event types
 */
export enum VoiceAssistantEvent {
	SESSION_STARTED = "session_started",
	SESSION_ENDED = "session_ended",
	USER_JOINED = "user_joined",
	USER_LEFT = "user_left",
	TRANSCRIPTION_RECEIVED = "transcription_received",
	TRIGGER_WORD_DETECTED = "trigger_word_detected",
	AI_RESPONSE_STARTED = "ai_response_started",
	AI_RESPONSE_COMPLETED = "ai_response_completed",
	ERROR = "error",
}

/**
 * Voice assistant error types
 */
export enum VoiceAssistantErrorType {
	CONNECTION_FAILED = "connection_failed",
	TRANSCRIPTION_FAILED = "transcription_failed",
	TTS_FAILED = "tts_failed",
	AI_FAILED = "ai_failed",
	AUDIO_PROCESSING_FAILED = "audio_processing_failed",
	UNKNOWN = "unknown",
}

/**
 * Voice assistant error
 */
export interface VoiceAssistantError {
	type: VoiceAssistantErrorType;
	message: string;
	originalError?: Error;
	sessionId?: string;
}
