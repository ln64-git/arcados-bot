import type { Client, VoiceChannel, Snowflake } from "discord.js";
import type { Page } from "puppeteer";
import { config } from "../../../config/index.js";
import { PuppeteerService } from "../services/PuppeteerService.js";
import { DiscordStreamService } from "../services/DiscordStreamService.js";
import { ContentDetectionService } from "../services/ContentDetectionService.js";
import type {
	StreamOptions,
	StreamResult,
	StreamSession,
	SearchResult,
} from "../types.js";
import { ProviderRegistry } from "../registry/ProviderRegistry.js";
import { ProviderRouter } from "../routing/ProviderRouter.js";
import { SessionManager } from "../session/SessionManager.js";
import { ContentSelector } from "../selection/ContentSelector.js";
import { PlaybackController } from "../playback/PlaybackController.js";
import { PlaybackAction } from "../types/playback.js";
import { BaseProvider } from "../providers/BaseProvider.js";

/**
 * Main orchestrator for stream player feature
 * Thin layer that delegates to specialized components
 * No business logic implementation - pure orchestration
 */
export class StreamController {
	private static instance: StreamController;

	private client: Client | null = null;
	private puppeteerService: PuppeteerService;
	private streamService: DiscordStreamService;
	private contentDetection: ContentDetectionService;
	private providerRegistry: ProviderRegistry;
	private providerRouter: ProviderRouter;
	private sessionManager: SessionManager;
	private playbackController: PlaybackController;

	private constructor() {
		this.puppeteerService = new PuppeteerService();
		this.streamService = new DiscordStreamService();
		this.contentDetection = new ContentDetectionService();
		this.providerRegistry = ProviderRegistry.getInstance();
		this.providerRouter = new ProviderRouter();
		this.sessionManager = new SessionManager();
		this.playbackController = new PlaybackController(
			this.providerRegistry,
			this.sessionManager
		);
	}

	public static getInstance(): StreamController {
		if (!StreamController.instance) {
			StreamController.instance = new StreamController();
		}
		return StreamController.instance;
	}

	/**
	 * Initialize the stream controller
	 */
	async initialize(client: Client): Promise<void> {
		this.client = client;

		if (!config.streamPlayerEnabled) {
			console.log("[StreamController] Stream player is disabled in config");
			return;
		}

		try {
			await this.puppeteerService.initialize();
			const browser = await this.puppeteerService.getBrowser();
			await this.streamService.initialize(browser);
			console.log("[StreamController] Initialized successfully");
		} catch (error) {
			console.error("[StreamController] Failed to initialize:", error);
			throw error;
		}
	}

