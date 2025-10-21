<!-- acf3368f-ac49-451c-ae07-d43d2722aae0 a4a4ec2c-e967-4139-a7c7-fe2b49f4c659 -->
# Voice Channel Manager Implementation Plan

## Overview

Implement a self-organizing voice channel ecosystem where users can spawn personal voice spaces by joining a designated spawn channel. The system includes owner-based moderation (mute, deafen, ban), graceful ownership transitions with grandfather protection, and refactored command loading to support feature-scoped commands.

## Phase 1: Database Schema Updates

### 1.1 Extend `members` table schema

**File:** `src/database/schema.ts`

- Add `channel_preferences` object to `SURREAL_SCHEMA.members` definition
- Fields: `channel_name`, `default_user_limit`, `banned_users`, `muted_users`, `deafened_users`, `privacy_mode`
- All user references use User IDs (not usernames)

### 1.2 Extend `channels` table schema

**File:** `src/database/schema.ts`

- Add ownership tracking fields to `SURREAL_SCHEMA.channels`
- Fields: `is_user_channel`, `spawn_channel_id`, `current_owner_id`, `ownership_changed_at`

### 1.3 Modify `voice_sessions` table schema

**File:** `src/database/schema.ts`

- Remove: `channels_visited`, `switch_count` fields
- Add: `owner_at_join`, `is_grandfathered`, `applied_moderation` object
- `applied_moderation` contains: `is_muted`, `is_deafened`, `muted_by`, `deafened_by`, `applied_at`

### 1.4 Update TypeScript interfaces

**File:** `src/database/schema.ts`

- Update `SurrealMember` interface with `channel_preferences`
- Update `SurrealChannel` interface with ownership fields
- Update `SurrealVoiceSession` interface (remove/add fields)
- Create new types: `ChannelPreferences`, `AppliedModeration`

### 1.5 Add SurrealDBManager methods

**File:** `src/database/SurrealDBManager.ts`

- Add schema field definitions for new/modified fields
- Add `getUserChannelPreferences(userId, guildId)` method
- Add `updateUserChannelPreferences(userId, guildId, prefs)` method
- Add `getUserChannelsByOwner(ownerId, guildId)` method
- Add `getActiveVoiceSessionsByChannel(channelId)` method

## Phase 2: Command Loader Refactor

### 2.1 Update command loading utility

**File:** `src/utils/loadCommands.ts`

- Refactor to load commands from both `src/commands/` (legacy) and `src/features/*/commands/` (feature-based)
- Create `loadCommandsFromDirectory()` helper function
- Scan all feature directories for `commands/` subdirectories
- Maintain backward compatibility with existing global commands

### 2.2 Test command loading

- Verify existing commands (`/ping`, `/ai`) still load correctly
- Ensure no duplicate command registration
- Add error handling for malformed command modules

## Phase 3: VoiceChannelManager Core Service

### 3.1 Create service structure

**Directory:** `src/features/voice-channel-manager/`

- Create `VoiceChannelManager.ts` (main service)
- Create `types.ts` (voice channel-specific types)
- Create `commands/` directory (for feature commands)

### 3.2 Implement VoiceChannelManager class

**File:** `src/features/voice-channel-manager/VoiceChannelManager.ts`

**Core methods:**

- `initialize()` - Load spawn channel ID from config
- `spawnUserChannel(user, guild)` - Create channel, apply preferences, move user
- `deleteUserChannel(channelId)` - Delete Discord channel and cleanup DB
- `positionChannelAboveSpawn(channelId, guildId)` - Position new channel directly above spawn

**Ownership methods:**

- `determineNextOwner(channelId)` - Query voice_sessions for longest resident by `joined_at`
- `transferOwnership(channelId, newOwnerId, oldOwnerId)` - Update owner, mark grandfathered users, rename channel
- `canUserClaim(userId, channelId)` - Check if user previously owned channel
- `reclaimChannel(userId, channelId)` - Transfer ownership back to previous owner

**Moderation methods:**

- `checkBanList(ownerId, guildId, targetUserId)` - Check if target in owner's banned_users
- `applyMute(channelId, targetUserId, ownerId)` - Apply Discord mute + update voice_session
- `applyDeafen(channelId, targetUserId, ownerId)` - Apply Discord deafen + update voice_session
- `removeMute(channelId, targetUserId)` - Remove Discord mute + clear from voice_session
- `removeDeafen(channelId, targetUserId)` - Remove Discord deafen + clear from voice_session

**Grandfather protection methods:**

- `markGrandfatheredUsers(channelId, newOwnerId)` - Mark all active sessions as grandfathered during ownership change
- `checkGrandfatherStatus(sessionId)` - Determine if user is protected from new owner's bans

**Preference methods:**

- `loadUserPreferences(userId, guildId)` - Load channel_preferences from members table
- `applyChannelPreferences(channelId, preferences)` - Apply name, limit, privacy settings

