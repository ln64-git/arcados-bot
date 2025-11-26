import type { VoiceChannel } from "discord.js";
import type { Page, Browser } from "puppeteer";
import { DiscordUserAccountService } from "./DiscordUserAccountService.js";

/**
 * Service for streaming browser content to Discord via Go Live
 * 
 * This service uses a separate Discord user account (not the bot account) to:
 * 1. Sign into Discord web client via Puppeteer
 * 2. Join voice channels
 * 3. Start Go Live streaming
 * 4. Stream browser content (video + audio) to Discord
 * 
 * NOTE: Using user accounts for automation may violate Discord ToS.
 * Use at your own risk and with a dedicated account.
 * 
 * Audio is streamed separately from voice assistant audio - users can mix independently.
 */
export class DiscordStreamService {
	private userAccountService: DiscordUserAccountService;
	private browser: Browser | null = null;

	constructor() {
		this.userAccountService = new DiscordUserAccountService();
	}

	/**
	 * Initialize with browser instance
	 */
	async initialize(browser: Browser): Promise<void> {
		this.browser = browser;
		await this.userAccountService.initialize(browser);
	}

	/**
	 * Prepare Discord connection (sign in and navigate to voice channel, but don't start streaming)
	 * This is useful for YouTube workflow where we prepare before user selects a video
	 * 
	 * @param channel Voice channel to prepare for
	 */
	async prepareDiscordConnection(channel: VoiceChannel): Promise<void> {
		try {
			// Sign into Discord if not already signed in
			if (!this.userAccountService.isSignedIn()) {
				await this.userAccountService.signIn();
			}

			// Navigate to voice channel but don't join yet
			await this.userAccountService.navigateToVoiceChannel(
				channel.guild.id,
				channel.id
			);

			console.log(
				`[DiscordStreamService] Prepared Discord connection for guild ${channel.guild.id}, ready to join when video is selected.`
			);
		} catch (error) {
			console.error("[DiscordStreamService] Failed to prepare Discord connection:", error);
			throw error;
		}
	}

	/**
	 * Start Go Live stream using user account
	 * 
	 * This method:
	 * 1. Signs into Discord with user account (if not already signed in)
	 * 2. Joins the voice channel
	 * 3. Starts Go Live streaming
	 * 4. Streams the browser content (video + audio) to Discord
	 * 
	 * @param channel Voice channel to stream to
	 * @param contentPage Puppeteer page with the content playing
	 */
	async startGoLiveStream(
		channel: VoiceChannel,
		contentPage: Page
	): Promise<void> {
		try {
			// Sign into Discord if not already signed in
			if (!this.userAccountService.isSignedIn()) {
				await this.userAccountService.signIn();
			}

			// Join voice channel and start streaming
			await this.userAccountService.joinAndStream(
				channel.guild.id,
				channel.id,
				contentPage
			);

			console.log(
				`[DiscordStreamService] Started Go Live stream for guild ${channel.guild.id}. ` +
					"Video and audio are streaming separately from voice assistant audio."
			);
		} catch (error) {
			console.error("[DiscordStreamService] Failed to start Go Live stream:", error);
			throw error;
		}
	}

	/**
	 * Stop Go Live stream and leave voice channel
	 */
	async stopGoLiveStream(guildId: string): Promise<void> {
		try {
			await this.userAccountService.stopStreaming(guildId);
			console.log(`[DiscordStreamService] Stopped Go Live stream for guild ${guildId}`);
		} catch (error) {
			console.error("[DiscordStreamService] Error stopping stream:", error);
		}
	}

	/**
	 * Sign out of Discord user account
	 */
	async signOut(): Promise<void> {
		await this.userAccountService.signOut();
	}

	/**
	 * Cleanup: stop streaming and sign out
	 */
	async cleanup(): Promise<void> {
		await this.userAccountService.cleanup();
	}

	/**
	 * Check if currently streaming
	 */
	isStreaming(guildId: string): boolean {
		return this.userAccountService.isSignedIn();
	}
}

