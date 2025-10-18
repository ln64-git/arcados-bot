import type { GuildMember } from "discord.js";
import type { ProfileHistoryEntry, SurrealMember } from "../../database/schema";
import { generateProfileHash } from "../../database/schema";

export class UserHistoryTracker {
	/**
	 * Compare current member profile with database member and track changes
	 * Returns the profile history entry if there were changes, null otherwise
	 */
	compareAndTrack(
		currentMember: GuildMember,
		dbMember: SurrealMember,
	): ProfileHistoryEntry | null {
		const user = currentMember.user;

		// Create current profile snapshot (excludes roles and timestamps)
		const currentProfile = {
			username: user.username,
			display_name: currentMember.displayName,
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
			nickname: currentMember.nickname,
		};

		const currentHash = generateProfileHash(currentProfile);

		// If hashes match, no changes detected
		if (currentHash === dbMember.profile_hash) {
			return null;
		}

		// Detect what changed
		const changedFields: Record<string, { old: unknown; new: unknown }> = {};

		// Compare each field
		if (currentProfile.username !== dbMember.username) {
			changedFields.username = {
				old: dbMember.username,
				new: currentProfile.username,
			};
		}

		if (currentProfile.display_name !== dbMember.display_name) {
			changedFields.display_name = {
				old: dbMember.display_name,
				new: currentProfile.display_name,
			};
		}

		if (currentProfile.global_name !== dbMember.global_name) {
			changedFields.global_name = {
				old: dbMember.global_name,
				new: currentProfile.global_name,
			};
		}

		if (currentProfile.avatar !== dbMember.avatar) {
			changedFields.avatar = {
				old: dbMember.avatar,
				new: currentProfile.avatar,
			};
		}

		if (currentProfile.avatar_decoration !== dbMember.avatar_decoration) {
			changedFields.avatar_decoration = {
				old: dbMember.avatar_decoration,
				new: currentProfile.avatar_decoration,
			};
		}

		if (currentProfile.banner !== dbMember.banner) {
			changedFields.banner = {
				old: dbMember.banner,
				new: currentProfile.banner,
			};
		}

		if (currentProfile.accent_color !== dbMember.accent_color) {
			changedFields.accent_color = {
				old: dbMember.accent_color,
				new: currentProfile.accent_color,
			};
		}

		if (currentProfile.discriminator !== dbMember.discriminator) {
			changedFields.discriminator = {
				old: dbMember.discriminator,
				new: currentProfile.discriminator,
			};
		}

		if (currentProfile.flags !== dbMember.flags) {
			changedFields.flags = {
				old: dbMember.flags,
				new: currentProfile.flags,
			};
		}

		if (currentProfile.premium_type !== dbMember.premium_type) {
			changedFields.premium_type = {
				old: dbMember.premium_type,
				new: currentProfile.premium_type,
			};
		}

		if (currentProfile.public_flags !== dbMember.public_flags) {
			changedFields.public_flags = {
				old: dbMember.public_flags,
				new: currentProfile.public_flags,
			};
		}

		if (currentProfile.nickname !== dbMember.nickname) {
			changedFields.nickname = {
				old: dbMember.nickname,
				new: currentProfile.nickname,
			};
		}

		// Create history entry with only changed fields
		const historyEntry: ProfileHistoryEntry = {
			changed_fields: changedFields,
			profile_hash: currentHash,
			changed_at: new Date(),
		};

		return historyEntry;
	}

	/**
	 * Get a summary of changes for logging
	 */
	getChangeSummary(historyEntry: ProfileHistoryEntry): string {
		const changes = Object.keys(historyEntry.changed_fields);
		if (changes.length === 0) return "No changes";

		const summary = changes
			.map((field) => {
				const change = historyEntry.changed_fields[field];
				if (!change) return null;
				return `${field}: "${change.old}" → "${change.new}"`;
			})
			.filter((s): s is string => s !== null)
			.join(", ");

		return `Changed ${changes.length} field(s): ${summary}`;
	}

	/**
	 * Create updated member data with history appended
	 */
	createUpdatedMember(
		currentMemberData: Partial<SurrealMember>,
		dbMember: SurrealMember,
		historyEntry: ProfileHistoryEntry,
	): Partial<SurrealMember> {
		// Append history entry to existing history
		const updatedHistory = [...(dbMember.profile_history || []), historyEntry];

		// Limit history to last 100 entries to prevent unbounded growth
		const trimmedHistory =
			updatedHistory.length > 100 ? updatedHistory.slice(-100) : updatedHistory;

		return {
			...currentMemberData,
			profile_history: trimmedHistory,
		};
	}
}
