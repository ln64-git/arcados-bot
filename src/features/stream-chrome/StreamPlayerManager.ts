import type { Client, Snowflake } from "discord.js";
import { StreamController } from "./core/StreamController.js";
import type {
	StreamSession,
	StreamResult,
	StreamOptions,
} from "./types.js";

/**
 * Main orchestrator for stream player feature
 *
 * @deprecated This class is deprecated. Use StreamController instead.
 * This class now delegates all operations to StreamController for backward compatibility.
 * New code should use StreamController directly.
 *
 * StreamPlayerManager will be removed in a future version.
 */
export class StreamPlayerManager {
	private static instance: StreamPlayerManager;
	private controller: StreamController;
	private client: Client | null = null;

	private constructor() {
		this.controller = StreamController.getInstance();
	}

	public static getInstance(): StreamPlayerManager {
		if (!StreamPlayerManager.instance) {
			StreamPlayerManager.instance = new StreamPlayerManager();
		}
		return StreamPlayerManager.instance;
	}

	/**
	 * Initialize the stream player
	 * @deprecated Use StreamController.initialize() instead
	 */
	async initialize(client: Client): Promise<void> {
		console.warn(
			"[StreamPlayerManager] initialize() is deprecated. Use StreamController.initialize() instead."
		);
		this.client = client;
		await this.controller.initialize(client);
	}

	/**
	 * Stream content to a voice channel
	 * @deprecated Use StreamController.streamContent() instead
	 */
	async streamContent(options: StreamOptions): Promise<StreamResult> {
		console.warn(
			"[StreamPlayerManager] streamContent() is deprecated. Use StreamController.streamContent() instead."
		);
		return await this.controller.streamContent(options);
	}

	/**
	 * Continue streaming with a selected search result
	 * Called after user selects from multiple search results
	 * @deprecated Use StreamController.selectContent() instead
	 */
	async streamWithSelection(
		guildId: Snowflake,
		selectionIndex: number
	): Promise<StreamResult> {
		console.warn(
			"[StreamPlayerManager] streamWithSelection() is deprecated. Use StreamController.selectContent() instead."
		);
		// Convert numeric index to string for selectContent
		return await this.controller.selectContent(guildId, String(selectionIndex));
	}

	/**
	 * Stop current stream
	 * @deprecated Use StreamController.stopStream() instead
	 */
	async stopStream(guildId: Snowflake): Promise<void> {
		console.warn(
			"[StreamPlayerManager] stopStream() is deprecated. Use StreamController.stopStream() instead."
		);
		return await this.controller.stopStream(guildId);
	}

	/**
	 * Get active session
	 * @deprecated Use StreamController.getActiveSession() instead
	 */
	getActiveSession(guildId?: Snowflake): StreamSession | null {
		console.warn(
			"[StreamPlayerManager] getActiveSession() is deprecated. Use StreamController.getActiveSession() instead."
		);
		return this.controller.getActiveSession(guildId);
	}

	/**
	 * Check if streaming
	 * Returns true if there's an active session in any non-terminal state
	 * @deprecated Use StreamController.isStreaming() instead
	 */
	isStreaming(guildId?: Snowflake): boolean {
		console.warn(
			"[StreamPlayerManager] isStreaming() is deprecated. Use StreamController.isStreaming() instead."
		);
		return this.controller.isStreaming(guildId);
	}

	/**
	 * Shutdown and cleanup
	 * @deprecated Use StreamController.shutdown() instead
	 */
	async shutdown(): Promise<void> {
		console.warn(
			"[StreamPlayerManager] shutdown() is deprecated. Use StreamController.shutdown() instead."
		);
		return await this.controller.shutdown();
	}

	/**
	 * Get client (for backward compatibility)
	 * @deprecated Access client through StreamController if needed
	 */
	getClient(): Client | null {
		return this.client;
	}
}
