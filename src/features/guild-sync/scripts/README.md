# Discord Sync Scripts

This folder contains scripts for synchronizing Discord data with the database.

## Scripts

### Main Sync Scripts
- `full-discord-sync.ts` - Complete Discord to database synchronization
- `continue-discord-sync.ts` - Continues sync from where it left off
- `simple-discord-sync.ts` - Simplified sync implementation
- `simple-discord-sync-v2.ts` - Version 2 of simple sync
- `simple-discord-sync-v3.ts` - Version 3 of simple sync
- `sync-guild-to-postgres.ts` - Syncs guild data to PostgreSQL

## Features

- **Incremental Sync**: Continues from where previous sync left off
- **Rate Limiting**: Respects Discord API rate limits
- **Error Handling**: Graceful error handling and recovery
- **Progress Tracking**: Shows sync progress and statistics

## Usage

### Full Sync
```bash
npx tsx src/scripts/discord-sync/full-discord-sync.ts
```

### Continue Sync
```bash
npx tsx src/scripts/discord-sync/continue-discord-sync.ts
```

### Simple Sync
```bash
npx tsx src/scripts/discord-sync/simple-discord-sync-v3.ts
```

## Configuration

Make sure to set these environment variables:
- `DISCORD_TOKEN` - Your Discord bot token
- `GUILD_ID` - Target guild ID for syncing
- Database connection variables (PostgreSQL or SurrealDB)