	/**
	 * Stream content to a voice channel
	 * Flow: ProviderRouter → search → ContentSelector → PlaybackController
	 */
	async streamContent(options: StreamOptions): Promise<StreamResult> {
		// Check if feature is enabled
		if (!config.streamPlayerEnabled) {
			return {
				success: false,
				error: "Stream player is disabled",
				message: "Stream player feature is not enabled",
			};
		}

		// Check if already streaming or searching
		const existingSession = this.sessionManager.getSession(options.guildId);
		if (existingSession) {
			// If we're in searching state and it's the same query, return the existing results
			if (
				existingSession.state === "searching" &&
				existingSession.query === options.query
			) {
				const searchResults = this.sessionManager.getSearchResults(
					options.guildId
				);
				if (searchResults && searchResults.length > 0) {
					const optionsText = searchResults
						.map(
							(r, i) =>
								`${i + 1}. ${r.title}${r.year ? ` (${r.year})` : ""}${r.description ? ` - ${r.description}` : ""
								}`
						)
						.join("\n");

					return {
						success: true,
						message: `Found ${searchResults.length} results for "${options.query}". Please select one:\n\n${optionsText}\n\nReply with the number (1-${searchResults.length}) to select.`,
						searchResults,
						requiresSelection: true,
						session: existingSession,
					};
				}
			}

			// Otherwise, there's an active session
			return {
				success: false,
				error: "Stream already active",
				message: `A stream is already ${existingSession.state === "searching" ? "searching" : "playing"
					}: ${existingSession.query
					}. Please wait for it to complete or stop it first.`,
			};
		}

		// Get voice channel
		if (!this.client) {
			return {
				success: false,
				error: "Client not initialized",
				message: "Stream player not initialized",
			};
		}

		const guild = await this.client.guilds.fetch(options.guildId);
		if (!guild) {
			return {
				success: false,
				error: "Guild not found",
				message: "Could not find the server",
			};
		}

		const voiceChannel = (await guild.channels.fetch(
			options.voiceChannelId
		)) as VoiceChannel | null;

		if (!voiceChannel || !voiceChannel.isVoiceBased()) {
			return {
				success: false,
				error: "Invalid voice channel",
				message: "The specified channel is not a voice channel",
			};
		}

		// Determine provider using ProviderRouter
		const providerName =
			options.provider ||
			this.providerRouter.selectProvider(options.guildId, options.query);

		// Create session
		const session = this.sessionManager.createSession(
			options.guildId,
			options.voiceChannelId,
			options.query,
			providerName
		);

		console.log(`[StreamController] Created active session:`, {
			guildId: session.guildId,
			query: session.query,
			state: session.state,
			provider: providerName,
		});

		try {
			// Step 1: Search for content
			this.sessionManager.updateState(options.guildId, "searching");
			console.log(
				`[StreamController] Starting search for: "${options.query}" with provider: ${providerName}`
			);

			const provider = this.providerRegistry.getProvider(providerName);
			if (!provider) {
				throw new Error(`Provider not found: ${providerName}`);
			}

			const searchPage = await this.puppeteerService.createPage();
			const searchResults = await provider.searchContent(
				options.query,
				searchPage
			);

			console.log(
				`[StreamController] Search completed: ${searchResults?.length || 0
				} results found`
			);

			if (!searchResults || searchResults.length === 0) {
				await this.puppeteerService.closePage(searchPage);
				this.sessionManager.setError(
					options.guildId,
					"Content not found"
				);
				this.sessionManager.removeSession(options.guildId);
				return {
					success: false,
					error: "Content not found",
					message: `Could not find "${options.query}"`,
					session,
				};
			}

			// Cache search results for selection
			this.sessionManager.setSearchResults(options.guildId, searchResults);

			// Step 2: Content selection
			const selector = new ContentSelector(searchResults);

			// Check if we should auto-select (single result or high confidence match)
			if (searchResults.length === 1) {
				// Single result - use it directly
				const searchResult = searchResults[0];
				if (!searchResult) {
					throw new Error("Search result is undefined");
				}
				this.sessionManager.setSearchResult(options.guildId, searchResult);
				this.sessionManager.setPage(options.guildId, searchPage);

				// Continue with streaming
				return this.continueStreaming(session, searchResult, searchPage);
			}

			// Multiple results - check for auto-selection based on query
			// Try to match query against results for auto-selection
			const selectionResult = selector.select(options.query, searchResults);
			if (selectionResult && selector.shouldAutoSelect(selectionResult)) {
				// High confidence match - auto-select
				console.log(
					`[StreamController] Auto-selecting result with confidence ${selectionResult.confidence}`
				);
				const selected = selectionResult.selected;
				if (!selected) {
					throw new Error("Selected result is undefined");
				}
				this.sessionManager.setSearchResult(options.guildId, selected);
				this.sessionManager.setPage(options.guildId, searchPage);
				return this.continueStreaming(session, selected, searchPage);
			}

			// Multiple results, no auto-select - return for user selection
			// Keep the search page open so we can navigate to the selected result
			(session as any).searchPage = searchPage;

			// Format the list of options
			const optionsText = searchResults
				.map(
					(r, i) =>
						`${i + 1}. ${r.title}${r.year ? ` (${r.year})` : ""}${r.description ? ` - ${r.description}` : ""
						}`
				)
				.join("\n");

			return {
				success: true,
				message: `Found ${searchResults.length} results for "${options.query}". Please select one:\n\n${optionsText}\n\nReply with the number (1-${searchResults.length}) to select.`,
				searchResults,
				requiresSelection: true,
				session,
			};
		} catch (error) {
			this.sessionManager.setError(
				options.guildId,
				error instanceof Error ? error.message : String(error)
			);

			// Cleanup on error
			await this.cleanup(session);

			return {
				success: false,
				error: session.error,
				message: `Failed to start stream: ${session.error}`,
				session,
			};
		}
	}

