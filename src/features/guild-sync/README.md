# Guild Sync Scripts

This folder contains scripts for syncing Discord guild data to SurrealDB Cloud.

## Scripts

### `sync-guild-data.ts`

Comprehensive guild sync script that syncs:

- Guild basic information (name, owner, member count, features)
- All roles with permissions and properties
- All channels (text, voice, categories)
- All members with their roles and profile data
- Sync metadata for tracking

### `sync-channel-messages.ts`

Channel-specific message sync script that syncs:

- Messages from a specific channel
- Message content, attachments, and embeds
- Author information and timestamps
- Handles pagination and rate limiting
- Skips bot messages and empty messages

## Usage

1. Ensure your environment variables are set:

   ```bash
   export GUILD_ID="your_guild_id"
   export BOT_TOKEN="your_bot_token"
   export SURREAL_URL="wss://your-project.surrealdb.com/rpc"
   export SURREAL_NAMESPACE="your_namespace"
   export SURREAL_DATABASE="your_database"
   export SURREAL_USERNAME="your_username"
   export SURREAL_PASSWORD="your_password"
   ```

2. Run the sync script:

   ```bash
   # Full guild sync
   bun run src/features/guild-sync/sync-guild-data.ts

   # Sync messages from a specific channel
   bun run src/features/guild-sync/sync-channel-messages.ts [channel_name_or_id]
   ```

## Features

- **Comprehensive Sync**: Syncs all guild data in one run
- **Progress Tracking**: Shows detailed progress for each step
- **Error Handling**: Continues on errors and reports failures
- **Rate Limiting**: Includes delays to avoid Discord API limits
- **Database Verification**: Checks final database state
- **Graceful Shutdown**: Handles SIGINT/SIGTERM signals

## Database Schema

The script syncs data to these SurrealDB tables:

- `guilds` - Guild information
- `roles` - Guild roles with permissions
- `channels` - All channel types
- `members` - Member profiles and roles
- `messages` - Channel messages with content and metadata
- `sync_metadata` - Sync tracking data

## Notes

- Bot members are skipped during member sync
- The @everyone role is skipped during role sync
- Forum and stage channels are excluded
- Includes comprehensive error reporting and statistics
