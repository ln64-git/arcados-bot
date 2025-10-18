// Discord Sync Types
export interface SyncEvent {
	type: "guild" | "channel" | "member" | "role" | "message";
	action: "create" | "update" | "delete";
	data: Record<string, unknown>;
	timestamp: Date;
}

export interface SyncStatus {
	isConnected: boolean;
	isSyncing: boolean;
	lastSyncTime?: Date;
	errorCount: number;
	lastError?: string;
}

export interface SyncConfig {
	enableMessageSync: boolean;
	enableRealTimeSync: boolean;
	syncInterval: number; // milliseconds
	maxRetries: number;
	retryDelay: number; // milliseconds
}

// Live Query subscription types
export interface LiveQuerySubscription {
	id: string;
	table: string;
	callback: (
		action: "CREATE" | "UPDATE" | "DELETE",
		data: Record<string, unknown>,
	) => void;
	active: boolean;
	createdAt: Date;
}

// Action execution context
export interface ActionExecutionContext {
	guildId: string;
	userId?: string;
	channelId?: string;
	metadata?: Record<string, unknown>;
}

// Database health status
export interface DatabaseHealth {
	connected: boolean;
	lastHealthCheck: Date;
	reconnectAttempts: number;
	liveQueryCount: number;
	errorRate: number;
}

// Sync statistics
export interface SyncStats {
	totalGuilds: number;
	totalChannels: number;
	totalMembers: number;
	totalRoles: number;
	totalMessages: number;
	lastSyncDuration: number; // milliseconds
	averageSyncTime: number; // milliseconds
	syncErrors: number;
	successfulSyncs: number;
}
