# Discord Sync Manager Documentation

## Overview

The `DiscordSyncManager` class orchestrates bidirectional synchronization between Discord servers and SurrealDB. It handles initial data population, real-time event synchronization, and ensures data consistency across both systems.

## Features

- **Initial Data Sync**: Populates database with existing Discord data on startup
- **Real-time Synchronization**: Automatically syncs Discord events to database
- **Bidirectional Sync**: Handles both Discord → Database and Database → Discord updates
- **Event Handling**: Comprehensive Discord event listeners for all entity types
- **Error Resilience**: Continues operation even when database is unavailable
- **Performance Optimized**: Efficient batch operations and minimal API calls

## Architecture

```
Discord Events → DiscordSyncManager → SurrealDB
     ↑                                        ↓
     ←─────────── Live Queries ←───────────────
```

The sync manager acts as a bridge between Discord.js events and SurrealDB operations, ensuring data consistency and real-time updates.

## Usage

### Basic Setup

```typescript
import { DiscordSyncManager } from "./DiscordSyncManager";
import { SurrealDBManager } from "../database/SurrealDBManager";

const db = new SurrealDBManager();
const syncManager = new DiscordSyncManager(client, db);

// Initialize synchronization
await syncManager.initialize();
```

### Integration with Bot

```typescript
class Bot {
  private syncManager?: DiscordSyncManager;

  async initialize() {
    // Connect to database first
    const dbConnected = await this.db.connect();

    if (dbConnected) {
      // Initialize sync manager
      this.syncManager = new DiscordSyncManager(this.client, this.db);
      await this.syncManager.initialize();
    }
  }
}
```

## API Reference

### Core Methods

#### `initialize(): Promise<void>`

Performs initial setup and data synchronization.

```typescript
await syncManager.initialize();
```

This method:

1. Sets up Discord event handlers
2. Performs initial data population
3. Logs initialization status

#### `syncGuild(guild: Guild): Promise<void>`

Synchronizes a Discord guild to the database.

```typescript
await syncManager.syncGuild(guild);
```

#### `syncChannel(channel: Channel, guildId: string): Promise<void>`

Synchronizes a Discord channel to the database.

```typescript
await syncManager.syncChannel(channel, guild.id);
```

#### `syncMember(member: GuildMember): Promise<void>`

Synchronizes a Discord member to the database.

```typescript
await syncManager.syncMember(member);
```

#### `syncRole(role: Role): Promise<void>`

Synchronizes a Discord role to the database.

```typescript
await syncManager.syncRole(role);
```

#### `syncMessage(message: Message): Promise<void>`

Synchronizes a Discord message to the database.

```typescript
await syncManager.syncMessage(message);
```

### Event Handlers

The sync manager automatically sets up handlers for all Discord events:

#### Guild Events

- `guildCreate` → Creates guild record
- `guildUpdate` → Updates guild record
- `guildDelete` → Marks guild as inactive

#### Channel Events

- `channelCreate` → Creates channel record
- `channelUpdate` → Updates channel record
- `channelDelete` → Marks channel as inactive

#### Member Events

- `guildMemberAdd` → Creates member record
- `guildMemberUpdate` → Updates member record
- `guildMemberRemove` → Marks member as inactive

#### Role Events

- `roleCreate` → Creates role record
- `roleUpdate` → Updates role record
- `roleDelete` → Marks role as inactive

#### Message Events

- `messageCreate` → Creates message record
- `messageUpdate` → Updates message record
- `messageDelete` → Marks message as inactive

## Data Synchronization

### Initial Data Population

On startup, the sync manager performs a comprehensive initial sync:

```typescript
private async performInitialSync(): Promise<void> {
    console.log("🔹 Starting initial data synchronization...");

    for (const [guildId, guild] of this.client.guilds.cache) {
        // Sync guild
        await this.syncGuild(guild);

        // Sync channels
        for (const [channelId, channel] of guild.channels.cache) {
            await this.syncChannel(channel, guildId);
        }

        // Sync roles
        for (const [roleId, role] of guild.roles.cache) {
            await this.syncRole(role);
        }

        // Sync members (with pagination for large guilds)
        await this.syncGuildMembers(guild);
    }

    console.log("🔹 Initial synchronization complete");
}
```

### Real-time Synchronization

The sync manager listens to Discord events and automatically syncs changes:

```typescript
// Example: Guild member joins
this.client.on("guildMemberAdd", async (member) => {
  await this.syncMember(member);
});

// Example: Channel is updated
this.client.on("channelUpdate", async (oldChannel, newChannel) => {
  if ("guild" in newChannel && newChannel.guild) {
    await this.syncChannel(newChannel, newChannel.guild.id);
  }
});
```

### Data Conversion

The sync manager uses conversion functions to transform Discord objects to SurrealDB format:

```typescript
// Convert Discord guild to SurrealDB format
const guildData = discordGuildToSurreal(guild);
await this.db.upsertGuild(guildData);

// Convert Discord member to SurrealDB format
const memberData = discordMemberToSurreal(member);
await this.db.upsertMember(memberData);
```

## Error Handling

### Graceful Degradation

The sync manager continues operating even when the database is unavailable:

```typescript
private async syncGuild(guild: Guild): Promise<void> {
    try {
        const guildData = discordGuildToSurreal(guild);
        const result = await this.db.upsertGuild(guildData);

        if (result.success) {
            console.log(`🔹 Synced guild: ${guild.name}`);
        } else {
            console.error(`🔸 Failed to sync guild: ${result.error}`);
        }
    } catch (error) {
        console.error(`🔸 Error syncing guild ${guild.name}:`, error);
        // Continue operation despite error
    }
}
```

