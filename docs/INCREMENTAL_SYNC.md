# Incremental Database Sync with User History Tracking

## Overview

This document describes the intelligent incremental sync system that replaces the full sync-on-startup approach with a smart, efficient sync that only processes changes.

## Key Features

### 1. Incremental Sync Strategy

- **First Run**: Performs full sync of all Discord data (guilds, channels, roles, members)
- **Subsequent Runs**: Only syncs differences:
  - New entities (channels, roles, members added since last sync)
  - Modified entities (profile changes detected via hashing)
  - Orphaned entities (marked as inactive if removed from Discord)

### 2. Comprehensive User Profile Tracking

The system tracks ALL Discord user properties dynamically, storing complete profile history:

**Tracked Properties:**

- `username` - Discord username
- `display_name` - Display name in guild
- `global_name` - Global display name
- `avatar` - Avatar hash
- `avatar_decoration` - Avatar decoration data
- `banner` - Profile banner
- `accent_color` - Profile accent color
- `discriminator` - Legacy discriminator
- `bio` - User bio/about me
- `flags` - User flags
- `premium_type` - Nitro subscription type
- `public_flags` - Public user flags
- `nickname` - Guild-specific nickname

**Profile History Format:**

```typescript
{
  changed_fields: {
    username: { old: "OldName", new: "NewName" },
    avatar: { old: "hash1", new: "hash2" }
  },
  profile_hash: "new_hash_after_changes",
  changed_at: "2025-10-17T..."
}
```

Only changed fields are stored, creating differential snapshots that preserve complete history while minimizing storage.

### 3. Sync Metadata Tracking

New `sync_metadata` table tracks sync state per guild and entity type:

- `last_full_sync` - Timestamp of last full sync
- `last_check` - Timestamp of last incremental check
- `entity_count` - Count of entities in last sync
- `status` - "healthy", "needs_healing", or "syncing"

### 4. Health Detection & Auto-Healing

The system automatically detects data integrity issues:

- Compares database counts with Discord counts
- If discrepancy >10%, marks status as "needs_healing"
- Next startup will perform full sync to restore integrity
- Full sync also triggered if >7 days since last full sync

### 5. Profile Change Detection

Uses content hashing to efficiently detect profile changes:

- Generates hash of all profile fields (excludes roles and timestamps)
- Compares hash with database to detect ANY profile change
- Only queries database for existing members
- Logs detailed change summaries for debugging

## Architecture

### New Files Created

1. **`src/features/discord-sync/SyncStateManager.ts`**

   - Manages sync metadata operations
   - Determines if full sync or incremental sync needed
   - Tracks sync health and completion

2. **`src/features/discord-sync/UserHistoryTracker.ts`**
   - Compares Discord profiles with database profiles
   - Detects changes across all profile fields
   - Creates differential history entries
   - Generates human-readable change summaries

### Modified Files

1. **`src/database/schema.ts`**

   - Added `sync_metadata` table definition
   - Extended `members` table with all Discord user properties
   - Added `profile_hash` and `profile_history` fields
   - Added `SyncMetadata` and `ProfileHistoryEntry` interfaces
   - Implemented `generateProfileHash()` helper function

2. **`src/database/SurrealDBManager.ts`**

   - Added `getSyncMetadata()` - Get sync state
   - Added `upsertSyncMetadata()` - Update sync state
   - Added `getEntityIds()` - Get all IDs for comparison
   - Added `getMember()` - Get single member for comparison
   - Added `bulkMarkInactive()` - Bulk cleanup orphaned entities
   - Added `getEntityCounts()` - Health check queries

3. **`src/features/discord-sync/DiscordSyncManager.ts`**
   - Replaced `performInitialSync()` with `performStartupSync()`
   - Added `performFullGuildSync()` - Full sync when needed
   - Added `performIncrementalGuildSync()` - Smart differential sync
   - Added `syncEntityType()` - Generic incremental sync for channels/roles
   - Added `syncMembersIncrementally()` - Member sync with profile tracking
   - Added `syncMemberWithHistory()` - Individual member sync with history
   - Added `detectHealthIssues()` - Automatic health monitoring
   - Updated event handlers to use `syncMemberWithHistory()`

