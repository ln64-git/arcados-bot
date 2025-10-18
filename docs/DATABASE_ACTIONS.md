# Database Actions Documentation

## Overview

The `DatabaseActions` class handles database-triggered Discord actions using SurrealDB Live Queries. It provides a comprehensive framework for executing Discord operations based on database changes, enabling powerful integrations with external systems.

## Features

- **Real-time Action Execution**: Immediate Discord actions triggered by database changes
- **Scheduled Actions**: Execute actions at specific times
- **Multiple Action Types**: Support for various Discord operations
- **Error Handling**: Robust error handling with retry capabilities
- **Extensible Framework**: Easy to add new action types
- **Batch Processing**: Efficient handling of multiple pending actions

## Architecture

```
Database Changes → Live Queries → DatabaseActions → Discord API
     ↑                                                      ↓
     ←─────────── Action Results ←──────────────────────────
```

The actions system listens to database changes via Live Queries and executes corresponding Discord operations in real-time.

## Action Types

### 1. Member Role Updates (`member_role_update`)

Updates Discord member roles based on database changes.

**Payload Structure:**

```typescript
{
    guild_id: string;
    user_id: string;
    role_ids: string[];
}
```

**Example:**

```typescript
await actionsManager.createMemberRoleUpdateAction("guild_id", "user_id", [
  "role_id_1",
  "role_id_2",
]);
```

### 2. Member Bans (`member_ban`)

Bans members from Discord based on database records.

**Payload Structure:**

```typescript
{
    guild_id: string;
    user_id: string;
    reason?: string;
}
```

**Example:**

```typescript
await actionsManager.createMemberBanAction(
  "guild_id",
  "user_id",
  "Violation of community guidelines"
);
```

### 3. Scheduled Messages (`scheduled_message`)

Sends messages at specific times or immediately.

**Payload Structure:**

```typescript
{
    channel_id: string;
    content: string;
    embeds?: Record<string, unknown>[];
}
```

**Example:**

```typescript
await actionsManager.createScheduledMessageAction(
  "guild_id",
  "channel_id",
  "🎉 Welcome to our community!",
  new Date("2024-12-25T12:00:00Z")
);
```

### 4. Member Count Milestones (`member_count_milestone`)

Celebrates member count milestones with automatic announcements.

**Payload Structure:**

```typescript
{
    guild_id: string;
    milestone: number;
    channel_id?: string;
}
```

**Example:**

```typescript
await actionsManager.createMilestoneAction(
  "guild_id",
  1000,
  "announcements_channel_id"
);
```

### 5. User XP Threshold (`user_xp_threshold`)

Assigns achievement roles based on XP/points thresholds.

**Payload Structure:**

```typescript
{
  guild_id: string;
  user_id: string;
  role_id: string;
  threshold: number;
}
```

**Example:**

```typescript
await actionsManager.createUserXpThresholdAction(
  "guild_id",
  "user_id",
  "achievement_role_id",
  1000
);
```

### 6. Global Ban Updates (`global_ban_update`)

Applies bans across multiple guilds simultaneously.

**Payload Structure:**

```typescript
{
    user_id: string;
    guild_ids: string[];
    reason?: string;
}
```

**Example:**

```typescript
await actionsManager.createGlobalBanAction(
  "user_id",
  ["guild_id_1", "guild_id_2", "guild_id_3"],
  "Global ban - Database triggered"
);
```

### 7. Custom Actions (`custom_action`)

Extensible framework for custom action types.

**Payload Structure:**

```typescript
Record<string, unknown>; // Flexible payload structure
```

## API Reference

### Core Methods

#### `executeAction(action: SurrealAction): Promise<void>`

Executes a specific action immediately.

```typescript
await actionsManager.executeAction(action);
```

#### `processPendingActions(): Promise<void>`

Processes all pending actions in the database.

```typescript
await actionsManager.processPendingActions();
```

#### `startActionProcessor(intervalMs: number): void`

