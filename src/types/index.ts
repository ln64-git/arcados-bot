import type {
	ChatInputCommandInteraction,
	Client,
	EmbedBuilder,
	GuildMember,
	MessageReaction,
	PartialMessageReaction,
	SlashCommandBuilder,
} from "discord.js";

export interface Command {
	data: SlashCommandBuilder | unknown;
	execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface VoiceChannelOwner {
	userId: string;
	channelId: string;
	guildId: string;
	createdAt: Date;
	lastActivity: Date;
	previousOwnerId?: string; // Track the previous owner for claiming purposes
}

export interface ModerationLog {
	id: string;
	action:
		| "mute"
		| "unmute"
		| "deafen"
		| "undeafen"
		| "kick"
		| "ban"
		| "unban"
		| "rename"
		| "limit"
		| "lock"
		| "disconnect"
		| "revoke"
		| "coup";
	channelId: string;
	guildId: string;
	performerId: string;
	targetId?: string;
	reason?: string;
	timestamp: Date;
	metadata?: Record<string, unknown>;
}

export interface RateLimit {
	userId: string;
	action: string;
	count: number;
	windowStart: Date;
}

export interface VoiceChannelConfig {
	guildId: string;
	spawnChannelId: string;
	categoryId?: string;
	channelNameTemplate: string;
	maxChannels: number;
	channelLimit: number;
}

export interface UserModerationPreferences {
	userId: string;
	guildId: string;
	bannedUsers: string[]; // Array of user IDs that this user has banned
	mutedUsers: string[]; // Array of user IDs that this user has muted
	kickedUsers: string[]; // Array of user IDs that this user has kicked
	deafenedUsers: string[]; // Array of user IDs that this user has deafened
	preferredChannelName?: string; // User's preferred channel name
	preferredUserLimit?: number; // User's preferred user limit
	preferredLocked?: boolean; // User's preferred channel lock state (true = locked, false = unlocked)
	renamedUsers: RenamedUser[]; // Array of users this owner has renamed in their channel
	lastUpdated: Date;
}

export interface RenamedUser {
	userId: string; // The user being renamed
	originalNickname: string | null; // Their original server nickname (null if they had no nickname)
	scopedNickname: string; // The nickname set by the channel owner
	channelId: string; // The channel where this rename is active
	renamedAt: Date; // When the rename was applied
}

export interface UserRoleData {
	userId: string;
	guildId: string;
	roleIds: string[];
	storedAt: Date;
	lastUpdated: Date;
}

export interface StarboardEntry {
	originalMessageId: string;
	originalChannelId: string;
	starboardMessageId: string;
	starboardChannelId: string;
	guildId: string;
	starCount: number;
	createdAt: Date;
	lastUpdated: Date;
}

export interface CoupVote {
	channelId: string;
	voterId: string;
	targetUserId: string;
	timestamp: Date;
}

export interface CoupSession {
	channelId: string;
	targetUserId: string;
	votes: CoupVote[];
	startedAt: Date;
	expiresAt: Date;
}

export interface CallState {
	channelId: string;
	currentOwner: string;
	mutedUsers: string[]; // Users currently muted in this call
	deafenedUsers: string[]; // Users currently deafened in this call
	kickedUsers: string[]; // Users kicked from this call (temporary)
	lastUpdated: Date;
}

export interface VoiceManager {
	isChannelOwner(channelId: string, userId: string): Promise<boolean>;
	isPreviousChannelOwner(channelId: string, userId: string): Promise<boolean>;
	checkRateLimit(
		userId: string,
		action: string,
		limit?: number,
		windowMs?: number,
	): Promise<boolean>;
	logModerationAction(
		log: Omit<ModerationLog, "id" | "timestamp">,
	): Promise<void>;
	getModerationLogs(
		channelId: string,
		limit?: number,
	): Promise<ModerationLog[]>;
	revokeChannelOwnership(channelId: string): Promise<boolean>;
	getChannelOwner(channelId: string): Promise<VoiceChannelOwner | null>;
	setChannelOwner(
		channelId: string,
		userId: string,
		guildId: string,
	): Promise<void>;
	removeChannelOwner(channelId: string): Promise<void>;
	getGuildConfig(guildId: string): Promise<VoiceChannelConfig>;

	// User preference methods
	getUserPreferences(
		userId: string,
		guildId: string,
	): Promise<UserModerationPreferences | null>;
	updateUserPreferences(preferences: UserModerationPreferences): Promise<void>;
	applyUserPreferencesToChannel(
		channelId: string,
		ownerId: string,
	): Promise<void>;

