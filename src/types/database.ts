import type { APIEmbed } from "discord.js";

// User tracking
export interface User {
	id?: number;
	bot: boolean;
	discordId: string;
	guildId: string;
	username: string;
	displayName: string;
	nickname?: string; // Server-specific nickname (null if no nickname set)
	discriminator: string;
	avatar?: string; // Current avatar
	status?: string; // Current text status
	roles: string[]; // Role IDs
	joinedAt: Date;
	lastSeen: Date;
	avatarHistory: AvatarHistory[]; // Previous avatars
	usernameHistory: string[]; // Track username changes
	displayNameHistory: string[]; // Track display name changes
	nicknameHistory: string[]; // Track nickname changes
	statusHistory: UserStatus[]; // Track text status changes

	// metadata
	emoji?: string;
	title?: string;
	summary?: string;
	keywords?: string[];
	notes?: string[];
	relationships: Relationship[];

	// moderation preferences
	modPreferences: ModPreferences;

	// NEW: Voice interaction history
	voiceInteractions: VoiceInteraction[];

	createdAt: Date;
	updatedAt: Date;
}

// Voice interaction tracking
export interface VoiceInteraction {
	channelId: string;
	channelName: string;
	guildId: string;
	joinedAt: Date;
	leftAt?: Date;
	duration?: number; // seconds
}

// Moderation preferences for each user (channel-agnostic)
export interface ModPreferences {
	preferredChannelName?: string; // User's preferred channel name
	preferredUserLimit?: number; // User's preferred user limit
	preferredLocked?: boolean; // User's preferred channel lock state
	preferredHidden?: boolean; // User's preferred channel hidden state
	bannedUsers: string[]; // Users this owner has banned
	mutedUsers: string[]; // Users this owner has muted
	kickedUsers: string[]; // Users this owner has kicked
	deafenedUsers: string[]; // Users this owner has deafened
	renamedUsers: RenamedUser[]; // Users this owner has renamed

	// NEW: Moderation action history
	modHistory: ModHistoryEntry[];

	lastUpdated: Date;
}

// Moderation history entry
export interface ModHistoryEntry {
	action: string; // mute, unmute, ban, unban, kick, deafen, undeafen, rename, etc.
	targetUserId: string;
	channelId: string;
	reason?: string;
	timestamp: Date;
}

// Renamed user tracking (channel-agnostic)
export interface RenamedUser {
	userId: string; // The user being renamed
	originalNickname: string | null; // Their original server nickname (null if they had no nickname)
	scopedNickname: string; // The nickname set by the channel owner
	renamedAt: Date; // When the rename was applied
}

// Avatar history tracking
export interface AvatarHistory {
	avatarUrl: string;
	avatarHash?: string; // Discord avatar hash for comparison
	imageData?: string; // Base64 encoded image data
	contentType?: string; // MIME type (image/png, image/jpeg, etc.)
	fileSize?: number; // File size in bytes
	firstSeen: Date;
	lastSeen: Date;
}

// User status tracking (text status only)
export interface UserStatus {
	status: string; // The text status content
	firstSeen: Date;
	lastSeen: Date;
}

// Role tracking
export interface Role {
	id?: number;
	discordId: string;
	name: string;
	color: number;
	mentionable: boolean;
	guildId: string;
	createdAt: Date;
	updatedAt: Date;
}

// Message tracking
export interface Message {
	id?: number;
	discordId: string;
	content: string;
	authorId: string;
	channelId: string;
	guildId: string;
	timestamp: Date;
	editedAt?: Date;
	deletedAt?: Date;
	mentions: string[]; // User IDs mentioned
	reactions: Reaction[];
	replyTo?: string; // Message ID this is replying to
	attachments: Attachment[];
	embeds: APIEmbed[]; // Discord embed objects
	createdAt: Date;
	updatedAt: Date;
}

// Reaction tracking
export interface Reaction {
	emoji: string;
	count: number;
	users: string[]; // User IDs who reacted
}

// Attachment tracking
export interface Attachment {
	id: string;
	filename: string;
	size: number;
	url: string;
	contentType?: string;
}

// ==================== RELATIONSHIP SYSTEM ====================

// Simple relationship between two users
export interface Relationship {
	id?: number;
	userId1: string;
	userId2: string;
	guildId: string;

	// Metadata
	emoji?: string;
	title?: string;
	summary?: string;
	keywords?: string[];
	notes?: string[];

	// Basic metrics
	totalInteractions: number;
	totalWeight: number;

	// Interaction counts
	mentions: number;
	replies: number;
	reactions: number;
	voiceTime: number; // minutes

	// Store interactions directly
	interactions: InteractionRecord[];

	// Simple scores
	strength: "weak" | "moderate" | "strong";
	lastInteraction: Date;

	createdAt: Date;
	updatedAt: Date;
}

// Simple interaction types
export type InteractionType = "mention" | "reply" | "reaction" | "voice";

// Basic interaction record
export interface InteractionRecord {
	id?: number;
	fromUserId: string;
	toUserId: string;
	interactionType: InteractionType;
	timestamp: Date;
	weight: number;
	messageId?: string; // Reference to original message
	channelId?: string; // Channel where interaction occurred
	createdAt: Date;
	updatedAt: Date;
}

// Guild sync status
export interface GuildSync {
	id?: number;
	guildId: string;
	lastSyncAt: Date;
	lastMessageId?: string; // Last message processed
	totalUsers: number;
	totalMessages: number;
	totalRoles: number;
	isFullySynced: boolean;
	createdAt: Date;
	updatedAt: Date;
}

// Channel tracking
export interface Channel {
	id?: number;
	discordId: string;
	guildId: string;
	channelName: string;
	position: number; // Channel position in the guild's channel list
	isActive: boolean;
	activeUserIds?: string[]; // Array of user Discord IDs currently in the channel (optional for upserts)
	memberCount?: number; // Denormalized count for quick queries (optional for upserts)
	status?: string; // Discord channel status/topic (voice channel description)
	lastStatusChange?: Date; // Timestamp of the last status change
	createdAt: Date;
	updatedAt: Date;
}

// Voice channel session tracking
export interface VoiceChannelSession {
	id?: number;
	userId: string;
	guildId: string;
	channelId: string;
	channelName: string;
	joinedAt: Date;
	leftAt?: Date; // null if user is still in the channel
	duration?: number; // Duration in seconds (calculated when user leaves)
	isActive: boolean; // true if user is currently in the channel
	createdAt: Date;
	updatedAt: Date;
}

// Database tables interface (PostgreSQL)
export interface DatabaseTables {
	users: string;
	roles: string;
	messages: string;
	guildSyncs: string;
	relationships: string;
	interactionRecords: string;
	channels: string;
	voiceChannelSessions: string;
}