Starts automatic processing of pending actions at specified intervals.

```typescript
actionsManager.startActionProcessor(30000); // Check every 30 seconds
```

### Action Creation Methods

#### `createMemberRoleUpdateAction(guildId: string, userId: string, roleIds: string[]): Promise<void>`

Creates a member role update action.

```typescript
await actionsManager.createMemberRoleUpdateAction("guild_id", "user_id", [
  "role_id_1",
  "role_id_2",
]);
```

#### `createMemberBanAction(guildId: string, userId: string, reason?: string): Promise<void>`

Creates a member ban action.

```typescript
await actionsManager.createMemberBanAction(
  "guild_id",
  "user_id",
  "Reason for ban"
);
```

#### `createScheduledMessageAction(guildId: string, channelId: string, content: string, executeAt?: Date): Promise<void>`

Creates a scheduled message action.

```typescript
await actionsManager.createScheduledMessageAction(
  "guild_id",
  "channel_id",
  "Message content",
  new Date("2024-12-25T12:00:00Z")
);
```

#### `createMilestoneAction(guildId: string, milestone: number, channelId?: string): Promise<void>`

Creates a milestone celebration action.

```typescript
await actionsManager.createMilestoneAction(
  "guild_id",
  1000,
  "announcements_channel_id"
);
```

#### `createUserXpThresholdAction(guildId: string, userId: string, roleId: string, threshold: number): Promise<void>`

Creates an XP threshold achievement action.

```typescript
await actionsManager.createUserXpThresholdAction(
  "guild_id",
  "user_id",
  "achievement_role_id",
  1000
);
```

#### `createGlobalBanAction(userId: string, guildIds: string[], reason?: string): Promise<void>`

Creates a global ban action.

```typescript
await actionsManager.createGlobalBanAction(
  "user_id",
  ["guild_id_1", "guild_id_2"],
  "Global ban reason"
);
```

## Usage Examples

### Basic Setup

```typescript
import { DatabaseActions } from "./features/discord-sync/actions";
import { SurrealDBManager } from "./database/SurrealDBManager";

const db = new SurrealDBManager();
const actionsManager = new DatabaseActions(client, db);

// Start automatic processing
actionsManager.startActionProcessor(30000);
```

### External Admin Panel Integration

```typescript
// Express.js API endpoint
app.post("/api/member/roles", async (req, res) => {
  const { guildId, userId, roleIds } = req.body;

  try {
    // Update database
    await db.upsertMember({
      id: `${guildId}:${userId}`,
      guild_id: guildId,
      user_id: userId,
      roles: roleIds,
      updated_at: new Date(),
    });

    // Create action to update Discord
    await actionsManager.createMemberRoleUpdateAction(guildId, userId, roleIds);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Automated Moderation

```typescript
// Moderation system integration
class ModerationSystem {
  async banUser(userId: string, reason: string, guildIds: string[]) {
    // Create global ban action
    await actionsManager.createGlobalBanAction(userId, guildIds, reason);

    // Log the action
    console.log(`🔹 Global ban created for user ${userId}: ${reason}`);
  }

  async updateUserRoles(userId: string, guildId: string, roleIds: string[]) {
    // Create role update action
    await actionsManager.createMemberRoleUpdateAction(guildId, userId, roleIds);

    console.log(`🔹 Role update created for user ${userId}`);
  }
}
```

### Milestone Tracking

```typescript
// Member count milestone tracking
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

    console.log(`🔹 Milestone ${milestone} reached in ${guild.name}`);
  }
});
```

### Achievement System

```typescript
// XP/Points achievement system
class AchievementSystem {
  async checkXpThreshold(userId: string, guildId: string, currentXp: number) {
    const thresholds = [
      { xp: 100, roleId: "bronze_role_id" },
      { xp: 500, roleId: "silver_role_id" },
      { xp: 1000, roleId: "gold_role_id" },
      { xp: 2500, roleId: "platinum_role_id" },
    ];

    for (const threshold of thresholds) {
      if (currentXp >= threshold.xp) {
        await actionsManager.createUserXpThresholdAction(
          guildId,
          userId,
          threshold.roleId,
          threshold.xp
        );

        console.log(
          `🔹 XP threshold ${threshold.xp} reached for user ${userId}`
        );
      }
    }
  }
}
```

## Database Schema

### Actions Table

```sql
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

