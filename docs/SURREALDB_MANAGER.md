# SurrealDB Manager Documentation

## Overview

The `SurrealDBManager` class provides a comprehensive interface for connecting to and interacting with SurrealDB. It handles connection management, CRUD operations, Live Query subscriptions, and graceful error handling.

## Features

- **WebSocket Connection**: Real-time connection to SurrealDB Cloud
- **Authentication**: Support for both username/password and token authentication
- **CRUD Operations**: Complete Create, Read, Update, Delete operations for all entities
- **Live Queries**: Real-time subscriptions to database changes
- **Connection Resilience**: Automatic reconnection with exponential backoff
- **Graceful Degradation**: Continues operation even when database is unavailable

## Installation

The SurrealDBManager requires the `surrealdb.js` package:

```bash
npm install surrealdb.js
```

## Configuration

### Environment Variables

```env
# SurrealDB Cloud settings
SURREAL_URL=wss://your-instance.surrealdb.com/rpc
SURREAL_NAMESPACE=arcados-bot
SURREAL_DATABASE=arcados-bot

# Authentication (choose one)
SURREAL_USERNAME=your_username
SURREAL_PASSWORD=your_password

# OR use token authentication
SURREAL_TOKEN=your_surreal_token
```

### Basic Usage

```typescript
import { SurrealDBManager } from "./SurrealDBManager";

const db = new SurrealDBManager();

// Connect to SurrealDB
const connected = await db.connect();
if (connected) {
  console.log("Connected to SurrealDB");
} else {
  console.log("Failed to connect to SurrealDB");
}
```

## API Reference

### Connection Management

#### `connect(): Promise<boolean>`

Establishes connection to SurrealDB and performs authentication.

```typescript
const connected = await db.connect();
```

**Returns:** `Promise<boolean>` - `true` if connection successful, `false` otherwise.

#### `disconnect(): Promise<void>`

Gracefully disconnects from SurrealDB and cleans up resources.

```typescript
await db.disconnect();
```

#### `isConnected(): boolean`

Checks current connection status.

```typescript
if (db.isConnected()) {
  console.log("Database is connected");
}
```

**Returns:** `boolean` - Current connection status.

#### `reconnect(): Promise<void>`

Attempts to reconnect with exponential backoff.

```typescript
await db.reconnect();
```

### Guild Operations

#### `upsertGuild(guild: Partial<SurrealGuild>): Promise<DatabaseResult<SurrealGuild>>`

Creates or updates a guild record.

```typescript
const result = await db.upsertGuild({
  id: "guild_id",
  name: "My Guild",
  member_count: 100,
  owner_id: "owner_id",
  active: true,
});

if (result.success) {
  console.log("Guild saved:", result.data);
}
```

#### `getGuild(guildId: string): Promise<DatabaseResult<SurrealGuild>>`

Retrieves a specific guild by ID.

```typescript
const result = await db.getGuild("guild_id");
if (result.success) {
  console.log("Guild found:", result.data);
}
```

#### `getAllGuilds(): Promise<DatabaseResult<SurrealGuild[]>>`

Retrieves all guilds from the database.

```typescript
const result = await db.getAllGuilds();
if (result.success) {
  console.log(`Found ${result.data.length} guilds`);
}
```

### Channel Operations

#### `upsertChannel(channel: Partial<SurrealChannel>): Promise<DatabaseResult<SurrealChannel>>`

Creates or updates a channel record.

```typescript
const result = await db.upsertChannel({
  id: "channel_id",
  guild_id: "guild_id",
  name: "general",
  type: "0", // Text channel
  position: 0,
});
```

#### `getChannelsByGuild(guildId: string): Promise<DatabaseResult<SurrealChannel[]>>`

Retrieves all channels for a specific guild.

```typescript
const result = await db.getChannelsByGuild("guild_id");
if (result.success) {
  console.log(`Found ${result.data.length} channels`);
}
```

### Member Operations

#### `upsertMember(member: Partial<SurrealMember>): Promise<DatabaseResult<SurrealMember>>`

Creates or updates a member record.

