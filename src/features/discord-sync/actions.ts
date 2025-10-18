import type { Client, Guild, GuildMember, TextChannel } from "discord.js";
import type { SurrealDBManager } from "../../database/SurrealDBManager";
import type {
	ActionPayload,
	ActionType,
	SurrealAction,
} from "../../database/schema";

export class DatabaseActions {
	private client: Client;
	private db: SurrealDBManager;
	private actionHandlers: Map<
		ActionType,
		(payload: Record<string, unknown>) => Promise<void>
	> = new Map();

	constructor(client: Client, db: SurrealDBManager) {
		this.client = client;
		this.db = db;
		this.setupActionHandlers();
	}

	private setupActionHandlers(): void {
		// Member role update action
		this.actionHandlers.set(
			"member_role_update",
			async (payload: Record<string, unknown>) => {
				const rolePayload = payload as ActionPayload["member_role_update"];
				if (!rolePayload) return;

				try {
					const guild = await this.client.guilds.fetch(rolePayload.guild_id);
					const member = await guild.members.fetch(rolePayload.user_id);

					// Get current roles and new roles
					const currentRoles = member.roles.cache.map((role) => role.id);
					const newRoles = rolePayload.role_ids;

					// Find roles to add and remove
					const rolesToAdd = newRoles.filter(
						(roleId) => !currentRoles.includes(roleId),
					);
					const rolesToRemove = currentRoles.filter(
						(roleId) => !newRoles.includes(roleId) && roleId !== guild.id,
					); // Don't remove @everyone role

					// Apply role changes
					if (rolesToAdd.length > 0) {
						await member.roles.add(rolesToAdd);
						console.log(
							`🔹 Added roles to ${member.displayName}: ${rolesToAdd.join(", ")}`,
						);
					}

					if (rolesToRemove.length > 0) {
						await member.roles.remove(rolesToRemove);
						console.log(
							`🔹 Removed roles from ${member.displayName}: ${rolesToRemove.join(", ")}`,
						);
					}
				} catch (error) {
					console.error("🔸 Failed to update member roles:", error);
				}
			},
		);

		// Member ban action
		this.actionHandlers.set(
			"member_ban",
			async (payload: Record<string, unknown>) => {
				const banPayload = payload as ActionPayload["member_ban"];
				if (!banPayload) return;

				try {
					const guild = await this.client.guilds.fetch(banPayload.guild_id);
					const member = await guild.members.fetch(banPayload.user_id);

					await member.ban({
						reason: banPayload.reason || "Database-triggered ban",
					});
					console.log(
						`🔹 Banned member ${member.displayName} from guild ${guild.name}`,
					);
				} catch (error) {
					console.error("🔸 Failed to ban member:", error);
				}
			},
		);

		// Scheduled message action
		this.actionHandlers.set(
			"scheduled_message",
			async (payload: Record<string, unknown>) => {
				const messagePayload = payload as ActionPayload["scheduled_message"];
				if (!messagePayload) return;

				try {
					const channel = (await this.client.channels.fetch(
						messagePayload.channel_id,
					)) as TextChannel;

					const messageOptions: {
						content: string;
						embeds?: Record<string, unknown>[];
					} = {
						content: messagePayload.content,
					};

					if (messagePayload.embeds && messagePayload.embeds.length > 0) {
						messageOptions.embeds = messagePayload.embeds as Record<
							string,
							unknown
						>[];
					}

					await channel.send(messageOptions);
					console.log(`🔹 Sent scheduled message to channel ${channel.name}`);
				} catch (error) {
					console.error("🔸 Failed to send scheduled message:", error);
				}
			},
		);

		// Member count milestone action
		this.actionHandlers.set(
			"member_count_milestone",
			async (payload: Record<string, unknown>) => {
				const milestonePayload =
					payload as ActionPayload["member_count_milestone"];
				if (!milestonePayload) return;

				try {
					const guild = await this.client.guilds.fetch(
						milestonePayload.guild_id,
					);
					const channelId =
						milestonePayload.channel_id || guild.systemChannelId;

					if (!channelId) {
						console.log(
							`🔸 No channel specified for milestone announcement in guild ${guild.name}`,
						);
						return;
					}

					const channel = (await this.client.channels.fetch(
						channelId,
					)) as TextChannel;

					const milestoneMessage = `🎉 **Milestone Reached!** 🎉

We've reached **${milestonePayload.milestone}** members! Thank you to everyone who's part of our amazing community! 🚀`;

					await channel.send(milestoneMessage);
					console.log(
						`🔹 Sent milestone message for ${milestonePayload.milestone} members in guild ${guild.name}`,
					);
				} catch (error) {
					console.error("🔸 Failed to send milestone message:", error);
				}
			},
		);

		// User XP threshold action
		this.actionHandlers.set(
			"user_xp_threshold",
			async (payload: Record<string, unknown>) => {
				const xpPayload = payload as ActionPayload["user_xp_threshold"];
				if (!xpPayload) return;

				try {
					const guild = await this.client.guilds.fetch(xpPayload.guild_id);
					const member = await guild.members.fetch(xpPayload.user_id);
					const role = await guild.roles.fetch(xpPayload.role_id);

					if (!role) {
						console.error(
							`🔸 Role ${xpPayload.role_id} not found in guild ${guild.name}`,
						);
						return;
					}

					await member.roles.add(role);
					console.log(
						`🔹 Added achievement role ${role.name} to ${member.displayName} for reaching ${xpPayload.threshold} XP`,
					);
				} catch (error) {
					console.error("🔸 Failed to add achievement role:", error);
				}
			},
		);

		// Global ban update action
		this.actionHandlers.set(
			"global_ban_update",
			async (payload: Record<string, unknown>) => {
				const globalBanPayload = payload as ActionPayload["global_ban_update"];
				if (!globalBanPayload) return;

				try {
					for (const guildId of globalBanPayload.guild_ids) {
						const guild = await this.client.guilds.fetch(guildId);
						const member = await guild.members.fetch(globalBanPayload.user_id);

						await member.ban({
							reason:
								globalBanPayload.reason || "Global ban - Database triggered",
						});
						console.log(
							`🔹 Applied global ban to ${member.displayName} in guild ${guild.name}`,
						);
					}
				} catch (error) {
					console.error("🔸 Failed to apply global ban:", error);
				}
			},
		);

		// Custom action handler
		this.actionHandlers.set(
			"custom_action",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					// Log custom action for debugging
					console.log("🔹 Custom action triggered:", payload);

					// You can extend this to handle specific custom action types
					// For now, just log the payload
				} catch (error) {
					console.error("🔸 Failed to execute custom action:", error);
				}
			},
		);

		console.log("🔹 Database action handlers registered");
	}

	async executeAction(action: SurrealAction): Promise<void> {
		try {
			const handler = this.actionHandlers.get(action.type as ActionType);

			if (!handler) {
				console.error(`🔸 No handler found for action type: ${action.type}`);
				return;
			}

			// Check if action should be executed now or scheduled
			if (action.execute_at && action.execute_at > new Date()) {
				console.log(
					`🔹 Action ${action.id} scheduled for ${action.execute_at.toISOString()}`,
				);
				return;
			}

			await handler(action.payload);

			// Mark action as executed
			await this.db.markActionExecuted(action.id);
			console.log(`🔹 Executed action ${action.id} of type ${action.type}`);
		} catch (error) {
			console.error(`🔸 Failed to execute action ${action.id}:`, error);
		}
	}

	async processPendingActions(): Promise<void> {
		try {
			const result = await this.db.getPendingActions();

			if (!result.success || !result.data) {
				console.error("🔸 Failed to get pending actions:", result.error);
				return;
			}

			const now = new Date();
			const actionsToExecute = result.data.filter(
				(action: SurrealAction) =>
					!action.executed && (!action.execute_at || action.execute_at <= now),
			);

			for (const action of actionsToExecute) {
				await this.executeAction(action);
			}
		} catch (error) {
			console.error("🔸 Error processing pending actions:", error);
		}
	}

	// Utility methods for creating actions
	async createMemberRoleUpdateAction(
		guildId: string,
		userId: string,
		roleIds: string[],
	): Promise<void> {
		const action = {
			guild_id: guildId,
			type: "member_role_update" as ActionType,
			payload: {
				guild_id: guildId,
				user_id: userId,
				role_ids: roleIds,
			} as ActionPayload["member_role_update"],
		};

		await this.db.createAction(action);
	}

	async createMemberBanAction(
		guildId: string,
		userId: string,
		reason?: string,
	): Promise<void> {
		const action = {
			guild_id: guildId,
			type: "member_ban" as ActionType,
			payload: {
				guild_id: guildId,
				user_id: userId,
				reason,
			} as ActionPayload["member_ban"],
		};

		await this.db.createAction(action);
	}

	async createScheduledMessageAction(
		guildId: string,
		channelId: string,
		content: string,
		executeAt?: Date,
	): Promise<void> {
		const action = {
			guild_id: guildId,
			type: "scheduled_message" as ActionType,
			payload: {
				channel_id: channelId,
				content,
			} as ActionPayload["scheduled_message"],
			execute_at: executeAt,
		};

		await this.db.createAction(action);
	}

	async createMilestoneAction(
		guildId: string,
		milestone: number,
		channelId?: string,
	): Promise<void> {
		const action = {
			guild_id: guildId,
			type: "member_count_milestone" as ActionType,
			payload: {
				guild_id: guildId,
				milestone,
				channel_id: channelId,
			} as ActionPayload["member_count_milestone"],
		};

		await this.db.createAction(action);
	}

	async createGlobalBanAction(
		userId: string,
		guildIds: string[],
		reason?: string,
	): Promise<void> {
		const action = {
			guild_id: guildIds[0], // Use first guild as primary
			type: "global_ban_update" as ActionType,
			payload: {
				user_id: userId,
				guild_ids: guildIds,
				reason,
			} as ActionPayload["global_ban_update"],
		};

		await this.db.createAction(action);
	}

	// Start periodic action processing
	startActionProcessor(intervalMs = 30000): void {
		setInterval(async () => {
			await this.processPendingActions();
		}, intervalMs);

		console.log(`🔹 Started action processor with ${intervalMs}ms interval`);
	}
}