### Creating Actions Manually

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

## Error Handling

### Action Execution Errors

```typescript
async executeAction(action: SurrealAction): Promise<void> {
    try {
        const handler = this.actionHandlers.get(action.type as ActionType);

        if (!handler) {
            console.error(`🔸 No handler found for action type: ${action.type}`);
            return;
        }

        await handler(action.payload);

        // Mark action as executed
        await this.db.markActionExecuted(action.id);
        console.log(`🔹 Executed action ${action.id} of type ${action.type}`);
    } catch (error) {
        console.error(`🔸 Failed to execute action ${action.id}:`, error);
        // Action remains in pending state for retry
    }
}
```

### Retry Logic

```typescript
// Failed actions remain in pending state
const pendingActions = await db.getPendingActions();
if (pendingActions.success) {
  const failedActions = pendingActions.data.filter(
    (action) => !action.executed
  );
  console.log(`${failedActions.length} actions need retry`);
}
```

## Performance Considerations

### Batch Processing

```typescript
async processPendingActions(): Promise<void> {
    const result = await this.db.getPendingActions();

    if (result.success && result.data) {
        const now = new Date();
        const actionsToExecute = result.data.filter(
            action => !action.executed && (!action.execute_at || action.execute_at <= now)
        );


        console.log(`🔹 Processing ${actionsToExecute.length} pending actions`);

        // Process actions in parallel where safe
        await Promise.all(
            actionsToExecute.map(action => this.executeAction(action))
        );
    }
}
```

### Rate Limiting

```typescript
// Respect Discord API rate limits
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Add delays between operations
await member.roles.add(rolesToAdd);
await delay(100); // 100ms delay
await member.roles.remove(rolesToRemove);
```

## Best Practices

### 1. Action Design

- **Idempotent Actions**: Design actions to be safely retryable
- **Error Handling**: Always include proper error handling
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

#### Actions Not Executing

```typescript
// Check action status
const action = await db.getAction("action_id");
if (action.success) {
  console.log("Action executed:", action.data.executed);
  console.log("Execute at:", action.data.execute_at);
}
```

#### Permission Errors

```typescript
// Check bot permissions
const guild = await client.guilds.fetch("guild_id");
const botMember = guild.members.me;
const hasPermission = botMember?.permissions.has("MANAGE_ROLES");

if (!hasPermission) {
  console.error("Bot lacks MANAGE_ROLES permission");
}
```

#### Rate Limit Issues

```typescript
// Monitor rate limits
client.on("rateLimit", (rateLimitData) => {
  console.log("Rate limit hit:", rateLimitData);
});
```

### Debug Mode

```typescript
// Enable debug logging
process.env.LOG_LEVEL = "debug";

// The actions manager will log detailed information
```

## Extending the Framework

### Adding Custom Action Types

```typescript
// Extend the DatabaseActions class
class CustomDatabaseActions extends DatabaseActions {
  constructor(client: Client, db: SurrealDBManager) {
    super(client, db);
    this.setupCustomActionHandlers();
  }

  private setupCustomActionHandlers(): void {
    // Add custom action handler
    this.actionHandlers.set("custom_action", async (payload) => {
      console.log("Custom action triggered:", payload);
      // Implement custom logic
    });
  }

  // Add custom action creation method
  async createCustomAction(guildId: string, customData: any): Promise<void> {
    const action = {
      guild_id: guildId,
      type: "custom_action" as ActionType,
      payload: customData,
    };

    await this.db.createAction(action);
  }
}
```

## License

This documentation is part of the Arcados Bot project and follows the same MIT license.
