/**
 * Voice Logger
 *
 * Centralized logging utility for voice-state feature.
 * Provides consistent log formatting across all services.
 *
 * Usage:
 * - VoiceLogger.session("User joined channel", { userId, channelId })
 * - VoiceLogger.block("Applied block permissions", { blockerId, blockedId })
 * - VoiceLogger.error("SESSION", "Failed to start session", error)
 */

export class VoiceLogger {
	/**
	 * Log session-related events
	 */
	static session(message: string, data?: any): void {
		console.log(`✅ [SESSION] ${message}`, data || "");
	}

	/**
	 * Log block enforcement events
	 */
	static block(message: string, data?: any): void {
		console.log(`🔹 [BLOCK] ${message}`, data || "");
	}

	/**
	 * Log moderation events
	 */
	static moderation(message: string, data?: any): void {
		console.log(`✅ [MODERATION] ${message}`, data || "");
	}

	/**
	 * Log ownership events
	 */
	static ownership(message: string, data?: any): void {
		console.log(`🔄 [OWNERSHIP] ${message}`, data || "");
	}

	/**
	 * Log spawn channel events
	 */
	static spawn(message: string, data?: any): void {
		console.log(`✅ [SPAWN] ${message}`, data || "");
	}

	/**
	 * Log errors with context
	 */
	static error(context: string, message: string, error?: any): void {
		console.error(`🔸 [${context}] ${message}`, error || "");
	}

	/**
	 * Log warnings
	 */
	static warn(context: string, message: string, data?: any): void {
		console.warn(`⚠️  [${context}] ${message}`, data || "");
	}

	/**
	 * Log info messages
	 */
	static info(context: string, message: string, data?: any): void {
		console.log(`ℹ️  [${context}] ${message}`, data || "");
	}
}

