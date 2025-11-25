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
  CHUNK_DURATION_MS: 2000, // 2 second chunks for transcription (allows more context for natural speech)
  SILENCE_DURATION_MS: 1200, // 1.2 seconds of silence = end of utterance (more forgiving for natural pauses)

  // Buffer limits (prevent memory leaks)
  MAX_BUFFER_DURATION_MS: 30000, // 30 seconds max buffer
  MAX_BUFFER_SIZE_BYTES: 5_760_000, // ~30s at 48kHz stereo 16-bit (5.76MB)

  // Audio level thresholds (filter silence/noise before transcription)
  MIN_AUDIO_RMS: 200, // Minimum RMS (Root Mean Square) to consider audio as speech
  // RMS of 200 corresponds to roughly -46dB, balanced for clear speech while filtering background noise
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

  // Prevent duplicate utterances within a short time window
  DUPLICATE_TEXT_WINDOW_MS: 4000, // Ignore exact duplicates within 4 seconds
} as const;

/**
 * TTS (Text-to-Speech) Constants
 */
export const TTS_CONSTANTS = {
  // Cache configuration
  CACHE_SIZE: 50, // Store last 50 synthesized phrases

  // Rate limiting
  MAX_CONCURRENT_REQUESTS: 6, // Max 6 concurrent TTS requests (increased from 3 for faster playback)

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
 * Cartesia TTS Constants
 */
export const CARTESIA_CONSTANTS = {
  // Model configuration
  MODEL: "sonic-3" as const, // Latest Sonic model with 50+ emotions
  DEFAULT_VOICE_ID: "f786b574-daa5-4673-aa0c-cbe3e8534c02", // Katie (American English)

  // Audio output format (use 44100, closest to Discord's 48000 requirement)
  OUTPUT_FORMAT: {
    container: "raw" as const,
    encoding: "pcm_s16le" as const, // 16-bit PCM little-endian
    sampleRate: 44100, // Cartesia max supported, will resample to 48000
  },

  // Generation config
  VOLUME: 1.0,
  SPEED: 1.0,
  EMOTION: "neutral" as const,
  LANGUAGE: "en" as const,

  // API version
  API_VERSION: "2025-04-16" as const,

  // WebSocket configuration
  WS_IDLE_TIMEOUT_MS: 300000, // 5 minutes (Cartesia auto-closes at 5min)
  WS_RECONNECT_DELAY_MS: 1000, // 1 second
} as const;

/**
 * Trigger Word Detection Constants
 */
export const TRIGGER_CONSTANTS = {
  // Fuzzy matching
  SIMILARITY_THRESHOLD: 0.75, // 75% similarity required (balanced between accuracy and false positives)

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

  // Error tone
  ERROR_TONE_FREQUENCY: 440, // A4 (Hz) - lower pitch for errors
  ERROR_TONE_DURATION_MS: 200,

  // Audio settings
  TONE_SAMPLE_RATE: 48000, // Match Discord voice
} as const;

/**
 * Conversation Mode Constants
 */
export const CONVERSATION_CONSTANTS = {
  // History management
  MAX_HISTORY_TURNS: 10, // Maximum conversation turns to keep in history (20 messages total)

  // Response timing
  CONVERSATION_RESPONSE_DELAY_MS: 200, // Brief pause between responses in conversation mode

  // Interruption handling
  INTERRUPTION_DEBOUNCE_MS: 500, // Debounce time for interruption detection
} as const;