### 3.3 Add event handlers

**File:** `src/features/voice-channel-manager/VoiceChannelManager.ts`

- `handleSpawnJoin(member, guild)` - User joins spawn channel → spawn new channel
- `handleUserJoinChannel(member, channel)` - User joins user channel → check bans, apply moderation
- `handleUserLeaveChannel(member, channel)` - User leaves → check if owner, transfer/delete
- `handleOwnershipChange(channelId, oldOwnerId)` - Coordinate ownership transfer flow

## Phase 4: Moderation System

### 4.1 Implement preference-based moderation

**File:** `src/features/voice-channel-manager/VoiceChannelManager.ts`

- On channel spawn: Load owner's `banned_users`, `muted_users`, `deafened_users`
- On user join: Check against owner's preference lists
- If in `banned_users` → Disconnect with message
- If in `muted_users` → Apply mute immediately, update `applied_moderation`
- If in `deafened_users` → Apply deafen immediately, update `applied_moderation`

### 4.2 Implement session-based moderation

**File:** `src/features/voice-channel-manager/VoiceChannelManager.ts`

- When owner uses `/mute`: Update target's `voice_session.applied_moderation`
- Store: `muted_by` (owner's User ID), `applied_at` timestamp
- On user rejoin: Check if `muted_by == current_owner_id` → Reapply or clear
- On ownership change: Check if moderation was by previous owner → Respect grandfather status

### 4.3 Implement grandfather protection

**File:** `src/features/voice-channel-manager/VoiceChannelManager.ts`

**On ownership transfer:**

1. Get all active sessions in channel
2. Set `is_grandfathered: true` for users present during transfer
3. Set `owner_at_join` to previous owner's User ID
4. New owner's bans don't affect grandfathered users

**On user leave:**

1. Close session, set `left_at`, `active: false`
2. Clear `applied_moderation` (remove Discord mute/deafen)

**On user rejoin:**

1. Create new session with `owner_at_join: current_owner_id`
2. `is_grandfathered: false` (no protection)
3. Apply current owner's moderation rules

## Phase 5: Command Implementation

### 5.1 Ownership commands

**File:** `src/features/voice-channel-manager/commands/claim.ts`

- `/claim` - Check ownership history, transfer if valid
- Verify user is in the channel they're claiming
- Check `voice_sessions` for previous `owner_at_join` entries
- Transfer ownership, reactivate user's preferences

**File:** `src/features/voice-channel-manager/commands/renounce.ts`

- `/renounce` - Drop ownership voluntarily
- Verify user is current owner
- Transfer to longest resident
- Update ownership history

### 5.2 Moderation commands

**File:** `src/features/voice-channel-manager/commands/mute.ts`

- `/mute @user` - Mute user in channel (owner only)
- Verify ownership, get target member
- Call `VoiceChannelManager.applyMute()`
- Reply with confirmation

**File:** `src/features/voice-channel-manager/commands/unmute.ts`

- `/unmute @user` - Remove mute (owner only)
- Verify ownership, call `removeMute()`

**File:** `src/features/voice-channel-manager/commands/deafen.ts`

- `/deafen @user` - Deafen user in channel (owner only)
- Similar to mute command logic

**File:** `src/features/voice-channel-manager/commands/undeafen.ts`

- `/undeafen @user` - Remove deafen (owner only)

### 5.3 Ban list management commands

**File:** `src/features/voice-channel-manager/commands/ban.ts`

- `/ban @user` - Add to personal ban list (owner only)
- Update `channel_preferences.banned_users` array
- Kick user if currently in channel

**File:** `src/features/voice-channel-manager/commands/unban.ts`

- `/unban @user` - Remove from ban list (owner only)
- Update `channel_preferences.banned_users` array

### 5.4 Preferences command

**File:** `src/features/voice-channel-manager/commands/channel-prefs.ts`

- `/channel-prefs` - Configure personal channel settings
- Show current preferences
- Allow editing: `channel_name`, `default_user_limit`, `privacy_mode`
- Update in database

## Phase 6: Integration with VoiceStateManager

### 6.1 Initialize VoiceChannelManager

**File:** `src/features/voice-state/VoiceStateManager.ts`

- Import `VoiceChannelManager`
- Add `private voiceChannelManager?: VoiceChannelManager` property
- Initialize in `initialize()` method after DB connection confirmed
- Pass `client`, `db`, and `config.spawnChannelId`

### 6.2 Hook spawn detection

**File:** `src/features/voice-state/VoiceStateManager.ts` - `handleVoiceJoin()`

- Check if `newState.channelId === config.spawnChannelId`
- If yes, call `voiceChannelManager.handleSpawnJoin()`
- Return early (don't process as normal join)

### 6.3 Hook user channel join

**File:** `src/features/voice-state/VoiceStateManager.ts` - `handleVoiceJoin()`

- After spawn check, fetch channel from DB
- Check if `channel.is_user_channel === true`
- If yes, call `voiceChannelManager.handleUserJoinChannel()`
- Apply ban checks and moderation

### 6.4 Hook user channel leave

**File:** `src/features/voice-state/VoiceStateManager.ts` - `handleVoiceLeave()`

- Fetch channel from DB
- Check if `channel.is_user_channel === true`
- If yes, call `voiceChannelManager.handleUserLeaveChannel()`
- Trigger ownership transfer or channel deletion

### 6.5 Update existing voice session handling

**File:** `src/features/voice-state/VoiceStateManager.ts`

- Ensure `owner_at_join` is set when creating sessions
- Ensure `is_grandfathered` defaults to false
- Ensure `applied_moderation` is included in session updates

## Phase 7: Configuration & Environment

### 7.1 Add environment variable

**File:** `src/config/index.ts`

- Add `spawnChannelId` to config exports
- Read from `process.env.SPAWN_CHANNEL_ID`
- Add validation (required if voice channel features enabled)

### 7.2 Update README

**File:** `README.md`

- Document `SPAWN_CHANNEL_ID` environment variable
- Add Voice Channel Manager feature documentation
- Explain spawn, ownership, moderation, grandfather protection
- List available commands

## Phase 8: Testing & Edge Cases

### 8.1 Test spawn flow

- User joins spawn channel → Channel created above spawn
- User moved into new channel
- Preferences applied (name, limit)
- Channel dissolves when empty

### 8.2 Test ownership transfer

- Owner leaves → Longest resident inherits (by `joined_at`)
- Channel renamed to new owner's display name
- Grandfathered users marked correctly
- Empty channel deleted

### 8.3 Test grandfather protection

- User in channel when ownership changes
- New owner has user in ban list
- User stays in channel (grandfathered)
- User leaves and rejoins → Ban applies

### 8.4 Test reclaim

- Previous owner uses `/claim`
- Ownership restored
- Previous owner's preferences reactivated
- Channel renamed back

### 8.5 Test moderation

- Owner mutes user → Discord mute applied + DB updated
- User leaves → Mute cleared
- User rejoins → Check if same owner, reapply if yes
- Ownership changes → Check `muted_by`, clear if different owner (unless grandfathered)

### 8.6 Test edge cases

- Simultaneous spawns (100+ users)
- Rapid ownership changes (owner leaves/rejoins quickly)
- User changes display name (channel should rename on next ownership check)
- Bot offline during ownership change (reconciliation on startup via existing VoiceStateManager)

## Key Implementation Notes

### Security

- All user references use **User IDs** (Discord snowflakes), never usernames
- Display names fetched from `members` table for UI only
- Authorization checks always validate against immutable User IDs

### Consistency

- Rely on existing `VoiceStateManager.reconcileVoiceStates()` (runs every 5 minutes)
- Use SurrealDB live queries for real-time reactivity
- No periodic watchers needed (simplified architecture)

### Database Queries

**Longest resident query:**

```sql
SELECT * FROM voice_sessions
WHERE channel_id = $channel_id
  AND active = true
  AND left_at = NONE
ORDER BY joined_at ASC
LIMIT 1
```

**Check previous ownership:**

```sql
SELECT * FROM voice_sessions
WHERE channel_id = $channel_id
  AND user_id = $user_id
  AND owner_at_join = $user_id
LIMIT 1
```

### Channel Positioning

- Use Discord.js `setPosition()` to place channels above spawn
- Calculate position: `spawn_channel_position - 1`
- Handle position conflicts by stacking newest channels at top

## Success Criteria

- Channel spawns in <2 seconds from spawn join
- Ownership transfers without user disruption
- Grandfather protection prevents unexpected kicks
- Moderation applies instantly and persists correctly
- Channels dissolve immediately when last person leaves
- Commands load from feature directories successfully
- System handles 100+ concurrent spawns smoothly
- No server-wide moderation leaks (all scoped to channels)

### To-dos

- [ ] Update database schema (members, channels, voice_sessions) with new fields for channel preferences, ownership, and moderation
- [ ] Refactor command loading system to support feature-scoped commands (src/features/*/commands/)
- [ ] Implement VoiceChannelManager service with spawn, ownership, and channel lifecycle methods
- [ ] Implement moderation system (preference-based, session-based, grandfather protection)
- [ ] Implement 9 slash commands (claim, renounce, mute, unmute, deafen, undeafen, ban, unban, channel-prefs)
- [ ] Integrate VoiceChannelManager with existing VoiceStateManager (hook voice events)
- [ ] Add SPAWN_CHANNEL_ID environment configuration and update documentation
- [ ] Test all flows (spawn, ownership, grandfather, reclaim, moderation) and edge cases