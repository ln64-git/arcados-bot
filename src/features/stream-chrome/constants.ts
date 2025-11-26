/**
 * Constants for stream player feature
 */

export const STREAM_CONSTANTS = {
	// Browser configuration
	VIEWPORT_WIDTH: 1920,
	VIEWPORT_HEIGHT: 1080,
	
	// Timeouts (in milliseconds)
	PAGE_LOAD_TIMEOUT: 30000, // 30 seconds
	PLAYER_DETECTION_TIMEOUT: 15000, // 15 seconds
	SEARCH_TIMEOUT: 20000, // 20 seconds
	NAVIGATION_TIMEOUT: 30000, // 30 seconds
	
	// Retry configuration
	MAX_RETRIES: 3,
	RETRY_DELAY: 2000, // 2 seconds
	
	// Content detection
	VIDEO_CHECK_INTERVAL: 1000, // Check every second
	VIDEO_STALL_THRESHOLD: 10000, // 10 seconds of no progress = stalled
	
	// Stream limits
	MAX_STREAM_DURATION: 43200000, // 12 hours (default, can be overridden by config)
	
	// Provider-specific
	MOVIES_BASE_URL: "https://ww7.123moviesfree.net",
	MOVIES_SEARCH_PATH: "/search",
	
	// User agent to avoid bot detection
	DEFAULT_USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const;

/**
 * CSS selectors for common elements
 */
export const SELECTORS = {
	// Generic video player
	VIDEO_ELEMENT: "video",
	PLAY_BUTTON: "button[aria-label*='play' i], .play-button, [class*='play'][class*='button']",
	FULLSCREEN_BUTTON: "button[aria-label*='fullscreen' i], .fullscreen-button",
	
	// Popup/Ad close buttons
	POPUP_CLOSE: ".close, .modal-close, [class*='close'], [class*='popup-close']",
	AD_CLOSE: "[class*='ad'][class*='close'], .advertisement-close",
	
	// 123movies specific (to be refined during implementation)
	MOVIES_SEARCH_INPUT: "input[type='search'], input[name='search'], #search",
	MOVIES_SEARCH_RESULTS: ".search-results, .movie-list, .result-item",
	MOVIES_PLAYER_CONTAINER: ".player-container, .video-player, #player",
} as const;
