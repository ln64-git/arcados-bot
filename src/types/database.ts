import type { APIEmbed } from "discord.js";
import type { Collection, ObjectId } from "mongodb";

// User tracking
export interface User {
	_id?: ObjectId;
	bot: boolean;
	discordId: string;
	username: string;
	displayName: string;
	discriminator: string;
	avatar?: string; // Current avatar
	status?: string; // Current text status
	roles: string[]; // Role IDs
	joinedAt: Date;
	lastSeen: Date;
	avatarHistory: AvatarHistory[]; // Previous avatars
	usernameHistory: string[]; // Track username changes
	displayNameHistory: string[]; // Track display name changes
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

	createdAt: Date;
	updatedAt: Date;
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
	lastUpdated: Date;
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
	_id?: ObjectId;
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
	_id?: ObjectId;
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

// Voice channel tracking
export interface VoiceSession {
	_id?: ObjectId;
	userId: string;
	guildId: string;
	channelId: string;
	channelName: string;
	joinedAt: Date;
	leftAt?: Date;
	duration?: number; // in seconds
	createdAt: Date;
	updatedAt: Date;
}

// ==================== RELATIONSHIP SYSTEM ====================

// Simple relationship between two users
export interface Relationship {
	_id?: ObjectId;
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
	_id?: ObjectId;
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
	_id?: ObjectId;
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

// Database collections interface
export interface DatabaseCollections {
	users: Collection<User>;
	roles: Collection<Role>;
	messages: Collection<Message>;
	voiceSessions: Collection<VoiceSession>;
	guildSyncs: Collection<GuildSync>;
}
