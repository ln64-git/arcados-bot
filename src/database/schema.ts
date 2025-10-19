import type {
	Channel,
	Guild,
	GuildMember,
	Message,
	Role,
	VoiceState,
} from "discord.js";

// SurrealDB Table Definitions
export const SURREAL_SCHEMA = {
	guilds: `
		DEFINE TABLE guilds SCHEMAFULL {
			id: string,
			name: string,
			member_count: number,
			owner_id: string,
			icon: string?,
			features: array<string>,
			created_at: datetime,
			updated_at: datetime,
			active: bool DEFAULT true,
			settings: object DEFAULT {}
		};
	`,
	channels: `
		DEFINE TABLE channels SCHEMAFULL {
			id: string,
			guild_id: string,
			name: string,
			type: string,
			position: number,
			parent_id: string?,
			topic: string?,
			nsfw: bool DEFAULT false,
			created_at: datetime,
			updated_at: datetime,
			active: bool DEFAULT true
		};
	`,
	members: `
		DEFINE TABLE members SCHEMAFULL {
			id: string,
			guild_id: string,
			user_id: string,
			
			-- Current profile state (all Discord user properties)
			username: string,
			display_name: string,
			global_name: string?,
			avatar: string?,
			avatar_decoration: string?,
			banner: string?,
			accent_color: number?,
			discriminator: string,
			flags: number?,
			premium_type: number?,
			public_flags: number?,
			
			-- Guild-specific data
			nickname: string?,
			joined_at: datetime,
			roles: array<string>,
			
			-- Change tracking
			profile_hash: string,
			profile_history: array<object> DEFAULT [],
			
			created_at: datetime,
			updated_at: datetime,
			active: bool DEFAULT true
		};
		DEFINE INDEX idx_members_user ON members FIELDS user_id, guild_id;
		DEFINE INDEX idx_members_hash ON members FIELDS profile_hash;
	`,
	roles: `
		DEFINE TABLE roles SCHEMAFULL {
			id: string,
			guild_id: string,
			name: string,
			color: number,
			position: number,
			permissions: string,
			mentionable: bool DEFAULT false,
			hoist: bool DEFAULT false,
			created_at: datetime,
			updated_at: datetime,
			active: bool DEFAULT true
		};
	`,
	messages: `
		DEFINE TABLE messages SCHEMAFULL {
			id: string,
			channel_id: string,
			guild_id: string,
			author_id: string,
			content: string,
			timestamp: datetime,
			attachments: array<object> DEFAULT [],
			embeds: array<object> DEFAULT [],
			created_at: datetime,
			updated_at: datetime,
			active: bool DEFAULT true
		};
	`,
	// Actions table for scheduled/deferred Discord actions
	actions: `
		DEFINE TABLE actions SCHEMAFULL {
			id: string,
			guild_id: string,
			type: string,
			payload: object,
			execute_at: datetime?,
			executed: bool DEFAULT false,
			created_at: datetime,
			updated_at: datetime,
			active: bool DEFAULT true
		};
	`,
	// Sync metadata for tracking sync state
	sync_metadata: `
		DEFINE TABLE sync_metadata SCHEMAFULL {
			id: string,
			guild_id: string,
			entity_type: string,
			last_full_sync: datetime?,
			last_check: datetime,
			entity_count: number DEFAULT 0,
			status: string DEFAULT 'healthy',
			created_at: datetime,
			updated_at: datetime
		};
		DEFINE INDEX idx_sync_guild_type ON sync_metadata FIELDS guild_id, entity_type;
	`,
	// Voice state tracking tables
	voice_states: `
		DEFINE TABLE voice_states SCHEMAFULL {
			id: string,
			guild_id: string,
			user_id: string,
			channel_id: string?,
			
			-- Voice state flags
			self_mute: bool DEFAULT false,
			self_deaf: bool DEFAULT false,
			server_mute: bool DEFAULT false,
			server_deaf: bool DEFAULT false,
			streaming: bool DEFAULT false,
			self_video: bool DEFAULT false,
			suppress: bool DEFAULT false,
			
			-- Session tracking
			session_id: string?,
			joined_at: datetime?,
			
			created_at: datetime,
			updated_at: datetime
		};
		DEFINE INDEX idx_voice_guild ON voice_states FIELDS guild_id;
		DEFINE INDEX idx_voice_channel ON voice_states FIELDS channel_id;
	`,
	voice_history: `
		DEFINE TABLE voice_history SCHEMAFULL {
			id: string,
			guild_id: string,
			user_id: string,
			channel_id: string?,
			
			-- Event details
			event_type: string,
			from_channel_id: string?,
			to_channel_id: string?,
			
			-- State snapshot at time of event
			self_mute: bool,
			self_deaf: bool,
			server_mute: bool,
			server_deaf: bool,
			streaming: bool,
			self_video: bool,
			
			-- Session tracking
			session_id: string?,
			session_duration: int?,
			
			timestamp: datetime,
			created_at: datetime
		};
		DEFINE INDEX idx_voice_history_user ON voice_history FIELDS user_id, timestamp;
		DEFINE INDEX idx_voice_history_guild ON voice_history FIELDS guild_id, timestamp;
		DEFINE INDEX idx_voice_history_session ON voice_history FIELDS session_id;
	`,
	voice_sessions: `
		DEFINE TABLE voice_sessions SCHEMAFULL {
			id: string,
			guild_id: string,
			user_id: string,
			channel_id: string,
			
			-- Session metadata
			joined_at: datetime,
			left_at: datetime?,
			duration: int DEFAULT 0,
			
			-- Activity tracking
			channels_visited: array<string> DEFAULT [],
			switch_count: int DEFAULT 0,
			
			-- State tracking
			time_muted: int DEFAULT 0,
			time_deafened: int DEFAULT 0,
			time_streaming: int DEFAULT 0,
			
			active: bool DEFAULT true,
			created_at: datetime,
			updated_at: datetime
		};
		DEFINE INDEX idx_voice_sessions_user ON voice_sessions FIELDS user_id, joined_at;
		DEFINE INDEX idx_voice_sessions_guild ON voice_sessions FIELDS guild_id, joined_at;
	`,
};

