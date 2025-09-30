import type {
	GuildMember,
	OverwriteData,
	PermissionResolvable,
	VoiceChannel,
} from "discord.js";

/**
 * Clones permission overwrites from a source channel to a target channel
 * @param sourceChannel The channel to copy permissions from
 * @param targetChannel The channel to apply permissions to
 * @param ownerId Optional owner ID to skip when copying permissions
 * @returns Promise<void>
 */
export async function clonePermissionOverwrites(
	sourceChannel: VoiceChannel,
	targetChannel: VoiceChannel,
	ownerId?: string,
): Promise<void> {
	try {
		const permissionOverwrites: OverwriteData[] = [];

		// Copy all permission overwrites from source channel
		for (const [id, overwrite] of sourceChannel.permissionOverwrites.cache) {
			// Skip the owner's permissions if provided (they'll be set separately)
			if (ownerId && id === ownerId) {
				continue;
			}

			permissionOverwrites.push({
				id,
				type: overwrite.type,
				allow: overwrite.allow.bitfield,
				deny: overwrite.deny.bitfield,
			});
		}

		// Apply all permission overwrites to the target channel
		if (permissionOverwrites.length > 0) {
			await targetChannel.permissionOverwrites.set(permissionOverwrites);
		}
	} catch (error) {
		console.error("🔸 Error cloning permission overwrites:", error);
		throw error;
	}
}

/**
 * Checks if a channel is fully locked (no one can connect)
 * @param channel The voice channel to check
 * @returns boolean indicating if the channel is fully locked
 */
export function isChannelFullyLocked(channel: VoiceChannel): boolean {
	try {
		const everyoneOverwrite = channel.permissionOverwrites.cache.get(
			channel.guild.roles.everyone.id,
		);
		if (!everyoneOverwrite) return false;

		// A channel is considered "locked" only if:
		// 1. Connect permission is denied for @everyone
		// 2. AND there are no other role/member overwrites that allow Connect
		const isConnectDenied = everyoneOverwrite.deny.has("Connect");
		if (!isConnectDenied) return false;

		// Check if any other role or member has Connect permission allowed
		for (const [id, overwrite] of channel.permissionOverwrites.cache) {
			if (id === channel.guild.roles.everyone.id) continue; // Skip @everyone, already checked

			// If any role/member has Connect allowed OR no explicit Connect permission (inherits access),
			// the channel is not fully locked
			if (overwrite.allow.has("Connect") || !overwrite.deny.has("Connect")) {
				return false;
			}
		}

		// If Connect is denied for @everyone and no other permissions allow it, channel is locked
		return true;
	} catch {
		return false;
	}
}

/**
 * Validates if a member has permission to perform an action on a channel
 * @param member The guild member
 * @param channel The voice channel
 * @param permission The permission to check (e.g., "Connect", "ManageChannels")
 * @returns boolean indicating if the member has the permission
 */
export function hasChannelPermission(
	member: GuildMember,
	channel: VoiceChannel,
	permission: PermissionResolvable,
): boolean {
	try {
		// Check if member has the permission through their roles or direct overwrites
		return member.permissionsIn(channel).has(permission);
	} catch {
		return false;
	}
}
