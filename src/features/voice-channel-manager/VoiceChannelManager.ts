import {
	ChannelType,
	type Client,
	type Guild,
	type GuildMember,
	VoiceChannel,
} from "discord.js";
import type { SurrealDBManager } from "../../database/SurrealDBManager.js";
import type { VoiceSessionTracker } from "../voice-session-tracker/VoiceSessionTracker.js";

export class VoiceChannelManager {
	private static processWideLock = false; // Process-wide lock shared across ALL instances
	private client: Client;
	private db: SurrealDBManager;
	private spawnChannelId: string;
	private pendingSpawnJoins = new Set<string>();
	private globalLock = false;

	constructor(
		client: Client,
		db: SurrealDBManager,
		spawnChannelId: string,
		voiceSessionTracker?: VoiceSessionTracker,
	) {
		this.client = client;
		this.db = db;
		this.spawnChannelId = spawnChannelId;
	}

	async initialize(): Promise<void> {
		console.log("🔹 Initializing Voice Channel Manager...");
		console.log(`🔹 Spawn channel ID: ${this.spawnChannelId}`);

		// Remove any existing handlers first to prevent duplicates from hot-reload
		this.client.removeAllListeners("voiceStateUpdate");

		this.client.on("voiceStateUpdate", async (oldState, newState) => {
			const guild = newState.guild;
			const user = newState.member?.user;

			if (!user) return;

			console.log(
				`🔹 [VOICE_STATE] ${user.username}: ${oldState.channelId || "none"} -> ${newState.channelId || "none"}`,
			);

			// User joined spawn channel - create their channel
			if (newState.channelId === this.spawnChannelId) {
				console.log(`🔹 [VOICE_STATE] ${user.username} joined spawn channel!`);

				// ULTRA-FIRST: Check process-wide lock - prevent ANY channel creation across ALL instances
				if (VoiceChannelManager.processWideLock) {
					console.log(
						`🔹 [PROCESS_LOCK] Channel creation locked process-wide, skipping ${user.username}`,
					);
					return;
				}

				// FIRST: Set process-wide lock IMMEDIATELY
				VoiceChannelManager.processWideLock = true;
				console.log(
					"🔹 [PROCESS_LOCK_SET] Process-wide channel creation locked",
				);

				// SECOND: Check user-specific duplicate prevention
				const key = `${user.id}:${guild.id}`;
				if (this.pendingSpawnJoins.has(key)) {
					console.log(
						`🔹 [DUPLICATE] User ${user.username} already processing, skipping`,
					);
					this.globalLock = false;
					return;
				}

				this.pendingSpawnJoins.add(key);

				try {
					if (newState.member) {
						await this.createUserChannel(newState.member, guild);
					}
				} catch (error) {
					console.error(
						`🔸 Error creating channel for ${user.username}:`,
						error,
					);
				} finally {
					setTimeout(() => {
						this.pendingSpawnJoins.delete(key);
						VoiceChannelManager.processWideLock = false;
						console.log(
							"🔹 [PROCESS_LOCK_RELEASE] Process-wide channel creation unlocked",
						);
					}, 2000);
				}
				return;
			}

			// User left a voice channel - check if it's empty and should be deleted
			if (oldState.channelId && oldState.channelId !== this.spawnChannelId) {
				const oldChannel = oldState.channel;
				if (oldChannel?.isVoiceBased()) {
					// Check if this is a user channel by name pattern
					if (oldChannel.name.includes("'s Channel")) {
						const memberCount = oldChannel.members.size;
						console.log(
							`🔹 [VOICE_STATE] User ${user.username} left user channel ${oldChannel.name}, ${memberCount} members remaining`,
						);

						if (memberCount === 0) {
							console.log(
								`🔹 [VOICE_STATE] Channel ${oldChannel.name} is empty, deleting...`,
							);
							try {
								await oldChannel.delete();
								console.log(
									`🔹 [VOICE_STATE] Deleted empty channel ${oldChannel.name}`,
								);
							} catch (error) {
								console.error(
									`🔸 Failed to delete channel ${oldChannel.name}:`,
									error,
								);
							}
						}
					}
				}
			}
		});

		console.log("🔹 Voice Channel Manager initialized");
	}

	private async createUserChannel(
		user: GuildMember,
		guild: Guild,
	): Promise<void> {
		console.log(`🔹 Creating channel for user: ${user.displayName}`);

		// Clean up any existing channels with user's name pattern
		const existingChannels = guild.channels.cache.filter(
			(channel) =>
				channel.isVoiceBased() &&
				channel.name === `${user.displayName}'s Channel`,
		);

		if (existingChannels.size > 0) {
			console.log(
				`🔹 Found ${existingChannels.size} existing channels for ${user.displayName}, deleting them...`,
			);
			for (const channel of existingChannels.values()) {
				try {
					await channel.delete();
					console.log(`🔹 Deleted existing channel ${channel.name}`);
				} catch (error) {
					console.error("🔸 Failed to delete existing channel:", error);
				}
			}
		}

		// Get spawn channel for positioning
		const spawnChannel = guild.channels.cache.get(this.spawnChannelId);
		if (!spawnChannel?.isVoiceBased()) {
			throw new Error("Spawn channel not found or not voice channel");
		}

		// Create new channel
		const channelName = `${user.displayName}'s Channel`;
		console.log(`🔹 Creating voice channel '${channelName}'`);

		const newChannel = await guild.channels.create({
			name: channelName,
			type: ChannelType.GuildVoice,
			parent: spawnChannel.parent,
			position: spawnChannel.position,
		});

		// Position the new channel above the spawn channel
		await newChannel.setPosition(spawnChannel.position - 1);

		// Move user into their new channel
		await user.voice.setChannel(newChannel.id);

		console.log(`🔹 Created channel '${channelName}' (ID: ${newChannel.id})`);
	}
}
