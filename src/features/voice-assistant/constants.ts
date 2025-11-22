/**
 * Voice Assistant Configuration Constants
 * Centralized configuration for all voice assistant parameters
 */

/**
 * Audio Processing Constants
 */
export const AUDIO_CONSTANTS = {
	// Sample rates
	SAMPLE_RATE: 48000, // Discord voice uses 48kHz
	CHANNELS: 2, // Stereo

	// Chunk configuration
	CHUNK_DURATION_MS: 2000, // 2 second chunks for transcription
	SILENCE_DURATION_MS: 1000, // 1 second of silence = end of utterance

	// Buffer limits (prevent memory leaks)
	MAX_BUFFER_DURATION_MS: 30000, // 30 seconds max buffer
	MAX_BUFFER_SIZE_BYTES: 5_760_000, // ~30s at 48kHz stereo 16-bit (5.76MB)
} as const;

/**
 * Transcription Constants
 */
export const TRANSCRIPTION_CONSTANTS = {
	// Whisper configuration
	WHISPER_TEMPERATURE: 0.0,
	WHISPER_TEMPERATURE_INCREMENT: 0.2,

	// Polling interval for silence detection
	TRANSCRIPTION_CHECK_INTERVAL_MS: 500, // Check every 500ms
} as const;

/**
 * TTS (Text-to-Speech) Constants
 */
export const TTS_CONSTANTS = {
	// Cache configuration
	CACHE_SIZE: 50, // Store last 50 synthesized phrases

	// Rate limiting
	MAX_CONCURRENT_REQUESTS: 3, // Max 3 concurrent TTS requests

	// Audio configuration
	SAMPLE_RATE: 48000, // Discord voice supports 48kHz
	ENCODING: "LINEAR16" as const,

	// Gemini TTS configuration
	GEMINI_MODEL: "gemini-2.5-pro-tts",
	GEMINI_PITCH: 0,
	GEMINI_SPEAKING_RATE: 1,
	GEMINI_PROMPT: "Read aloud in a warm, welcoming tone.",
} as const;

/**
 * Trigger Word Detection Constants
 */
export const TRIGGER_CONSTANTS = {
	// Fuzzy matching
	SIMILARITY_THRESHOLD: 0.7, // 70% similarity required

	// Cache limits
	SIMILARITY_CACHE_SIZE: 1000, // Max cached similarity calculations
	SIMILARITY_CACHE_EVICTION_RATIO: 0.5, // Clear 50% when limit reached
} as const;

/**
 * AI Response Constants
 */
export const AI_CONSTANTS = {
	// Timeouts
	RESPONSE_TIMEOUT_MS: 45000, // 45 second timeout for AI response generation

	// Personas
	DEFAULT_PERSONA: "casual" as const,
} as const;

/**
 * Playback Constants
 */
export const PLAYBACK_CONSTANTS = {
	// Timeouts
	PLAYBACK_TIMEOUT_MS: 60000, // 60 second playback timeout

	// Polling intervals
	PLAYBACK_STATE_POLL_INTERVAL_MS: 100, // Check playback state every 100ms
} as const;

/**
 * Voice Connection Constants
 */
export const CONNECTION_CONSTANTS = {
	// Connection timeouts
	CONNECTION_READY_TIMEOUT_MS: 30000, // 30 seconds to establish connection
	RECONNECT_TIMEOUT_MS: 5000, // 5 seconds to attempt reconnection
} as const;

/**
 * Tone Generation Constants
 */
export const TONE_CONSTANTS = {
	// Thinking chime
	THINKING_CHIME_FREQUENCY_START: 880, // A5 (Hz)
	THINKING_CHIME_FREQUENCY_END: 660, // E5 (Hz)
	THINKING_CHIME_DURATION_MS: 300,

	// Acknowledgment beep
	ACK_BEEP_FREQUENCY: 880, // A5 (Hz)
	ACK_BEEP_DURATION_MS: 100,

	// Audio settings
	TONE_SAMPLE_RATE: 48000, // Match Discord voice
} as const;
