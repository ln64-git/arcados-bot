# SurrealDB Integration Documentation

## Overview

The SurrealDB integration provides real-time, bidirectional synchronization between Discord servers and a SurrealDB database. This enables powerful features like external admin panels, automated actions, milestone tracking, and cross-guild data management.

## Features

### 🔄 Real-time Synchronization

- **Discord → Database**: All Discord events (guilds, channels, members, roles, messages) are automatically synced to SurrealDB
- **Database → Discord**: Database changes trigger immediate Discord actions via Live Queries
- **WebSocket Communication**: Low-latency, efficient real-time updates

### 🎯 Database-Triggered Actions

- **Member Role Updates**: External systems can update Discord roles
- **Member Bans**: Database ban records automatically apply Discord bans
- **Scheduled Messages**: Post messages at specific times
- **Milestone Celebrations**: Automatic announcements for member count milestones
- **Achievement Roles**: Assign roles based on XP/points thresholds
- **Global Ban Enforcement**: Apply bans across multiple guilds simultaneously

### 🛡️ Graceful Degradation

- Bot continues functioning if SurrealDB is unavailable
- All Discord features work without database connection
- Automatic reconnection with exponential backoff
- Comprehensive error handling and logging

## Setup

### 1. SurrealDB Cloud Configuration

