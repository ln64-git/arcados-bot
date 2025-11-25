import type { Client, VoiceChannel, Snowflake } from "discord.js";
import { config } from "../../config/index.js";
import { PuppeteerService } from "./services/PuppeteerService.js";
import { DiscordStreamService } from "./services/DiscordStreamService.js";
import { ContentDetectionService } from "./services/ContentDetectionService.js";
import { MoviesProvider } from "./providers/MoviesProvider.js";
import { YouTubeProvider } from "./providers/YouTubeProvider.js";
import { JellyfinProvider } from "./providers/JellyfinProvider.js";
import { BaseProvider } from "./providers/BaseProvider.js";
import type {
  StreamSession,
  StreamResult,
  StreamOptions,
  SearchResult,
  StreamState,
} from "./types.js";
import { STREAM_CONSTANTS } from "./constants.js";
import { Page } from "puppeteer";

/**
 * Main orchestrator for stream player feature
 * Manages browser automation, content search, and Discord streaming
 */
export class StreamPlayerManager {
  private static instance: StreamPlayerManager;

  private client: Client | null = null;
  private puppeteerService: PuppeteerService;
  private streamService: DiscordStreamService;
  private contentDetection: ContentDetectionService;
  private activeSession: StreamSession | null = null;
  private providers: Map<string, BaseProvider> = new Map();

  private constructor() {
    this.puppeteerService = new PuppeteerService();
    this.streamService = new DiscordStreamService();
    this.contentDetection = new ContentDetectionService();

    // Register providers
    const moviesProvider = new MoviesProvider();
    this.providers.set("123movies", moviesProvider);
    this.providers.set("default", moviesProvider);

    const youtubeProvider = new YouTubeProvider();
    this.providers.set("youtube", youtubeProvider);

    const jellyfinProvider = new JellyfinProvider();
    this.providers.set("jellyfin", jellyfinProvider);
  }

  public static getInstance(): StreamPlayerManager {
    if (!StreamPlayerManager.instance) {
      StreamPlayerManager.instance = new StreamPlayerManager();
    }
    return StreamPlayerManager.instance;
  }