```typescript
const result = await db.upsertMember({
  id: "guild_id:user_id",
  guild_id: "guild_id",
  user_id: "user_id",
  username: "username",
  display_name: "Display Name",
  roles: ["role_id_1", "role_id_2"],
});
```

#### `getMembersByGuild(guildId: string): Promise<DatabaseResult<SurrealMember[]>>`

Retrieves all members for a specific guild.

```typescript
const result = await db.getMembersByGuild("guild_id");
if (result.success) {
  console.log(`Found ${result.data.length} members`);
}
```

### Role Operations

#### `upsertRole(role: Partial<SurrealRole>): Promise<DatabaseResult<SurrealRole>>`

Creates or updates a role record.

```typescript
const result = await db.upsertRole({
  id: "role_id",
  guild_id: "guild_id",
  name: "Moderator",
  color: 0xff0000,
  position: 1,
});
```

#### `getRolesByGuild(guildId: string): Promise<DatabaseResult<SurrealRole[]>>`

Retrieves all roles for a specific guild.

```typescript
const result = await db.getRolesByGuild("guild_id");
if (result.success) {
  console.log(`Found ${result.data.length} roles`);
}
```

### Message Operations

#### `upsertMessage(message: Partial<SurrealMessage>): Promise<DatabaseResult<SurrealMessage>>`

Creates or updates a message record.

```typescript
const result = await db.upsertMessage({
  id: "message_id",
  channel_id: "channel_id",
  guild_id: "guild_id",
  author_id: "user_id",
  content: "Hello world!",
  timestamp: new Date(),
});
```

### Action Operations

#### `createAction(action: Partial<SurrealAction>): Promise<DatabaseResult<SurrealAction>>`

Creates a new database-triggered action.

```typescript
const result = await db.createAction({
  guild_id: "guild_id",
  type: "member_role_update",
  payload: {
    guild_id: "guild_id",
    user_id: "user_id",
    role_ids: ["role_id_1", "role_id_2"],
  },
  executed: false,
});
```

#### `getPendingActions(): Promise<DatabaseResult<SurrealAction[]>>`

Retrieves all pending (unexecuted) actions.

```typescript
const result = await db.getPendingActions();
if (result.success) {
  console.log(`${result.data.length} pending actions`);
}
```

#### `markActionExecuted(actionId: string): Promise<DatabaseResult<SurrealAction>>`

Marks an action as executed.

```typescript
const result = await db.markActionExecuted("action_id");
if (result.success) {
  console.log("Action marked as executed");
}
```

## Live Query Subscriptions

### `subscribeToGuilds(callback: LiveQueryCallback<SurrealGuild>): Promise<string | null>`

Subscribes to real-time guild changes.

```typescript
const subscriptionId = await db.subscribeToGuilds((action, data) => {
  console.log(`Guild ${action}:`, data);

  switch (action) {
    case "CREATE":
      console.log("New guild created:", data);
      break;
    case "UPDATE":
      console.log("Guild updated:", data);
      break;
    case "DELETE":
      console.log("Guild deleted:", data);
      break;
  }
});
```

### `subscribeToMembers(callback: LiveQueryCallback<SurrealMember>): Promise<string | null>`

Subscribes to real-time member changes.

```typescript
const subscriptionId = await db.subscribeToMembers((action, data) => {
  console.log(`Member ${action}:`, data);
});
```

### `subscribeToActions(callback: LiveQueryCallback<SurrealAction>): Promise<string | null>`

Subscribes to real-time action changes.

```typescript
const subscriptionId = await db.subscribeToActions((action, data) => {
  if (action === "CREATE") {
    console.log("New action created:", data);
    // Execute the action immediately
  }
});
```

### `subscribeToGuildMembers(guildId: string, callback: LiveQueryCallback<SurrealMember>): Promise<string | null>`

Subscribes to member changes for a specific guild.

```typescript
const subscriptionId = await db.subscribeToGuildMembers(
  "guild_id",
  (action, data) => {
    console.log(`Member ${action} in guild:`, data);
  }
);
```

## Error Handling

### DatabaseResult Type

All database operations return a `DatabaseResult<T>` type:

```typescript
interface DatabaseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### Example Error Handling

```typescript
const result = await db.upsertGuild(guildData);