	/**
	 * Select content from search results
	 * Supports both numeric and fuzzy matching
	 */
	async selectContent(
		guildId: Snowflake,
		selection: string
	): Promise<StreamResult> {
		const session = this.sessionManager.getSession(guildId);
		if (!session || session.guildId !== guildId) {
			return {
				success: false,
				error: "No active search session",
				message: "No active search session found. Please start a new search.",
			};
		}

		if (session.state !== "searching") {
			return {
				success: false,
				error: "Invalid session state",
				message:
					"Session is not in searching state. The search may have timed out. Please start a new search.",
			};
		}

		const searchResults = this.sessionManager.getSearchResults(guildId);
		if (!searchResults || searchResults.length === 0) {
			return {
				success: false,
				error: "No search results available",
				message: "Search results are no longer available. Please start a new search.",
			};
		}

		// Use ContentSelector for unified selection
		const selector = new ContentSelector(searchResults);
		const selectionResult = selector.select(selection, searchResults);

		if (!selectionResult) {
			return {
				success: false,
				error: "Invalid selection",
				message: `Could not match "${selection}" to any search result. Please try again with a number or more specific description.`,
			};
		}

		// Get the selected result
		const selectedResult = selectionResult.selected;
		this.sessionManager.setSearchResult(guildId, selectedResult);

		// Get the search page (should still be open)
		const searchPage = (session as any).searchPage as Page | undefined;
		let page: Page;
		if (!searchPage || searchPage.isClosed()) {
			// Page was closed, create a new one
			page = await this.puppeteerService.createPage();
		} else {
			// Use the existing search page
			page = searchPage;
		}

		this.sessionManager.setPage(guildId, page);

		// Continue with the streaming process
		return this.continueStreaming(session, selectedResult, page);
	}

	/**
	 * Continue streaming after search result is selected
	 *
	 * CORRECTED FLOW (all providers):
	 * Discord Go Live captures/freezes the page when streaming starts,
	 * so we MUST navigate to content BEFORE starting the stream.
	 *
	 * 1. Navigate to content and prepare playback
	 * 2. Start Discord Go Live on the prepared page
	 * 3. Monitor stream
	 */
	private async continueStreaming(
		session: StreamSession,
		searchResult: SearchResult,
		page: Page
	): Promise<StreamResult> {
		console.log("[StreamController] continueStreaming called");

		try {
			const providerName = session.provider || "default";
			const provider = this.providerRegistry.getProvider(providerName);
			if (!provider) {
				throw new Error(`Provider not found: ${providerName}`);
			}

			// Get voice channel
			if (!this.client) {
				throw new Error("Client not initialized");
			}

			const guild = await this.client.guilds.fetch(session.guildId);
			const voiceChannel = (await guild.channels.fetch(
				session.voiceChannelId
			)) as VoiceChannel | null;

			if (!voiceChannel || !voiceChannel.isVoiceBased()) {
				throw new Error("Invalid voice channel");
			}

			this.sessionManager.updateState(session.guildId, "loading");

			// STEP 1: Navigate to content and prepare playback
			console.log(`[StreamController] Navigating to: ${searchResult.url}`);
			await provider.navigateToContent(searchResult, page);

			console.log("[StreamController] Preparing video playback...");
			try {
				await provider.closePopups(page);
				await provider.waitForPlayer(page);
				await provider.clickPlay(page);
				await provider.enterFullscreen(page);
				console.log("[StreamController] Video is now playing in fullscreen!");
			} catch (error) {
				console.error(
					"[StreamController] Error preparing video playback (continuing anyway):",
					error
				);
				// Continue even if playback preparation fails
			}

			// STEP 2: Start Discord Go Live on the prepared page
			console.log("[StreamController] Starting Discord Go Live stream...");
			await this.streamService.startGoLiveStream(voiceChannel, page);
			console.log("[StreamController] Discord stream active!");

			// STEP 3: Monitor stream for end or errors
			this.sessionManager.updateState(session.guildId, "playing");
			this.monitorStream(session).catch((error) => {
				console.error("[StreamController] Error monitoring stream:", error);
			});

			return {
				success: true,
				message: `Streaming "${searchResult.title}"`,
				session,
			};
		} catch (error) {
			this.sessionManager.setError(
				session.guildId,
				error instanceof Error ? error.message : String(error)
			);

			// Cleanup on error
			await this.cleanup(session);

			return {
				success: false,
				error: session.error,
				message: `Failed to start stream: ${session.error}`,
				session,
			};
		}
	}