  /**
   * Initialize the stream player
   */
  async initialize(client: Client): Promise<void> {
    this.client = client;

    if (!config.streamPlayerEnabled) {
      console.log("[StreamPlayerManager] Stream player is disabled in config");
      return;
    }

    try {
      await this.puppeteerService.initialize();
      const browser = await this.puppeteerService.getBrowser();
      await this.streamService.initialize(browser);
      console.log("[StreamPlayerManager] Initialized successfully");

      // Test Discord streaming on initialization
      if (config.streamPlayerTestOnInit) {
        console.log(
          "\n🧪 [StreamPlayerManager] Running Discord streaming test..."
        );
        // this.testDiscordStreamingWorkflow().catch((error) => {
        //   console.error(
        //     "❌ [StreamPlayerManager] Discord streaming test failed:",
        //     error
        //   );
        // });
      }
    } catch (error) {
      console.error("[StreamPlayerManager] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Test Discord streaming workflow on initialization
   */
  private async testDiscordStreamingWorkflow(): Promise<void> {
    const GUILD_ID = "1254694808228986912"; // Arcados server
    const CHANNEL_ID = "1427152903260344350"; // 🌿 - Cantina

    console.log("📡 [Test] Starting Discord streaming workflow test...");
    console.log(`   Guild: ${GUILD_ID}`);
    console.log(`   Channel: ${CHANNEL_ID}`);

    try {
      // Create a test page with about:blank (simple test, no YouTube logic)
      const testPage = await this.puppeteerService.createPage();
      await testPage.goto("about:blank", {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      console.log("✓ [Test] Test page (about:blank) loaded");

      // Start the Go Live stream
      if (!this.client) {
        throw new Error("Client not initialized");
      }

      const guild = await this.client.guilds.fetch(GUILD_ID);
      const voiceChannel = (await guild.channels.fetch(CHANNEL_ID)) as any;

      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        throw new Error("Voice channel not found or invalid");
      }

      console.log("✓ [Test] Voice channel found:", voiceChannel.name);
      console.log("📺 [Test] Starting Go Live stream with about:blank tab...");

      await this.streamService.startGoLiveStream(voiceChannel, testPage);

      console.log("✅ [Test] Discord streaming test PASSED!");
      console.log(
        "   The bot should now be streaming the about:blank tab in the voice channel."
      );
      console.log("   Check Discord to verify the stream is working.");
    } catch (error) {
      console.error("❌ [Test] Discord streaming test FAILED:");
      console.error(error);

      // Take a screenshot for debugging
      try {
        const discordPage = (this.streamService as any).accountService
          ?.discordPage;
        if (discordPage && !discordPage.isClosed()) {
          const screenshotPath = `/tmp/discord-stream-test-init-${Date.now()}.png`;
          await discordPage.screenshot({
            path: screenshotPath,
            fullPage: true,
          });
          console.log(`📸 [Test] Screenshot saved: ${screenshotPath}`);
        }
      } catch (screenshotError) {
        console.error("[Test] Failed to take screenshot:", screenshotError);
      }

      throw error;
    }
  }

  /**
   * Stream content to a voice channel
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
    if (this.activeSession) {
      // If we're in searching state and it's the same query, return the existing results
      if (
        this.activeSession.state === "searching" &&
        this.activeSession.query === options.query &&
        this.activeSession.guildId === options.guildId
      ) {
        const searchResults = (this.activeSession as any)
          .pendingSearchResults as SearchResult[] | undefined;
        if (searchResults && searchResults.length > 0) {
          const optionsText = searchResults
            .map(
              (r, i) =>
                `${i + 1}. ${r.title}${r.year ? ` (${r.year})` : ""}${
                  r.description ? ` - ${r.description}` : ""
                }`
            )
            .join("\n");

          return {
            success: true,
            message: `Found ${searchResults.length} results for "${options.query}". Please select one:\n\n${optionsText}\n\nReply with the number (1-${searchResults.length}) to select.`,
            searchResults,
            requiresSelection: true,
            session: this.activeSession,
          };
        }
      }

      // Otherwise, there's an active session
      return {
        success: false,
        error: "Stream already active",
        message: `A stream is already ${
          this.activeSession.state === "searching" ? "searching" : "playing"
        }: ${
          this.activeSession.query
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

    // Create session
    const session: StreamSession = {
      guildId: options.guildId,
      voiceChannelId: options.voiceChannelId,
      query: options.query,
      state: "initializing",
      startTime: new Date(),
      provider: options.provider || "default",
    };

    this.activeSession = session;
    console.log(`[StreamPlayerManager] Created active session:`, {
      guildId: session.guildId,
      query: session.query,
      state: session.state,
    });

    try {
      // Step 1: Search for content
      session.state = "searching";
      console.log(
        `[StreamPlayerManager] Starting search for: "${options.query}"`
      );
      const searchData = await this.searchContent(
        options.query,
        options.provider
      );
      const searchResults = searchData.results;
      const searchPage = searchData.page;

      console.log(
        `[StreamPlayerManager] Search completed: ${
          searchResults?.length || 0
        } results found`
      );

      if (!searchResults || searchResults.length === 0) {
        // Close search page if no results
        await this.puppeteerService.closePage(searchPage);
        session.state = "error";
        session.error = "Content not found";
        this.activeSession = null; // Clear session on error
        return {
          success: false,
          error: "Content not found",
          message: `Could not find "${options.query}"`,
          session,
        };
      }

      // If multiple results, return them for user selection
      // Keep the search page open so we can navigate to the selected result
      if (searchResults.length > 1) {
        // Store search results and page in session for selection
        (session as any).pendingSearchResults = searchResults;
        (session as any).searchPage = searchPage; // Keep page open
        console.log(
          `[StreamPlayerManager] Multiple results found, waiting for user selection. Session state:`,
          {
            guildId: session.guildId,
            state: session.state,
            hasPendingResults: !!(session as any).pendingSearchResults,
            resultCount: searchResults.length,
          }
        );

        // For YouTube provider, prepare Discord connection now (before user selects)
        // This is non-blocking - if it fails, we'll still show results and prepare later
        if (options.provider === "youtube") {
          // Run Discord preparation in background, don't wait for it
          this.prepareDiscordConnectionAsync(
            options.guildId,
            options.voiceChannelId
          ).catch((error) => {
            console.error(
              "[StreamPlayerManager] Background Discord preparation failed (non-critical):",
              error
            );
          });
        }

        // Format the list of options
        const optionsText = searchResults
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}${r.year ? ` (${r.year})` : ""}${
                r.description ? ` - ${r.description}` : ""
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
      }

      // Single result - use it directly
      const searchResult = searchResults[0];
      session.searchResult = searchResult;
      // Use the search page for navigation (no need to create a new one)
      session.page = searchPage;

      // Step 2: Create browser page and navigate
      session.state = "loading";
      const page = await this.puppeteerService.createPage();
      session.page = page;

      // Get provider
      const provider = this.providers.get(options.provider || "default");
      if (!provider) {
        throw new Error(`Provider not found: ${options.provider}`);
      }

      // Store search results in session for potential selection
      (session as any).pendingSearchResults = [searchResult];

      // Continue with streaming (single result, no selection needed)
      return this.continueStreaming(session);
    } catch (error) {
      session.state = "error";
      session.error = error instanceof Error ? error.message : String(error);

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
   * Search for content using the specified provider
   * Returns all search results (not just the first one)
   * NOTE: Page is NOT closed here - it will be closed after selection or used for playback
   */
  private async searchContent(
    query: string,
    providerName?: string,
    page?: Page
  ): Promise<{ results: SearchResult[]; page: Page }> {
    const provider = this.providers.get(providerName || "default");
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    // Create page if not provided
    const searchPage = page || (await this.puppeteerService.createPage());

    try {
      const results = await provider.searchContent(query, searchPage);
      return { results, page: searchPage };
    } catch (error) {
      // Only close page if we created it and there was an error
      if (!page) {
        await this.puppeteerService.closePage(searchPage);
      }
      throw error;
    }
  }

  /**
   * Continue streaming with a selected search result
   * Called after user selects from multiple search results
   */
  async streamWithSelection(
    guildId: Snowflake,
    selectionIndex: number
  ): Promise<StreamResult> {
    const session = this.activeSession;
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

    // Get the search results from the session
    const searchResults = (session as any).pendingSearchResults as
      | SearchResult[]
      | undefined;

    if (
      !searchResults ||
      selectionIndex < 1 ||
      selectionIndex > searchResults.length
    ) {
      return {
        success: false,
        error: "Invalid selection",
        message: `Invalid selection. Please choose a number between 1 and ${
          searchResults?.length || 0
        }.`,
      };
    }

    const selectedResult = searchResults[selectionIndex - 1]; // Convert 1-based to 0-based
    session.searchResult = selectedResult;

    // Get the search page (should still be open)
    const searchPage = (session as any).searchPage as Page | undefined;
    if (!searchPage || searchPage.isClosed()) {
      // Page was closed, create a new one
      session.page = await this.puppeteerService.createPage();
    } else {
      // Use the existing search page
      session.page = searchPage;
    }

    // Clean up temporary data
    delete (session as any).pendingSearchResults;
    delete (session as any).searchPage;

    // Continue with the streaming process
    return this.continueStreaming(session);
  }

  /**
   * Continue streaming after search result is selected
   */
  private async continueStreaming(
    session: StreamSession
  ): Promise<StreamResult> {
    console.log("[StreamPlayerManager] continueStreaming called");

    if (!session.searchResult) {
      console.error("[StreamPlayerManager] No search result in session");
      return {
        success: false,
        error: "No search result selected",
        message: "No search result available",
        session,
      };
    }

    try {
      // Get provider (use session provider or default)
      const providerName = session.provider || "default";
      const provider = this.providers.get(providerName);
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

      // For YouTube provider: Navigate to video first (but don't play), then join Discord, then play
      // For other providers: Navigate to video, play, then join Discord
      const isYouTube = providerName === "youtube";

      session.state = "loading";
      console.log(
        `[StreamPlayerManager] Navigating to: ${session.searchResult.url}`
      );

      // If we have a search page from the search step, use it; otherwise create new
      let page = session.page;
      if (!page || page.isClosed()) {
        console.log("[StreamPlayerManager] Creating new page for navigation");
        page = await this.puppeteerService.createPage();
        session.page = page;
      } else {
        console.log("[StreamPlayerManager] Using existing page for navigation");
      }

      // Navigate to content (but don't play yet for YouTube)
      console.log(
        `[StreamPlayerManager] Navigating to content page: ${session.searchResult.url}`
      );
      await provider.navigateToContent(session.searchResult, page);
      console.log("[StreamPlayerManager] Navigation complete");

      if (isYouTube) {
        // YouTube workflow:
        // 1. Navigate to video (done above)
        // 2. Join Discord and start Go Live (video page is ready)
        // 3. Then play and fullscreen
        console.log(
          "[StreamPlayerManager] YouTube provider: Joining Discord and starting stream..."
        );
        await this.streamService.startGoLiveStream(voiceChannel, page);
        console.log(
          "[StreamPlayerManager] Discord stream started, now playing video..."
        );

        // Now play the video
        await provider.closePopups(page);
        await provider.waitForPlayer(page);
        await provider.clickPlay(page);
        await provider.enterFullscreen(page);
      } else {
        // Other providers: Play video first, then join Discord
        await provider.closePopups(page);
        await provider.waitForPlayer(page);
        await provider.clickPlay(page);
        await provider.enterFullscreen(page);

        // Start Go Live streaming using user account
        await this.streamService.startGoLiveStream(voiceChannel, page);
      }

      // Step 5: Monitor content
      session.state = "playing";
      this.monitorStream(session).catch((error) => {
        console.error("[StreamPlayerManager] Error monitoring stream:", error);
      });

      return {
        success: true,
        message: `Streaming "${session.searchResult.title}"`,
        session,
      };
    } catch (error) {
      session.state = "error";
      session.error = error instanceof Error ? error.message : String(error);

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
   * Monitor stream and handle end/errors
   */
  private async monitorStream(session: StreamSession): Promise<void> {
    if (!session.page) {
      return;
    }

    try {
      // Inject end detection script
      await this.contentDetection.injectEndDetectionScript(session.page);

      // Wait for content to end
      await this.contentDetection.waitForContentEnd(session.page);

      // Content ended
      session.state = "ended";
      console.log(
        `[StreamPlayerManager] Content ended for session: ${session.query}`
      );

      // Cleanup
      await this.cleanup(session);
    } catch (error) {
      console.error("[StreamPlayerManager] Error in stream monitoring:", error);
      session.state = "error";
      session.error = error instanceof Error ? error.message : String(error);
      await this.cleanup(session);
    }
  }

  /**
   * Stop current stream
   */
  async stopStream(guildId: Snowflake): Promise<void> {
    if (!this.activeSession || this.activeSession.guildId !== guildId) {
      return;
    }

    this.activeSession.state = "stopped";
    await this.cleanup(this.activeSession);
  }

  /**
   * Cleanup stream session
   */
  private async cleanup(session: StreamSession): Promise<void> {
    try {
      // Stop Discord stream first
      await this.streamService.stopGoLiveStream(session.guildId);

      // Close browser page
      if (session.page) {
        await this.puppeteerService.closePage(session.page);
      }

      // Sign out of Discord user account
      await this.streamService.signOut();

      // Clear active session
      if (this.activeSession === session) {
        this.activeSession = null;
      }
    } catch (error) {
      console.error("[StreamPlayerManager] Error during cleanup:", error);
    }
  }

  /**
   * Get active session
   */
  getActiveSession(guildId?: Snowflake): StreamSession | null {
    console.log(`[StreamPlayerManager] getActiveSession called:`, {
      requestedGuildId: guildId,
      hasActiveSession: !!this.activeSession,
      activeSessionGuildId: this.activeSession?.guildId,
      activeSessionState: this.activeSession?.state,
      activeSessionQuery: this.activeSession?.query,
    });

    if (guildId) {
      const match =
        this.activeSession?.guildId === guildId ? this.activeSession : null;
      console.log(`[StreamPlayerManager] getActiveSession result:`, {
        matched: !!match,
        sessionState: match?.state,
      });
      return match;
    }
    return this.activeSession;
  }

  /**
   * Prepare Discord connection asynchronously (non-blocking)
   * Used for YouTube provider to prepare connection in background
   */
  private async prepareDiscordConnectionAsync(
    guildId: Snowflake,
    voiceChannelId: Snowflake
  ): Promise<void> {
    try {
      if (!this.client) {
        throw new Error("Client not initialized");
      }

      const guild = await this.client.guilds.fetch(guildId);
      const voiceChannel = (await guild.channels.fetch(
        voiceChannelId
      )) as VoiceChannel | null;

      if (voiceChannel && voiceChannel.isVoiceBased()) {
        await this.streamService.prepareDiscordConnection(voiceChannel);
        console.log(
          "[StreamPlayerManager] Prepared Discord connection for YouTube, ready to join when video is selected"
        );
      }
    } catch (error) {
      console.error(
        "[StreamPlayerManager] Failed to prepare Discord connection:",
        error
      );
      // Don't throw - this is non-critical, we'll prepare when user selects
    }
  }

  /**
   * Check if streaming
   * Returns true if there's an active session in any non-terminal state
   */
  isStreaming(guildId?: Snowflake): boolean {
    if (!this.activeSession) {
      return false;
    }

    // Check if session matches guild (if specified)
    if (guildId && this.activeSession.guildId !== guildId) {
      return false;
    }

    // Consider any state that's not terminal as "streaming"
    // Terminal states: "stopped", "ended", "error"
    // Active states: "initializing", "searching", "loading", "playing"
    const terminalStates: StreamState[] = ["stopped", "ended", "error"];
    return !terminalStates.includes(this.activeSession.state);
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    // Stop active stream
    if (this.activeSession) {
      await this.cleanup(this.activeSession);
    }

    // Cleanup stream service
    await this.streamService.cleanup();

    // Shutdown browser
    await this.puppeteerService.shutdown();
  }
}
