#!/usr/bin/env tsx

import "dotenv/config";
import {
	Client,
	GatewayIntentBits,
	type GuildMember,
	type User,
} from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager";
import type { SurrealMember } from "../database/schema";

class UserChangeWatcher {
	private client: Client;
	private db: SurrealDBManager;
	private watchedUsers = new Map<string, SurrealMember>();

	constructor() {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMembers,
				GatewayIntentBits.GuildMessages,
			],
		});

		this.db = new SurrealDBManager();
	}

	async initialize(): Promise<void> {
		console.log("🔹 Initializing User Change Watcher...");

		// Connect to database
		await this.db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Connect to Discord
		await this.client.login(process.env.DISCORD_TOKEN);
		console.log("🔹 Connected to Discord");

		// Set up event listeners
		this.setupEventListeners();

		// Load initial user data for comparison
		await this.loadInitialUserData();

		console.log("🔹 User Change Watcher initialized and ready!");
		console.log("🔹 Watching for user profile changes...");
		console.log(
			"🔹 Change your Discord profile (username, display name, avatar, etc.) to see real-time tracking!",
		);
	}

	private setupEventListeners(): void {
		// Watch for member updates (profile changes)
		this.client.on("guildMemberUpdate", async (oldMember, newMember) => {
			await this.handleMemberUpdate(oldMember, newMember);
		});

		// Watch for user updates (global profile changes)
		this.client.on("userUpdate", async (oldUser, newUser) => {
			await this.handleUserUpdate(oldUser, newUser);
		});
	}

	private async loadInitialUserData(): Promise<void> {
		try {
			// Get a sample of members from the first guild
			const guild = this.client.guilds.cache.first();
			if (!guild) {
				console.log("🔸 No guilds found");
				return;
			}

			console.log("🔹 Loading initial data for guild:", guild.name);
			const members = await guild.members.fetch({ limit: 10 });

			for (const [memberId, member] of members) {
				const fullId = guild.id + ":" + memberId;
				const dbResult = await this.db.getMember(memberId, guild.id);

				if (dbResult.success && dbResult.data) {
					this.watchedUsers.set(fullId, dbResult.data);
					console.log(
						"🔹 Loaded initial data for:",
						member.displayName,
						"(" + memberId + ")",
					);
				}
			}
		} catch (error) {
			console.error("🔸 Error loading initial user data:", error);
		}
	}

	private async handleMemberUpdate(
		oldMember: GuildMember,
		newMember: GuildMember,
	): Promise<void> {
		const fullId = newMember.guild.id + ":" + newMember.id;
		const oldData = this.watchedUsers.get(fullId);

		console.log(
			"\n🔹 Member Update Detected:",
			newMember.displayName,
			"(" + newMember.id + ")",
		);

		// Check for specific changes
		const changes: string[] = [];

		if (oldMember.displayName !== newMember.displayName) {
			changes.push(
				'Display Name: "' +
					oldMember.displayName +
					'" → "' +
					newMember.displayName +
					'"',
			);
		}

		if (oldMember.nickname !== newMember.nickname) {
			changes.push(
				'Nickname: "' + oldMember.nickname + '" → "' + newMember.nickname + '"',
			);
		}

		if (oldMember.avatar !== newMember.avatar) {
			changes.push("Avatar: Changed");
		}

		if (oldMember.user.username !== newMember.user.username) {
			changes.push(
				'Username: "' +
					oldMember.user.username +
					'" → "' +
					newMember.user.username +
					'"',
			);
		}

		if (oldMember.user.globalName !== newMember.user.globalName) {
			changes.push(
				'Global Name: "' +
					oldMember.user.globalName +
					'" → "' +
					newMember.user.globalName +
					'"',
			);
		}

		if (changes.length > 0) {
			console.log("🔹 Changes detected:");
			for (const change of changes) {
				console.log("  -", change);
			}

			// Wait a moment for the database to be updated
			setTimeout(async () => {
				await this.checkDatabaseUpdate(fullId, newMember);
			}, 2000);
		} else {
			console.log("🔹 No profile changes detected");
		}
	}

	private async handleUserUpdate(oldUser: User, newUser: User): Promise<void> {
		console.log(
			"\n🔹 User Update Detected:",
			newUser.username,
			"(" + newUser.id + ")",
		);

		const changes: string[] = [];

		if (oldUser.username !== newUser.username) {
			changes.push(
				'Username: "' + oldUser.username + '" → "' + newUser.username + '"',
			);
		}

		if (oldUser.globalName !== newUser.globalName) {
			changes.push(
				'Global Name: "' +
					oldUser.globalName +
					'" → "' +
					newUser.globalName +
					'"',
			);
		}

		if (oldUser.avatar !== newUser.avatar) {
			changes.push("Avatar: Changed");
		}

		if (oldUser.discriminator !== newUser.discriminator) {
			changes.push(
				'Discriminator: "' +
					oldUser.discriminator +
					'" → "' +
					newUser.discriminator +
					'"',
			);
		}

		if (changes.length > 0) {
			console.log("🔹 Global user changes detected:");
			for (const change of changes) {
				console.log("  -", change);
			}

			// Check all guilds where this user is a member
			for (const guild of this.client.guilds.cache.values()) {
				const member = guild.members.cache.get(newUser.id);
				if (member) {
					const fullId = guild.id + ":" + newUser.id;
					setTimeout(async () => {
						await this.checkDatabaseUpdate(fullId, member);
					}, 2000);
				}
			}
		}
	}

	private async checkDatabaseUpdate(
		fullId: string,
		member: GuildMember,
	): Promise<void> {
		try {
			const dbResult = await this.db.getMember(member.id, member.guild.id);

			if (dbResult.success && dbResult.data) {
				const newData = dbResult.data;
				const oldData = this.watchedUsers.get(fullId);

				if (oldData) {
					console.log("🔹 Checking database for changes...");

					const dbChanges: string[] = [];

					if (oldData.display_name !== newData.display_name) {
						dbChanges.push(
							'DB Display Name: "' +
								oldData.display_name +
								'" → "' +
								newData.display_name +
								'"',
						);
					}

					if (oldData.nickname !== newData.nickname) {
						dbChanges.push(
							'DB Nickname: "' +
								oldData.nickname +
								'" → "' +
								newData.nickname +
								'"',
						);
					}

					if (oldData.username !== newData.username) {
						dbChanges.push(
							'DB Username: "' +
								oldData.username +
								'" → "' +
								newData.username +
								'"',
						);
					}

					if (oldData.global_name !== newData.global_name) {
						dbChanges.push(
							'DB Global Name: "' +
								oldData.global_name +
								'" → "' +
								newData.global_name +
								'"',
						);
					}

					if (oldData.avatar !== newData.avatar) {
						dbChanges.push("DB Avatar: Changed");
					}

					if (oldData.profile_hash !== newData.profile_hash) {
						dbChanges.push("DB Profile Hash: Changed");
					}

					if (newData.profile_history && newData.profile_history.length > 0) {
						const latestHistory =
							newData.profile_history[newData.profile_history.length - 1];
						console.log("🔹 Latest profile history entry:", latestHistory);
					}

					if (dbChanges.length > 0) {
						console.log("✅ Database changes detected:");
						for (const change of dbChanges) {
							console.log("  -", change);
						}
						console.log(
							"🔹 Profile history entries:",
							newData.profile_history?.length || 0,
						);
					} else {
						console.log("🔸 No database changes detected");
					}
				}

				// Update our local cache
				this.watchedUsers.set(fullId, newData);
			} else {
				console.log("🔸 Could not retrieve updated data from database");
			}
		} catch (error) {
			console.error("🔸 Error checking database update:", error);
		}
	}

	async shutdown(): Promise<void> {
		console.log("\n🔹 Shutting down User Change Watcher...");
		await this.client.destroy();
		await this.db.disconnect();
		console.log("🔹 User Change Watcher shut down");
	}
}

// Main execution
async function main() {
	const watcher = new UserChangeWatcher();

	// Handle graceful shutdown
	process.on("SIGINT", async () => {
		console.log("\n🔹 Received SIGINT, shutting down...");
		await watcher.shutdown();
		process.exit(0);
	});

	process.on("SIGTERM", async () => {
		console.log("\n🔹 Received SIGTERM, shutting down...");
		await watcher.shutdown();
		process.exit(0);
	});

	try {
		await watcher.initialize();
	} catch (error) {
		console.error("🔸 Failed to initialize User Change Watcher:", error);
		process.exit(1);
	}
}

// Run the script
main().catch(console.error);

export { UserChangeWatcher };
