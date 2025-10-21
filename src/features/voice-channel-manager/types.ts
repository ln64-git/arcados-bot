// Voice Channel Manager specific types
export interface VoiceChannelConfig {
	spawnChannelId: string;
	maxChannelsPerGuild?: number;
	autoDeleteAfterEmptyMinutes?: number;
}

export interface ChannelSpawnResult {
	success: boolean;
	channel?: import("discord.js").VoiceChannel;
	error?: string;
}

export interface OwnershipTransferResult {
	success: boolean;
	newOwnerId?: string;
	error?: string;
}

export interface ModerationResult {
	success: boolean;
	applied?: boolean;
	error?: string;
}