### Error Logging

All operations include comprehensive error logging:

```typescript
console.log("🔹 Synced member:", member.displayName); // Success
console.error("🔸 Failed to sync member:", error); // Error
console.log("🔹 Marked member as inactive"); // Status update
```

## Performance Considerations

### Batch Operations

For large guilds, the sync manager uses efficient batch operations:

```typescript
private async syncGuildMembers(guild: Guild): Promise<void> {
    const members = await guild.members.fetch();

    // Process members in batches to avoid rate limits
    const batchSize = 50;
    for (let i = 0; i < members.size; i += batchSize) {
        const batch = Array.from(members.values()).slice(i, i + batchSize);

        await Promise.all(
            batch.map(member => this.syncMember(member))
        );

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
```

### Rate Limit Handling

The sync manager respects Discord API rate limits:

```typescript
// Add delays between operations
await new Promise((resolve) => setTimeout(resolve, 100));

// Use Promise.all for parallel operations where safe
await Promise.all([
  this.syncChannel(channel1, guildId),
  this.syncChannel(channel2, guildId),
]);
```

## Configuration

### Environment Variables

The sync manager uses the same configuration as the SurrealDBManager:

```env
# SurrealDB settings
SURREAL_URL=wss://your-instance.surrealdb.com/rpc
SURREAL_NAMESPACE=arcados-bot
SURREAL_DATABASE=arcados-bot
SURREAL_USERNAME=your_username
SURREAL_PASSWORD=your_password
```

### Bot Permissions

Ensure your bot has the necessary permissions:

```json
{
  "permissions": [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    "MANAGE_ROLES",
    "MANAGE_MEMBERS",
    "SEND_MESSAGES",
    "EMBED_LINKS"
  ]
}
```

## Best Practices

### 1. Initialization Order

```typescript
// Correct order
await db.connect(); // 1. Connect to database
await syncManager.initialize(); // 2. Initialize sync manager
await client.login(token); // 3. Login to Discord
```

### 2. Error Handling

```typescript
// Always wrap sync operations in try-catch
try {
  await syncManager.syncGuild(guild);
} catch (error) {
  console.error("Sync failed:", error);
  // Continue operation
}
```

### 3. Performance Optimization

```typescript
// Use batch operations for multiple entities
const channels = Array.from(guild.channels.cache.values());
await Promise.all(
  channels.map((channel) => syncManager.syncChannel(channel, guild.id))
);
```

### 4. Monitoring

```typescript
// Log sync status
console.log(`🔹 Synced ${guild.memberCount} members`);
console.log(`🔹 Synced ${guild.channels.cache.size} channels`);
```

## Troubleshooting

### Common Issues

#### Sync Not Working

```typescript
// Check database connection
if (!db.isConnected()) {
  console.error("Database not connected");
  return;
}

// Check bot permissions
if (!guild.members.me?.permissions.has("VIEW_CHANNEL")) {
  console.error("Bot lacks VIEW_CHANNEL permission");
  return;
}
```

#### Performance Issues

```typescript
// Monitor sync performance
const startTime = Date.now();
await syncManager.syncGuild(guild);
const duration = Date.now() - startTime;
console.log(`Sync took ${duration}ms`);
```

#### Memory Usage

```typescript
// For large guilds, sync members in smaller batches
const batchSize = 25; // Reduce batch size for large guilds
```

### Debug Mode

Enable debug logging:

```typescript
// Set debug level
process.env.LOG_LEVEL = "debug";

// The sync manager will log detailed information
```

## Examples

### Complete Bot Integration

```typescript
import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "./database/SurrealDBManager";
import { DiscordSyncManager } from "./features/discord-sync/DiscordSyncManager";

class Bot {
  private client: Client;
  private db: SurrealDBManager;
  private syncManager?: DiscordSyncManager;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildPresences,
      ],
    });

    this.db = new SurrealDBManager();
  }

  async initialize() {
    // Connect to database
    const dbConnected = await this.db.connect();

    if (dbConnected) {
      console.log("🔹 Database connected");

      // Initialize sync manager
      this.syncManager = new DiscordSyncManager(this.client, this.db);
      await this.syncManager.initialize();

      console.log("🔹 Sync manager initialized");
    } else {
      console.log("🔸 Continuing without database features");
    }

    // Login to Discord
    await this.client.login(process.env.BOT_TOKEN);
  }

  async shutdown() {
    await this.db.disconnect();
    this.client.destroy();
  }
}

// Usage
const bot = new Bot();
bot.initialize().catch(console.error);

// Graceful shutdown
process.on("SIGINT", () => bot.shutdown());
process.on("SIGTERM", () => bot.shutdown());
```

### Custom Sync Logic

```typescript
// Extend the sync manager for custom behavior
class CustomSyncManager extends DiscordSyncManager {
  async syncMember(member: GuildMember): Promise<void> {
    // Call parent method
    await super.syncMember(member);

    // Add custom logic
    if (member.user.bot) {
      console.log(`🔹 Synced bot member: ${member.user.username}`);
    }

    // Check for milestones
    const memberCount = member.guild.memberCount;
    if (memberCount % 100 === 0) {
      console.log(`🔹 Guild reached ${memberCount} members!`);
    }
  }
}
```

### Manual Sync Operations

```typescript
// Manually sync specific entities
await syncManager.syncGuild(guild);
await syncManager.syncChannel(channel, guild.id);
await syncManager.syncMember(member);
await syncManager.syncRole(role);
await syncManager.syncMessage(message);
```

## License

This documentation is part of the Arcados Bot project and follows the same MIT license.