1. **Sign up for SurrealDB Cloud**:

   - Visit [SurrealDB Cloud](https://surrealdb.com/cloud)
   - Create a new project
   - Note your connection details

2. **Configure Environment Variables**:

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

### 2. Database Schema

The integration automatically creates the following tables:

```sql
-- Guilds table
DEFINE TABLE guilds SCHEMAFULL;
DEFINE FIELD id ON guilds TYPE string;
DEFINE FIELD name ON guilds TYPE string;
DEFINE FIELD member_count ON guilds TYPE int;
DEFINE FIELD owner_id ON guilds TYPE string;
DEFINE FIELD icon ON guilds TYPE string;
DEFINE FIELD features ON guilds TYPE array;
DEFINE FIELD created_at ON guilds TYPE datetime;
DEFINE FIELD updated_at ON guilds TYPE datetime;
DEFINE FIELD active ON guilds TYPE bool DEFAULT true;
DEFINE FIELD settings ON guilds TYPE object DEFAULT {};

-- Channels table
DEFINE TABLE channels SCHEMAFULL;
DEFINE FIELD id ON channels TYPE string;
DEFINE FIELD guild_id ON channels TYPE string;
DEFINE FIELD name ON channels TYPE string;
DEFINE FIELD type ON channels TYPE string;
DEFINE FIELD position ON channels TYPE int;
DEFINE FIELD parent_id ON channels TYPE string;
DEFINE FIELD topic ON channels TYPE string;
DEFINE FIELD nsfw ON channels TYPE bool;
DEFINE FIELD created_at ON channels TYPE datetime;
DEFINE FIELD updated_at ON channels TYPE datetime;
DEFINE FIELD active ON channels TYPE bool DEFAULT true;

-- Members table
DEFINE TABLE members SCHEMAFULL;
DEFINE FIELD id ON members TYPE string;
DEFINE FIELD guild_id ON members TYPE string;
DEFINE FIELD user_id ON members TYPE string;
DEFINE FIELD username ON members TYPE string;
DEFINE FIELD display_name ON members TYPE string;
DEFINE FIELD joined_at ON members TYPE datetime;
DEFINE FIELD roles ON members TYPE array;
DEFINE FIELD avatar ON members TYPE string;
DEFINE FIELD created_at ON members TYPE datetime;
DEFINE FIELD updated_at ON members TYPE datetime;
DEFINE FIELD active ON members TYPE bool DEFAULT true;

-- Roles table
DEFINE TABLE roles SCHEMAFULL;
DEFINE FIELD id ON roles TYPE string;
DEFINE FIELD guild_id ON roles TYPE string;
DEFINE FIELD name ON roles TYPE string;
DEFINE FIELD color ON roles TYPE int;
DEFINE FIELD position ON roles TYPE int;
DEFINE FIELD permissions ON roles TYPE string;
DEFINE FIELD mentionable ON roles TYPE bool;
DEFINE FIELD created_at ON roles TYPE datetime;
DEFINE FIELD updated_at ON roles TYPE datetime;
DEFINE FIELD active ON roles TYPE bool DEFAULT true;

-- Messages table
DEFINE TABLE messages SCHEMAFULL;
DEFINE FIELD id ON messages TYPE string;
DEFINE FIELD channel_id ON messages TYPE string;
DEFINE FIELD guild_id ON messages TYPE string;
DEFINE FIELD author_id ON messages TYPE string;
DEFINE FIELD content ON messages TYPE string;
DEFINE FIELD timestamp ON messages TYPE datetime;
DEFINE FIELD attachments ON messages TYPE array;
DEFINE FIELD embeds ON messages TYPE array;
DEFINE FIELD created_at ON messages TYPE datetime;
DEFINE FIELD updated_at ON messages TYPE datetime;
DEFINE FIELD active ON messages TYPE bool DEFAULT true;

-- Actions table
DEFINE TABLE actions SCHEMAFULL;
DEFINE FIELD id ON actions TYPE string;
DEFINE FIELD guild_id ON actions TYPE string;
DEFINE FIELD type ON actions TYPE string;
DEFINE FIELD payload ON actions TYPE object;
DEFINE FIELD executed ON actions TYPE bool DEFAULT false;
DEFINE FIELD execute_at ON actions TYPE datetime;
DEFINE FIELD created_at ON actions TYPE datetime;
DEFINE FIELD updated_at ON actions TYPE datetime;
DEFINE FIELD active ON actions TYPE bool DEFAULT true;
```

## Usage

### Database Actions

#### 1. Member Role Updates

Update Discord member roles from external systems:

```typescript
// Create a role update action
await actionsManager.createMemberRoleUpdateAction(
  "guild_id_here",
  "user_id_here",
  ["role_id_1", "role_id_2"]
);
```

#### 2. Member Bans

Ban members from Discord based on database records:

```typescript
// Create a ban action
await actionsManager.createMemberBanAction(
  "guild_id_here",
  "user_id_here",
  "Reason for ban"
);
```

#### 3. Scheduled Messages

Send messages at specific times:

```typescript
// Create a scheduled message
await actionsManager.createScheduledMessageAction(
  "guild_id_here",
  "channel_id_here",
  "This is a scheduled message!",
  new Date("2024-12-25T12:00:00Z") // Christmas message
);
```

#### 4. Milestone Celebrations

Automatically celebrate member count milestones:

```typescript
// Create a milestone action
await actionsManager.createMilestoneAction(
  "guild_id_here",
  1000, // 1000th member milestone
  "announcements_channel_id" // Optional channel
);
```

#### 5. Achievement Roles

Assign roles based on XP/points thresholds:

```typescript
// Create an XP threshold action
await actionsManager.createUserXpThresholdAction(
  "guild_id_here",
  "user_id_here",
  "achievement_role_id",
  1000 // 1000 XP threshold
);
```

#### 6. Global Bans

Apply bans across multiple guilds:

```typescript
// Create a global ban action
await actionsManager.createGlobalBanAction(
  "user_id_here",
  ["guild_id_1", "guild_id_2", "guild_id_3"],
  "Global ban reason"
);
```

### Direct Database Operations

#### Creating Actions Manually

You can also create actions directly in the database:

```sql
-- Create a member role update action
CREATE actions:role_update_001 SET
    guild_id = "guild_id_here",
    type = "member_role_update",
    payload = {
        guild_id: "guild_id_here",
        user_id: "user_id_here",
        role_ids: ["role_id_1", "role_id_2"]
    },
    executed = false,
    active = true;

-- Create a scheduled message action
CREATE actions:announcement_001 SET
    guild_id = "guild_id_here",
    type = "scheduled_message",
    payload = {
        channel_id: "channel_id_here",
        content: "🎉 Welcome to our community!",
        embeds: []
    },
    execute_at = "2024-12-25T12:00:00Z",
    executed = false,
    active = true;
```

### Live Query Subscriptions

The bot automatically subscribes to database changes:

```typescript
// Guild changes
await surrealManager.subscribeToGuilds((action, data) => {
  console.log(`Guild ${action}:`, data);
});

// Member changes
await surrealManager.subscribeToMembers((action, data) => {
  console.log(`Member ${action}:`, data);
});

// Action changes (triggers Discord actions)
await surrealManager.subscribeToActions((action, data) => {
  if (action === "CREATE") {
    // Execute the action immediately
    actionsManager.executeAction(data);
  }
});
```

## API Reference

### SurrealDBManager

#### Connection Management

```typescript
// Connect to SurrealDB
await surrealManager.connect(): Promise<boolean>

// Disconnect from SurrealDB
await surrealManager.disconnect(): Promise<void>

// Check connection status
surrealManager.isConnected(): boolean

// Reconnect with exponential backoff
await surrealManager.reconnect(): Promise<void>
```

#### CRUD Operations

```typescript
// Guild operations
await surrealManager.upsertGuild(guild: Partial<SurrealGuild>): Promise<DatabaseResult<SurrealGuild>>
await surrealManager.getGuild(guildId: string): Promise<DatabaseResult<SurrealGuild>>
await surrealManager.getAllGuilds(): Promise<DatabaseResult<SurrealGuild[]>>

// Channel operations
await surrealManager.upsertChannel(channel: Partial<SurrealChannel>): Promise<DatabaseResult<SurrealChannel>>
await surrealManager.getChannelsByGuild(guildId: string): Promise<DatabaseResult<SurrealChannel[]>>

// Member operations
await surrealManager.upsertMember(member: Partial<SurrealMember>): Promise<DatabaseResult<SurrealMember>>
await surrealManager.getMembersByGuild(guildId: string): Promise<DatabaseResult<SurrealMember[]>>

// Role operations
await surrealManager.upsertRole(role: Partial<SurrealRole>): Promise<DatabaseResult<SurrealRole>>
await surrealManager.getRolesByGuild(guildId: string): Promise<DatabaseResult<SurrealRole[]>>

// Message operations
await surrealManager.upsertMessage(message: Partial<SurrealMessage>): Promise<DatabaseResult<SurrealMessage>>

// Action operations
await surrealManager.createAction(action: Partial<SurrealAction>): Promise<DatabaseResult<SurrealAction>>
await surrealManager.getPendingActions(): Promise<DatabaseResult<SurrealAction[]>>
await surrealManager.markActionExecuted(actionId: string): Promise<DatabaseResult<SurrealAction>>
```

### DatabaseActions

#### Action Execution

```typescript
// Execute a specific action
await actionsManager.executeAction(action: SurrealAction): Promise<void>

// Process all pending actions
await actionsManager.processPendingActions(): Promise<void>

// Start automatic action processor
actionsManager.startActionProcessor(intervalMs: number): void
```

#### Action Creation Utilities

```typescript
// Member role update
await actionsManager.createMemberRoleUpdateAction(guildId: string, userId: string, roleIds: string[]): Promise<void>

// Member ban
await actionsManager.createMemberBanAction(guildId: string, userId: string, reason?: string): Promise<void>

// Scheduled message
await actionsManager.createScheduledMessageAction(guildId: string, channelId: string, content: string, executeAt?: Date): Promise<void>

// Milestone celebration
await actionsManager.createMilestoneAction(guildId: string, milestone: number, channelId?: string): Promise<void>

// XP threshold achievement
await actionsManager.createUserXpThresholdAction(guildId: string, userId: string, roleId: string, threshold: number): Promise<void>

// Global ban
await actionsManager.createGlobalBanAction(userId: string, guildIds: string[], reason?: string): Promise<void>
```

## Error Handling

### Connection Issues

- **Automatic Reconnection**: Exponential backoff retry mechanism
- **Graceful Degradation**: Bot continues without database features
- **Health Monitoring**: Continuous connection status tracking

### Action Failures

- **Error Logging**: Comprehensive error messages with context
- **Retry Logic**: Failed actions can be retried manually
- **Fallback Behavior**: Bot continues operating despite action failures

### Example Error Handling

```typescript
try {
  await actionsManager.executeAction(action);
} catch (error) {
  console.error("🔸 Action execution failed:", error);
  // Action remains in pending state for retry
}
```

## Monitoring and Debugging

### Logging

The integration provides comprehensive logging with emoji indicators:

- 🔹 **Success**: Successful operations
- 🔸 **Error**: Failed operations or errors
- 🔄 **Sync**: Synchronization events
- ⚡ **Action**: Database-triggered actions

### Health Checks

```typescript
// Check database connection
if (surrealManager.isConnected()) {
  console.log("🔹 Database connected");
} else {
  console.log("🔸 Database disconnected");
}

// Check pending actions
const pendingActions = await surrealManager.getPendingActions();
if (pendingActions.success) {
  console.log(`🔹 ${pendingActions.data.length} pending actions`);
}
```

## Best Practices

### 1. Action Design

- **Idempotent Actions**: Design actions to be safely retryable
- **Error Handling**: Always include proper error handling in custom actions
- **Payload Validation**: Validate action payloads before execution

### 2. Performance

- **Batch Operations**: Group related actions when possible
- **Rate Limiting**: Respect Discord API rate limits
- **Connection Pooling**: Use connection pooling for high-traffic applications

### 3. Security

- **Input Validation**: Validate all inputs from external sources
- **Permission Checks**: Verify bot permissions before executing actions
- **Audit Logging**: Log all database-triggered actions for audit trails

### 4. Monitoring

- **Health Checks**: Implement regular health checks
- **Metrics Collection**: Track action success/failure rates
- **Alert Systems**: Set up alerts for critical failures

## Troubleshooting

### Common Issues

#### 1. Connection Failures

```bash
# Check environment variables
echo $SURREAL_URL
echo $SURREAL_USERNAME
echo $SURREAL_PASSWORD

# Test connection manually
node -e "
const { Surreal } = require('surrealdb.js');
const db = new Surreal();
db.connect('$SURREAL_URL').then(() => console.log('Connected')).catch(console.error);
"
```

#### 2. Action Not Executing

- Check if action is marked as `executed = false`
- Verify `execute_at` timestamp is in the past
- Ensure action is marked as `active = true`
- Check bot permissions in the target guild

#### 3. Sync Issues

- Verify bot has necessary permissions in all guilds
- Check for rate limiting on Discord API
- Monitor database connection status

### Debug Mode

Enable debug logging by setting the log level:

```typescript
// In your bot configuration
process.env.LOG_LEVEL = "debug";
```

## Examples

### External Admin Panel Integration

```typescript
// Example: External admin panel updates member roles
app.post("/api/member/roles", async (req, res) => {
  const { guildId, userId, roleIds } = req.body;

  // Update database
  await surrealManager.upsertMember({
    id: `${guildId}:${userId}`,
    guild_id: guildId,
    user_id: userId,
    roles: roleIds,
    updated_at: new Date(),
  });

  // Create action to update Discord
  await actionsManager.createMemberRoleUpdateAction(guildId, userId, roleIds);

  res.json({ success: true });
});
```

### Automated Moderation

```typescript
// Example: Automated moderation based on database records
app.post("/api/moderation/ban", async (req, res) => {
  const { userId, reason, guildIds } = req.body;

  // Create global ban action
  await actionsManager.createGlobalBanAction(userId, guildIds, reason);

  res.json({ success: true });
});
```

### Milestone Tracking

```typescript
// Example: Track member count milestones
client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;
  const memberCount = guild.memberCount;

  // Check for milestones
  const milestones = [100, 500, 1000, 2500, 5000, 10000];
  const milestone = milestones.find((m) => memberCount === m);

  if (milestone) {
    await actionsManager.createMilestoneAction(
      guild.id,
      milestone,
      guild.systemChannelId
    );
  }
});
```

## Support

For issues, questions, or contributions:

1. **GitHub Issues**: Report bugs and feature requests
2. **Discord Community**: Join the SurrealDB Discord for support
3. **Documentation**: Check the [SurrealDB Documentation](https://surrealdb.com/docs)

## License

This integration is part of the Arcados Bot project and follows the same MIT license.