if (result.success) {
  console.log("Guild saved successfully:", result.data);
} else {
  console.error("Failed to save guild:", result.error);
  // Handle error appropriately
}
```

### Connection Error Handling

```typescript
try {
  const connected = await db.connect();
  if (!connected) {
    console.log("Database unavailable, continuing without DB features");
    // Bot continues operating without database features
  }
} catch (error) {
  console.error("Database connection error:", error);
  // Graceful degradation - bot continues without DB
}
```

## Connection Resilience

### Automatic Reconnection

The manager includes built-in reconnection logic:

```typescript
// Reconnection is handled automatically
// You can also trigger manual reconnection
await db.reconnect();
```

### Health Monitoring

```typescript
// Check connection health
if (db.isConnected()) {
  console.log("Database is healthy");
} else {
  console.log("Database connection lost");
}
```

## Best Practices

### 1. Connection Management

- Always check connection status before operations
- Handle connection failures gracefully
- Use the `isConnected()` method to verify status

### 2. Error Handling

- Always check the `success` field in `DatabaseResult`
- Log errors for debugging but don't crash the application
- Implement fallback behavior for critical operations

### 3. Performance

- Use batch operations when possible
- Avoid unnecessary subscriptions
- Clean up subscriptions when no longer needed

### 4. Security

- Use environment variables for credentials
- Validate all input data
- Implement proper authentication

## Troubleshooting

### Common Issues

#### Connection Failures

```typescript
// Check environment variables
console.log("URL:", process.env.SURREAL_URL);
console.log("Namespace:", process.env.SURREAL_NAMESPACE);

// Test connection
const connected = await db.connect();
if (!connected) {
  console.error("Failed to connect to SurrealDB");
}
```

#### Authentication Errors

```typescript
// Verify credentials
if (process.env.SURREAL_TOKEN) {
  console.log("Using token authentication");
} else if (process.env.SURREAL_USERNAME && process.env.SURREAL_PASSWORD) {
  console.log("Using username/password authentication");
} else {
  console.error("No authentication method configured");
}
```

#### Live Query Issues

```typescript
// Check if subscription was successful
const subscriptionId = await db.subscribeToGuilds(callback);
if (!subscriptionId) {
  console.error("Failed to subscribe to guild changes");
}
```

## Examples

### Complete Setup Example

```typescript
import { SurrealDBManager } from "./SurrealDBManager";

class Bot {
  private db: SurrealDBManager;

  constructor() {
    this.db = new SurrealDBManager();
  }

  async initialize() {
    // Connect to database
    const connected = await this.db.connect();

    if (connected) {
      console.log("Connected to SurrealDB");

      // Set up live query subscriptions
      await this.setupLiveQueries();
    } else {
      console.log("Continuing without database features");
    }
  }

  private async setupLiveQueries() {
    // Subscribe to guild changes
    await this.db.subscribeToGuilds((action, data) => {
      console.log(`Guild ${action}:`, data);
    });

    // Subscribe to member changes
    await this.db.subscribeToMembers((action, data) => {
      console.log(`Member ${action}:`, data);
    });

    // Subscribe to actions
    await this.db.subscribeToActions((action, data) => {
      if (action === "CREATE") {
        this.handleNewAction(data);
      }
    });
  }

  private handleNewAction(action: SurrealAction) {
    console.log("New action created:", action);
    // Process the action
  }

  async shutdown() {
    await this.db.disconnect();
  }
}
```

### Data Synchronization Example

```typescript
// Sync Discord guild to database
async syncGuild(guild: Guild) {
    const guildData = {
        id: guild.id,
        name: guild.name,
        member_count: guild.memberCount,
        owner_id: guild.ownerId,
        icon: guild.iconURL(),
        features: guild.features,
        created_at: guild.createdAt,
        updated_at: new Date(),
        active: true
    };

    const result = await this.db.upsertGuild(guildData);

    if (result.success) {
        console.log(`Synced guild: ${guild.name}`);
    } else {
        console.error(`Failed to sync guild: ${result.error}`);
    }
}
```

## License

This documentation is part of the Arcados Bot project and follows the same MIT license.