// TypeScript Interfaces
export interface SurrealGuild {
	id: string;
	name: string;
	member_count: number;
	owner_id: string;
	icon?: string;
	features: string[];
	created_at: Date;
	updated_at: Date;
	active: boolean;
	settings: Record<string, unknown>;
}

export interface SurrealChannel {
	id: string;
	guild_id: string;
	name: string;
	type: string;
	position: number;
	parent_id?: string;
	topic?: string;
	nsfw: boolean;
	created_at: Date;
	updated_at: Date;
	active: boolean;
}

export interface ProfileHistoryEntry {
	changed_fields: Record<string, { old: unknown; new: unknown }>;
	profile_hash: string;
	changed_at: Date;
}

export interface SurrealMember {
	id: string;
	guild_id: string;
	user_id: string;

	// Current profile state
	username: string;
	display_name: string;
	global_name?: string;
	avatar?: string;
	avatar_decoration?: string;
	banner?: string;
	accent_color?: number;
	discriminator: string;
	flags?: number;
	premium_type?: number;
	public_flags?: number;

	// Guild-specific data
	nickname?: string;
	joined_at: Date;
	roles: string[];

	// Change tracking
	profile_hash: string;
	profile_history: ProfileHistoryEntry[];

	created_at: Date;
	updated_at: Date;
	active: boolean;
	[key: string]: unknown;
}

export interface SurrealRole {
	id: string;
	guild_id: string;
	name: string;
	color: number;
	position: number;
	permissions: string;
	mentionable: boolean;
	hoist: boolean;
	created_at: Date;
	updated_at: Date;
	active: boolean;
}

export interface SurrealMessage {
	id: string;
	channel_id: string;
	guild_id: string;
	author_id: string;
	content: string;
	timestamp: Date;
	attachments: AttachmentData[];
	embeds: EmbedData[];
	created_at: Date;
	updated_at: Date;
	active: boolean;
}

export interface AttachmentData {
	id: string;
	name: string;
	url: string;
	size: number;
}

export interface EmbedData {
	title?: string;
	description?: string;
	color?: number;
	fields?: Array<{ name: string; value: string; inline?: boolean }>;
	footer?: { text: string; icon_url?: string };
	image?: { url: string };
	thumbnail?: { url: string };
}

export interface SurrealAction {
	id: string;
	guild_id: string;
	type: string;
	payload: Record<string, unknown>;
	execute_at?: Date;
	executed: boolean;
	created_at: Date;
	updated_at: Date;
	active: boolean;
}