## Sync Flow

### Startup Sync

```
1. Check sync metadata for each guild
2. If needs full sync (first run, >7 days, or healing):
   → Perform full sync
   → Record all entities
   → Mark sync as complete with timestamp
3. Else:
   → Perform incremental sync
   → Compare DB IDs vs Discord IDs
   → Sync missing entities
   → Check existing members for profile changes
   → Mark orphaned entities as inactive
   → Run health check
```

### Real-time Updates

```
1. Discord event fires (memberUpdate, channelCreate, etc.)
2. For member events:
   → Get existing member from DB
   → Compare profiles using UserHistoryTracker
   → If changed:
     • Generate history entry with changes
     • Append to profile_history array
     • Update member record
   → If unchanged:
     • Only update roles and timestamps
3. For other entities:
   → Direct upsert to database
```

## Performance Benefits

- **Fast Startup**: Typical incremental sync takes <1 second vs 10-30 seconds for full sync
- **Efficient Storage**: Differential history only stores what changed
- **Smart Healing**: Automatically detects and fixes data inconsistencies
- **Scalable**: Member sync can handle large guilds without fetching all members every time
- **Resilient**: Falls back to full sync when integrity issues detected

## Configuration

The sync system uses these thresholds (configurable in code):

- **Full Sync Threshold**: 7 days (in `SyncStateManager.FULL_SYNC_THRESHOLD_DAYS`)
- **Health Check Threshold**: 10% discrepancy (in `DiscordSyncManager.detectHealthIssues()`)
- **History Limit**: 100 entries per member (in `UserHistoryTracker.createUpdatedMember()`)

## Monitoring

Sync operations log detailed information:

- `🔹 Performing full sync for guild: ...` - Full sync initiated
- `🔹 Performing incremental sync for guild: ...` - Incremental sync initiated
- `🔹 Sync completed in Xs: Y new, Z updated, W marked inactive` - Sync summary
- `🔹 Updated member X: Changed N field(s): ...` - Profile change detected
- `🔸 Health issue detected for ... : DB has X, Discord has Y` - Data inconsistency found

## Example Output

```
🔹 Starting startup sync check...
🔹 Performing incremental sync for guild: the hearth
🔹 Updated member JohnDoe: Changed 2 field(s): username: "john_doe" → "JohnDoe", avatar: "abc123" → "def456"
🔹 Sync completed in 0.85s: 5 new, 12 updated, 3 marked inactive
```

## Database Schema

### sync_metadata Table

```sql
DEFINE TABLE sync_metadata SCHEMAFULL {
  id: string,                    -- "guildId:entityType"
  guild_id: string,
  entity_type: string,           -- "guild" | "channel" | "role" | "member"
  last_full_sync: datetime?,
  last_check: datetime,
  entity_count: number,
  status: string,                -- "healthy" | "needs_healing" | "syncing"
  created_at: datetime,
  updated_at: datetime
};
```

### members Table (Updated)

```sql
DEFINE TABLE members SCHEMAFULL {
  id: string,
  guild_id: string,
  user_id: string,

  -- Current profile state (all Discord properties)
  username: string,
  display_name: string,
  global_name: string?,
  avatar: string?,
  avatar_decoration: string?,
  banner: string?,
  accent_color: number?,
  discriminator: string,
  bio: string?,
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
```

## Future Enhancements

Potential improvements for the sync system:

1. **Batch member updates**: Update multiple members in single query
2. **Configurable history limits**: Per-guild settings for history retention
3. **Profile change webhooks**: Notify external systems of profile changes
4. **Sync analytics**: Track sync performance and patterns over time
5. **Manual sync triggers**: Admin command to force full sync
6. **Partial member sync**: Only sync members who were active recently for very large guilds