	// Call state methods
	getCallState(channelId: string): Promise<CallState | null>;
	updateCallState(state: CallState): Promise<void>;
	applyPreferencesToNewJoiner(channelId: string, userId: string): Promise<void>;

	// Coup system methods
	startCoupVote(channelId: string, targetUserId: string): Promise<boolean>;
	voteCoup(
		channelId: string,
		voterId: string,
		targetUserId: string,
	): Promise<boolean>;
	getCoupSession(channelId: string): Promise<CoupSession | null>;
	executeCoup(channelId: string): Promise<boolean>;

	// Centralized validation methods
	validateChannelOwnership(
		channelId: string,
		userId: string,
	): Promise<{ isValid: boolean; error?: string }>;
	validateUserInChannel(
		channelId: string,
		userId: string,
	): Promise<{ isValid: boolean; error?: string }>;
	validateRateLimit(
		userId: string,
		action: string,
		maxActions: number,
		timeWindow: number,
	): Promise<{ isValid: boolean; error?: string }>;

	// Centralized moderation action methods
	performMuteAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		action: "mute" | "unmute",
		reason: string,
	): Promise<{ success: boolean; error?: string }>;
	performBanAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		action: "ban" | "unban",
		reason: string,
	): Promise<{ success: boolean; error?: string }>;
	performDeafenAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		action: "deafen" | "undeafen",
		reason: string,
	): Promise<{ success: boolean; error?: string }>;
	performKickAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		reason: string,
	): Promise<{ success: boolean; error?: string }>;
	performDisconnectAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		reason: string,
	): Promise<{ success: boolean; error?: string }>;

	// Centralized command validation helper
	validateCommandExecution(
		channelId: string,
		userId: string,
		action: string,
		maxActions: number,
		timeWindow: number,
	): Promise<{ isValid: boolean; error?: string }>;

	// Centralized response helpers
	createErrorEmbed(title: string, description: string): EmbedBuilder;
	createSuccessEmbed(
		title: string,
		description: string,
		color?: number,
	): EmbedBuilder;

	// Helper methods for user preferences
	updateUserModerationPreference(
		userId: string,
		guildId: string,
		preferenceType: keyof Pick<
			UserModerationPreferences,
			"bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers"
		>,
		targetUserId: string,
		add: boolean,
	): Promise<void>;
	updateCallStateModeration(
		channelId: string,
		stateType: keyof Pick<
			CallState,
			"mutedUsers" | "deafenedUsers" | "kickedUsers"
		>,
		userId: string,
		add: boolean,
	): Promise<void>;

	// User nickname management methods
	renameUser(
		channelId: string,
		targetUserId: string,
		performerId: string,
		newNickname: string,
	): Promise<boolean>;
	resetUserNickname(
		channelId: string,
		targetUserId: string,
		performerId: string,
	): Promise<boolean>;
	resetAllNicknames(channelId: string, performerId: string): Promise<boolean>;
	restoreUserNickname(userId: string, guildId: string): Promise<boolean>;
	applyNicknamesToNewJoiner(channelId: string, userId: string): Promise<void>;
	getRenamedUsers(channelId: string): Promise<RenamedUser[]>;
}

export interface UserManager {
	// Role restoration methods
	storeUserRoles(member: GuildMember): Promise<void>;
	restoreUserRoles(member: GuildMember): Promise<void>;
	getStoredUserRoles(
		userId: string,
		guildId: string,
	): Promise<UserRoleData | null>;
	clearStoredUserRoles(userId: string, guildId: string): Promise<void>;
	getUsersWithStoredRoles(guildId: string): Promise<UserRoleData[]>;
	hasStoredRoles(userId: string, guildId: string): Promise<boolean>;
	getStoredRoleCount(userId: string, guildId: string): Promise<number>;
}

export interface StarboardManager {
	// Starboard methods
	handleReactionAdd(
		reaction: MessageReaction | PartialMessageReaction,
	): Promise<void>;
	handleReactionRemove(
		reaction: MessageReaction | PartialMessageReaction,
	): Promise<void>;
	getStarboardEntries(guildId: string): Promise<StarboardEntry[]>;
	getStarboardStats(guildId: string): Promise<{
		totalEntries: number;
		totalStars: number;
		mostStarredMessage: StarboardEntry | null;
	}>;
}

export type ClientWithVoiceManager = Client & {
	voiceManager?: VoiceManager;
	userManager?: UserManager;
	starboardManager?: StarboardManager;
};

// Type guard for GuildMember
export function isGuildMember(
	member: unknown,
): member is { voice?: { channel?: unknown } } {
	return Boolean(member && typeof member === "object" && "voice" in member);
}