export interface SyncMetadata {
	id: string;
	guild_id: string;
	entity_type: "guild" | "channel" | "role" | "member" | "message";
	last_full_sync?: Date;
	last_check: Date;
	entity_count: number;
	status: "healthy" | "needs_healing" | "syncing";
	created_at: Date;
	updated_at: Date;
	[key: string]: unknown;
}

export interface SurrealVoiceState {
	id: string;
	guild_id: string;
	user_id: string;
	channel_id: string | null;
	self_mute: boolean;
	self_deaf: boolean;
	server_mute: boolean;
	server_deaf: boolean;
	streaming: boolean;
	self_video: boolean;
	suppress: boolean;
	session_id: string | null;
	joined_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

export interface SurrealVoiceHistory {
	id: string;
	guild_id: string;
	user_id: string;
	channel_id: string | null;
	event_type: "join" | "leave" | "switch" | "state_change";
	from_channel_id: string | null;
	to_channel_id: string | null;
	self_mute: boolean;
	self_deaf: boolean;
	server_mute: boolean;
	server_deaf: boolean;
	streaming: boolean;
	self_video: boolean;
	session_id: string | null;
	session_duration: number | null;
	timestamp: Date;
	created_at: Date;
}

export interface SurrealVoiceSession {
	id: string;
	guild_id: string;
	user_id: string;
	channel_id: string;
	joined_at: Date;
	left_at: Date | null;
	duration: number;
	channels_visited: string[];
	switch_count: number;
	time_muted: number;
	time_deafened: number;
	time_streaming: number;
	active: boolean;
	created_at: Date;
	updated_at: Date;
}

// Live Query callback types
export type LiveQueryCallback<T = Record<string, unknown>> = (
	action: "CREATE" | "UPDATE" | "DELETE" | "CLOSE",
	data: T,
) => void;

// Database operation result types
export interface DatabaseResult<T> {
	success: boolean;
	data?: T;
	error?: string;
}

// Action types for database-triggered Discord actions
export type ActionType =
	| "member_role_update"
	| "member_ban"
	| "scheduled_message"
	| "member_count_milestone"
	| "user_xp_threshold"
	| "global_ban_update"
	| "custom_action";

export interface ActionPayload {
	member_role_update?: {
		guild_id: string;
		user_id: string;
		role_ids: string[];
	};
	member_ban?: {
		guild_id: string;
		user_id: string;
		reason?: string;
	};
	scheduled_message?: {
		channel_id: string;
		content: string;
		embeds?: EmbedData[];
	};
	member_count_milestone?: {
		guild_id: string;
		milestone: number;
		channel_id?: string;
	};
	user_xp_threshold?: {
		guild_id: string;
		user_id: string;
		role_id: string;
		threshold: number;
	};
	global_ban_update?: {
		user_id: string;
		guild_ids: string[];
		reason?: string;
	};
	custom_action?: Record<string, unknown>;
}

// Utility functions for converting Discord objects to SurrealDB format
export function discordGuildToSurreal(guild: Guild): Partial<SurrealGuild> {
	return {
		id: guild.id,
		name: guild.name,
		member_count: guild.memberCount,
		owner_id: guild.ownerId || "",
		icon: guild.iconURL() || undefined,
		features: guild.features,
		created_at: guild.createdAt,
		updated_at: new Date(),
		active: true,
		settings: {} as Record<string, unknown>,
	};
}

export function discordChannelToSurreal(
	channel: Channel,
	guildId: string,
): Partial<SurrealChannel> {
	// Type guard to check if channel has name property
	const hasName = "name" in channel && channel.name !== null;
	const hasPosition = "position" in channel;
	const hasParentId = "parentId" in channel;
	const hasTopic = "topic" in channel;
	const hasNsfw = "nsfw" in channel;

	return {
		id: channel.id,
		guild_id: guildId,
		name: hasName ? channel.name || "" : "",
		type: channel.type.toString(),
		position: hasPosition ? channel.position : 0,
		parent_id: hasParentId ? channel.parentId || undefined : undefined,
		topic: hasTopic ? channel.topic || undefined : undefined,
		nsfw: hasNsfw ? channel.nsfw : false,
		created_at: new Date(),
		updated_at: new Date(),
		active: true,
	};
}

export function discordMemberToSurreal(
	member: GuildMember,
): Partial<SurrealMember> {
	const user = member.user;

	// Create profile object for hashing (excludes roles and timestamps)
	const profileData = {
		username: user.username,
		display_name: member.displayName,
		global_name: user.globalName,
		avatar: user.avatar,
		avatar_decoration: user.avatarDecoration,
		banner: user.banner,
		accent_color: user.accentColor,
		discriminator: user.discriminator,
		flags: user.flags?.bitfield,
		premium_type:
			"premiumType" in user
				? (user.premiumType as number | undefined)
				: undefined,
		public_flags:
			"publicFlags" in user
				? (user.publicFlags as { bitfield: number } | undefined)?.bitfield
				: undefined,
		nickname: member.nickname,
	};

	// Generate hash of profile data
	const profile_hash = generateProfileHash(profileData);

	return {
		id: `${member.guild.id}:${member.id}`,
		guild_id: member.guild.id,
		user_id: member.id,

		// Current profile state
		username: user.username,
		display_name: member.displayName,
		global_name: user.globalName || undefined,
		avatar: user.avatar || undefined,
		avatar_decoration: user.avatarDecoration || undefined,
		banner: user.banner || undefined,
		accent_color: user.accentColor || undefined,
		discriminator: user.discriminator,
		flags: user.flags?.bitfield,
		premium_type:
			"premiumType" in user
				? (user.premiumType as number | undefined)
				: undefined,
		public_flags:
			"publicFlags" in user
				? (user.publicFlags as { bitfield: number } | undefined)?.bitfield
				: undefined,

		// Guild-specific data
		nickname: member.nickname || undefined,
		joined_at: member.joinedAt || new Date(),
		roles: member.roles.cache.map((role) => role.id),

		// Change tracking
		profile_hash,
		profile_history: [], // Will be populated when comparing with existing data

		created_at: new Date(),
		updated_at: new Date(),
		active: true,
	};
}

// Helper function to generate a hash of profile data
export function generateProfileHash(data: Record<string, unknown>): string {
	// Simple hash function - stringify and create hash
	const jsonStr = JSON.stringify(data, Object.keys(data).sort());
	let hash = 0;
	for (let i = 0; i < jsonStr.length; i++) {
		const char = jsonStr.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash.toString(36);
}

export function discordRoleToSurreal(role: Role): Partial<SurrealRole> {
	return {
		id: role.id,
		guild_id: role.guild.id,
		name: role.name,
		color: role.color,
		position: role.position,
		permissions: role.permissions.bitfield.toString(),
		mentionable: role.mentionable,
		hoist: role.hoist,
		created_at: new Date(),
		updated_at: new Date(),
		active: true,
	};
}

export function discordMessageToSurreal(
	message: Message,
	guildId?: string,
): Partial<SurrealMessage> {
	return {
		id: message.id,
		channel_id: message.channelId,
		guild_id: guildId || message.guildId || "",
		author_id: message.author.id,
		content: message.content,
		timestamp: message.createdAt,
		attachments: message.attachments.map((att) => ({
			id: att.id,
			name: att.name,
			url: att.url,
			size: att.size,
		})),
		embeds: message.embeds.map((embed) => ({
			title: embed.title || undefined,
			description: embed.description || undefined,
			color: embed.color || undefined,
			fields: embed.fields,
			footer: embed.footer
				? { text: embed.footer.text, icon_url: embed.footer.iconURL }
				: undefined,
			image: embed.image ? { url: embed.image.url } : undefined,
			thumbnail: embed.thumbnail ? { url: embed.thumbnail.url } : undefined,
		})),
		created_at: new Date(),
		updated_at: new Date(),
		active: true,
	};
}

export function discordVoiceStateToSurreal(
	voiceState: VoiceState,
): Partial<SurrealVoiceState> {
	return {
		id: `${voiceState.guild.id}_${voiceState.member?.id}`, // Use underscore instead of colon
		guild_id: voiceState.guild.id,
		user_id: voiceState.member?.id || "",
		channel_id: voiceState.channelId,
		self_mute: voiceState.selfMute || false,
		self_deaf: voiceState.selfDeaf || false,
		server_mute: voiceState.mute || false,
		server_deaf: voiceState.deaf || false,
		streaming: voiceState.streaming || false,
		self_video: voiceState.selfVideo || false,
		suppress: voiceState.suppress || false,
		session_id: voiceState.sessionId,
		joined_at: voiceState.channelId ? new Date() : null,
		created_at: new Date(),
		updated_at: new Date(),
	};
}
