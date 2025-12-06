import type { Snowflake } from "discord.js";
import type { Page } from "puppeteer";
import { PlaybackAction } from "../types/playback.js";
import type { PlaybackResult, ProviderCapabilities } from "../types/playback.js";
import { ProviderRegistry } from "../registry/ProviderRegistry.js";
import { SessionManager } from "../session/SessionManager.js";
import { BaseProvider } from "../providers/BaseProvider.js";

/**
 * Controller for provider-agnostic playback operations
 * Checks provider capabilities before executing actions
 * Provides graceful degradation for unsupported operations
 */
export class PlaybackController {
	private providerRegistry: ProviderRegistry;
	private sessionManager: SessionManager;

	constructor(
		providerRegistry: ProviderRegistry,
		sessionManager: SessionManager
	) {
		this.providerRegistry = providerRegistry;
		this.sessionManager = sessionManager;
	}

	/**
	 * Execute a playback action
	 */
	public async executeAction(
		guildId: Snowflake,
		action: PlaybackAction,
		params?: Record<string, unknown>
	): Promise<PlaybackResult> {
		const session = this.sessionManager.getSession(guildId);
		if (!session) {
			return {
				success: false,
				error: "No active stream session found",
			};
		}

		if (!session.page || session.page.isClosed()) {
			return {
				success: false,
				error: "Stream page is not available or closed",
			};
		}

		const providerName = session.provider || "default";
		const provider = this.providerRegistry.getProvider(providerName);
		if (!provider) {
			return {
				success: false,
				error: `Provider not found: ${providerName}`,
			};
		}

		const capabilities = (provider as any).getCapabilities?.() as
			| ProviderCapabilities
			| undefined;

		if (!capabilities) {
			return {
				success: false,
				error: "Provider does not support playback controls",
			};
		}

		// Check if action is supported
		if (!this.supportsAction(capabilities, action)) {
			return {
				success: false,
				error: `Provider ${providerName} does not support ${action}`,
				fallback: this.suggestFallback(action, capabilities),
			};
		}

		// Execute provider-specific action
		try {
			// Verify page is still valid before executing
			if (session.page.isClosed()) {
				return {
					success: false,
					error: "Stream page has been closed",
				};
			}

			const result = await this.executeProviderAction(
				provider,
				action,
				session.page,
				params
			);

			// Update playback state if provided
			if (result.state) {
				this.sessionManager.updatePlaybackState(guildId, result.state);
			}

			return result;
		} catch (error) {
			console.error(
				`[PlaybackController] Error executing ${action} on ${providerName}:`,
				error
			);
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to execute playback action",
			};
		}
	}

	/**
	 * Check if provider supports an action
	 */
	private supportsAction(
		capabilities: ProviderCapabilities,
		action: PlaybackAction
	): boolean {
		switch (action) {
			case PlaybackAction.PAUSE:
				return capabilities.pause;
			case PlaybackAction.RESUME:
				return capabilities.resume;
			case PlaybackAction.SEEK:
				return capabilities.seek;
			case PlaybackAction.SKIP_FORWARD:
			case PlaybackAction.SKIP_BACKWARD:
				return capabilities.skip;
			case PlaybackAction.RESTART:
				return capabilities.restart;
			case PlaybackAction.NEXT_EPISODE:
				return capabilities.nextEpisode;
			default:
				return false;
		}
	}

	/**
	 * Execute action on provider
	 */
	private async executeProviderAction(
		provider: BaseProvider,
		action: PlaybackAction,
		page: Page,
		params?: Record<string, unknown>
	): Promise<PlaybackResult> {
		// Call provider's execute methods
		switch (action) {
			case PlaybackAction.PAUSE:
				return await (provider as any).executePause(page);
			case PlaybackAction.RESUME:
				return await (provider as any).executeResume(page);
			case PlaybackAction.SEEK:
				const position = params?.position as number;
				if (typeof position !== "number") {
					return {
						success: false,
						error: "Seek position must be a number",
					};
				}
				return await (provider as any).executeSeek(page, position);
			case PlaybackAction.SKIP_FORWARD:
				const forwardSeconds = (params?.seconds as number) || 10;
				return await (provider as any).executeSkipForward(page, forwardSeconds);
			case PlaybackAction.SKIP_BACKWARD:
				const backwardSeconds = (params?.seconds as number) || 10;
				return await (provider as any).executeSkipBackward(
					page,
					backwardSeconds
				);
			case PlaybackAction.RESTART:
				return await (provider as any).executeRestart(page);
			case PlaybackAction.NEXT_EPISODE:
				return await (provider as any).executeNextEpisode(page);
			default:
				return {
					success: false,
					error: `Unknown action: ${action}`,
				};
		}
	}

	/**
	 * Suggest fallback action if operation not supported
	 */
	private suggestFallback(
		action: PlaybackAction,
		capabilities: ProviderCapabilities
	): string | undefined {
		switch (action) {
			case PlaybackAction.PAUSE:
				if (capabilities.restart) {
					return "Try stopping and restarting the stream later";
				}
				break;
			case PlaybackAction.NEXT_EPISODE:
				return "Next episode is only supported for TV shows on Jellyfin";
			default:
				return undefined;
		}
		return undefined;
	}
}