	/**
	 * Control playback (pause, resume, seek, skip, etc.)
	 */
	async controlPlayback(
		guildId: Snowflake,
		action: PlaybackAction,
		params?: Record<string, unknown>
	): Promise<import("../types/playback.js").PlaybackResult> {
		return await this.playbackController.executeAction(guildId, action, params);
	}

	/**
	 * Stop current stream
	 */
	async stopStream(guildId: Snowflake): Promise<void> {
		const session = this.sessionManager.getSession(guildId);
		if (!session) {
			return;
		}

		this.sessionManager.updateState(guildId, "stopped");
		await this.cleanup(session);
	}

	/**
	 * Get active session
	 */
	getActiveSession(guildId?: Snowflake): StreamSession | null {
		if (guildId) {
			return this.sessionManager.getSession(guildId);
		}
		// Return first session if no guildId specified (for backward compatibility)
		const sessions = this.sessionManager.getAllSessions();
		return sessions.length > 0 ? (sessions[0] ?? null) : null;
	}

	/**
	 * Check if streaming
	 */
	isStreaming(guildId?: Snowflake): boolean {
		const session = guildId
			? this.sessionManager.getSession(guildId)
			: this.getActiveSession();

		if (!session) {
			return false;
		}

		// Consider any state that's not terminal as "streaming"
		const terminalStates = ["stopped", "ended", "error"];
		return !terminalStates.includes(session.state);
	}

	/**
	 * Monitor stream and handle end/errors
	 */
	private async monitorStream(session: StreamSession): Promise<void> {
		if (!session || !session.page) {
			return;
		}

		try {
			// Inject end detection script
			await this.contentDetection.injectEndDetectionScript(session.page);

			// Wait for content to end
			await this.contentDetection.waitForContentEnd(session.page);

			// Content ended
			this.sessionManager.updateState(session.guildId, "ended");
			console.log(
				`[StreamController] Content ended for session: ${session.query}`
			);

			// Cleanup
			await this.cleanup(session);
		} catch (error) {
			console.error("[StreamController] Error in stream monitoring:", error);
			this.sessionManager.setError(
				session.guildId,
				error instanceof Error ? error.message : String(error)
			);
			await this.cleanup(session);
		}
	}

	/**
	 * Cleanup stream session
	 */
	private async cleanup(session: StreamSession): Promise<void> {
		try {
			// Stop Discord stream first
			try {
				await this.streamService.stopGoLiveStream(session.guildId);
			} catch (error) {
				console.error(
					"[StreamController] Error stopping Discord stream (non-fatal):",
					error
				);
			}

			// Close browser page
			if (session.page) {
				try {
					// Check if page is still valid before closing
					if (!session.page.isClosed()) {
						await this.puppeteerService.closePage(session.page);
					}
				} catch (error) {
					// Ignore errors if page is already closed or detached
					if (
						error instanceof Error &&
						(error.message.includes("detached") ||
							error.message.includes("Target closed") ||
							error.message.includes("Connection closed"))
					) {
						console.warn(
							"[StreamController] Page already closed/detached, skipping close"
						);
					} else {
						console.error(
							"[StreamController] Error closing page (non-fatal):",
							error
						);
					}
				}
			}

			// Sign out of Discord user account
			try {
				await this.streamService.signOut();
			} catch (error) {
				console.error(
					"[StreamController] Error signing out (non-fatal):",
					error
				);
			}

			// Remove session
			this.sessionManager.removeSession(session.guildId);
		} catch (error) {
			console.error("[StreamController] Error during cleanup:", error);
			// Still try to remove session even if cleanup failed
			try {
				this.sessionManager.removeSession(session.guildId);
			} catch (e) {
				// Ignore errors when removing session
			}
		}
	}

	/**
	 * Shutdown and cleanup
	 */
	async shutdown(): Promise<void> {
		// Stop all active streams
		const sessions = this.sessionManager.getAllSessions();
		for (const session of sessions) {
			await this.cleanup(session);
		}

		// Cleanup stream service
		await this.streamService.cleanup();

		// Shutdown browser
		await this.puppeteerService.shutdown();
	}
}

