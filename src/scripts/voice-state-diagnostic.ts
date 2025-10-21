import "dotenv/config";
import { Client, GatewayIntentBits, type VoiceState } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager";

class VoiceStateDiagnostic {
	private client: Client;
	private dbManager: SurrealDBManager;
	private eventCount = 0;

	constructor() {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMembers,
				GatewayIntentBits.GuildVoiceStates,
			],
		});
		this.dbManager = new SurrealDBManager();
	}

	async start() {
		try {
			console.log("🔍 Starting Voice State Diagnostic...");

			// Connect to Discord
			await this.client.login(process.env.DISCORD_BOT_TOKEN);
			await new Promise((resolve) => this.client.once("ready", resolve));
			console.log("🔹 Connected to Discord");

			// Connect to database
			const connected = await this.dbManager.connect();
			if (!connected) {
				console.error("🔸 Failed to connect to database");
				return;
			}
			console.log("🔹 Connected to database");

			// Setup event listeners
			this.setupEventListeners();

			// Log current state
			await this.logCurrentState();

			console.log("🔹 Monitoring voice state events... (Press Ctrl+C to stop)");

			// Keep running
			process.on("SIGINT", () => {
				console.log("\n🔹 Stopping diagnostic...");
				this.stop();
			});
		} catch (error) {
			console.error("🔸 Error starting diagnostic:", error);
		}
	}

	private setupEventListeners() {
		this.client.on("voiceStateUpdate", async (oldState, newState) => {
			this.eventCount++;
			await this.handleVoiceStateUpdate(oldState, newState);
		});

		this.client.on("error", (error) => {
			console.error("🔸 Discord client error:", error);
		});

		this.client.on("warn", (warning) => {
			console.warn("🔸 Discord client warning:", warning);
		});
	}

	private async handleVoiceStateUpdate(
		oldState: VoiceState,
		newState: VoiceState,
	) {
		const user = newState.member?.user || oldState.member?.user;
		if (!user) {
			console.log(
				`🔸 Event ${this.eventCount}: No user found in voice state update`,
			);
			return;
		}

		const guildId = newState.guild.id;
		const userId = user.id;
		const oldChannelId = oldState.channelId;
		const newChannelId = newState.channelId;

		console.log(`\n🔍 Event ${this.eventCount}: ${user.username} (${userId})`);
		console.log(
			`   Old: ${oldChannelId ? oldState.channel?.name : "not in voice"}`,
		);
		console.log(
			`   New: ${newChannelId ? newState.channel?.name : "not in voice"}`,
		);

		// Determine event type
		let eventType = "unknown";
		if (!oldChannelId && newChannelId) {
			eventType = "JOIN";
		} else if (oldChannelId && !newChannelId) {
			eventType = "LEAVE";
		} else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
			eventType = "SWITCH";
		} else if (oldChannelId === newChannelId) {
			eventType = "STATE_CHANGE";
		}

		console.log(`   Event Type: ${eventType}`);

		// Check database state before and after
		await this.checkDatabaseState(userId, guildId, "BEFORE");

		// Simulate what the VoiceSessionTracker would do
		try {
			if (eventType === "JOIN") {
				await this.simulateVoiceJoin(newState);
			} else if (eventType === "LEAVE") {
				await this.simulateVoiceLeave(oldState, newState);
			} else if (eventType === "SWITCH") {
				await this.simulateVoiceSwitch(oldState, newState);
			} else if (eventType === "STATE_CHANGE") {
				await this.simulateVoiceStateChange(oldState, newState);
			}
		} catch (error) {
			console.error(`🔸 Error simulating ${eventType}:`, error);
		}

		await this.checkDatabaseState(userId, guildId, "AFTER");
	}

	private async simulateVoiceJoin(newState: VoiceState) {
		const user = newState.member?.user;
		if (!user) return;

		const guildId = newState.guild.id;
		const userId = user.id;
		const channelId = newState.channelId;
		if (!channelId) return;

		console.log(`   🔹 Simulating VOICE JOIN for ${user.username}`);

		// Create voice state data (simplified)
		const voiceStateData = {
			id: `${guildId}_${userId}`,
			guild_id: guildId,
			user_id: userId,
			channel_id: channelId,
			self_mute: newState.selfMute || false,
			self_deaf: newState.selfDeaf || false,
			server_mute: newState.mute || false,
			server_deaf: newState.deaf || false,
			streaming: newState.streaming || false,
			self_video: newState.selfVideo || false,
			suppress: newState.suppress || false,
			session_id: "test-session-" + Date.now(),
			joined_at: new Date(),
			created_at: new Date(),
		};

		const result = await this.dbManager.upsertVoiceState(voiceStateData);
		if (!result.success) {
			console.error(`   🔸 Failed to upsert voice state (join):`, result.error);
		} else {
			console.log(`   ✅ Voice join upsert successful`);
		}
	}

	private async simulateVoiceLeave(oldState: VoiceState, newState: VoiceState) {
		const user = oldState.member?.user;
		if (!user) return;

		const guildId = oldState.guild.id;
		const userId = user.id;

		console.log(`   🔹 Simulating VOICE LEAVE for ${user.username}`);

		// Create voice state data with channel_id omitted (to clear it)
		const voiceStateData = {
			id: `${guildId}_${userId}`,
			guild_id: guildId,
			user_id: userId,
			// channel_id omitted to clear it
			self_mute: newState.selfMute || false,
			self_deaf: newState.selfDeaf || false,
			server_mute: newState.mute || false,
			server_deaf: newState.deaf || false,
			streaming: newState.streaming || false,
			self_video: newState.selfVideo || false,
			suppress: newState.suppress || false,
			// session_id and joined_at omitted to clear them
			created_at: new Date(),
		};

		const result = await this.dbManager.upsertVoiceState(voiceStateData);
		if (!result.success) {
			console.error(
				`   🔸 Failed to upsert voice state (leave):`,
				result.error,
			);
		} else {
			console.log(`   ✅ Voice leave upsert successful`);
		}
	}

	private async simulateVoiceSwitch(
		oldState: VoiceState,
		newState: VoiceState,
	) {
		const user = newState.member?.user;
		if (!user) return;

		console.log(`   🔹 Simulating VOICE SWITCH for ${user.username}`);

		// For switches, we update with the new channel
		const voiceStateData = {
			id: `${oldState.guild.id}_${user.id}`,
			guild_id: oldState.guild.id,
			user_id: user.id,
			channel_id: newState.channelId,
			self_mute: newState.selfMute || false,
			self_deaf: newState.selfDeaf || false,
			server_mute: newState.mute || false,
			server_deaf: newState.deaf || false,
			streaming: newState.streaming || false,
			self_video: newState.selfVideo || false,
			suppress: newState.suppress || false,
			session_id: "test-session-" + Date.now(),
			joined_at: new Date(),
			created_at: new Date(),
		};

		const result = await this.dbManager.upsertVoiceState(voiceStateData);
		if (!result.success) {
			console.error(
				`   🔸 Failed to upsert voice state (switch):`,
				result.error,
			);
		} else {
			console.log(`   ✅ Voice switch upsert successful`);
		}
	}

	private async simulateVoiceStateChange(
		oldState: VoiceState,
		newState: VoiceState,
	) {
		const user = newState.member?.user;
		if (!user) return;

		console.log(`   🔹 Simulating VOICE STATE CHANGE for ${user.username}`);

		// For state changes, we update the existing record
		const voiceStateData = {
			id: `${oldState.guild.id}_${user.id}`,
			guild_id: oldState.guild.id,
			user_id: user.id,
			channel_id: newState.channelId,
			self_mute: newState.selfMute || false,
			self_deaf: newState.selfDeaf || false,
			server_mute: newState.mute || false,
			server_deaf: newState.deaf || false,
			streaming: newState.streaming || false,
			self_video: newState.selfVideo || false,
			suppress: newState.suppress || false,
			session_id: "test-session-" + Date.now(),
			joined_at: new Date(),
			created_at: new Date(),
		};

		const result = await this.dbManager.upsertVoiceState(voiceStateData);
		if (!result.success) {
			console.error(
				`   🔸 Failed to upsert voice state (state_change):`,
				result.error,
			);
		} else {
			console.log(`   ✅ Voice state change upsert successful`);
		}
	}

	private async checkDatabaseState(
		userId: string,
		guildId: string,
		timing: string,
	) {
		try {
			const result = await this.dbManager.db.query(
				"SELECT * FROM voice_states WHERE user_id = $user_id AND guild_id = $guild_id",
				{ user_id: userId, guild_id: guildId },
			);

			const voiceStates = (result[0] as any[]) || [];
			if (voiceStates.length === 0) {
				console.log(`   📊 ${timing}: No voice state record found`);
			} else {
				const state = voiceStates[0];
				console.log(
					`   📊 ${timing}: channel_id=${state.channel_id || "NONE"}, session_id=${state.session_id || "NONE"}`,
				);
			}
		} catch (error) {
			console.error(`   🔸 Error checking database state (${timing}):`, error);
		}
	}

	private async logCurrentState() {
		console.log("\n🔍 Current Discord Voice State:");

		const guild = this.client.guilds.cache.get("1254694808228986912");
		if (!guild) {
			console.log("❌ Guild not found");
			return;
		}

		const voiceStates = guild.voiceStates.cache;
		console.log(`   Found ${voiceStates.size} users in voice channels`);

		for (const [userId, voiceState] of voiceStates) {
			const user = voiceState.member?.user;
			if (user) {
				console.log(
					`   - ${user.username}: ${voiceState.channel?.name || "unknown"}`,
				);
			}
		}

		console.log("\n🔍 Current Database Voice States:");
		const result = await this.dbManager.db.query(
			"SELECT * FROM voice_states WHERE guild_id = $guild_id AND channel_id IS NOT NONE",
			{ guild_id: "1254694808228986912" },
		);

		const dbStates = (result[0] as any[]) || [];
		console.log(
			`   Found ${dbStates.length} users marked as in voice channels`,
		);

		for (const state of dbStates) {
			console.log(`   - User ${state.user_id}: channel ${state.channel_id}`);
		}
	}

	private async stop() {
		await this.dbManager.disconnect();
		await this.client.destroy();
		console.log("🔹 Diagnostic stopped");
		process.exit(0);
	}
}

// Start the diagnostic
const diagnostic = new VoiceStateDiagnostic();
diagnostic.start().catch(console.error);
