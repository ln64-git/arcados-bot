# User and Message Tracking System

This document describes the new user and message tracking system implemented in the Discord bot.

## Features

### 🔹 User Tracking
- **User Join/Leave Detection**: Automatically tracks when users join or leave the server
- **Role Restoration**: When a user rejoins, their previous roles are automatically restored
- **User Data Persistence**: Stores user information including username, avatar, roles, and activity status
- **Role History**: Tracks all role changes with timestamps and reasons

### 🔸 Message Tracking
- **Message Creation**: Logs all new messages with full metadata
- **Message Updates**: Tracks when messages are edited
- **Message Deletion**: Records when messages are deleted
- **Bulk Deletion**: Handles bulk message deletions
- **Message Statistics**: Tracks message counts per user

### 📊 Statistics Command
- **Server Stats**: View total users, active users, and message statistics
- **User Stats**: View individual user statistics including message count and role history
- **Role History**: View detailed role change history for any user

## Database Collections

### Users Collection
```typescript
{
  userId: string;
  username: string;
  discriminator: string;
  avatar?: string;
  guildId: string;
  roles: string[]; // Array of role IDs
  joinedAt: Date;
  leftAt?: Date;
  isActive: boolean;
  lastSeen: Date;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Messages Collection
```typescript
{
  messageId: string;
  userId: string;
  username: string;
  channelId: string;
  channelName: string;
  guildId: string;
  content: string;
  timestamp: Date;
  editedAt?: Date;
  deletedAt?: Date;
  isDeleted: boolean;
  isEdited: boolean;
  attachments: string[];
  embeds: any[];
  reactions: ReactionData[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Role History Collection
```typescript
{
  userId: string;
  guildId: string;
  roleId: string;
  roleName: string;
  action: 'added' | 'removed';
  timestamp: Date;
  reason?: string;
}
```

## Commands

### `/stats server`
View server-wide statistics including:
- Total users vs active users
- Total messages vs deleted messages
- Activity rate percentage

### `/stats user [user]`
View individual user statistics including:
- Message count
- Role count
- Join date and last seen
- Current status (active/left)

### `/stats roles [user]`
View role history for a specific user showing:
- Recent role changes (last 10)
- Timestamps for each change
- Whether roles were added or removed

## Services

### DatabaseService
Central service for all database operations including:
- User CRUD operations
- Message tracking
- Role history management
- Statistics aggregation

### UserTrackingService
Handles user-related events:
- User join/leave detection
- Role change tracking
- Automatic role restoration
- User data updates

### MessageTrackingService
Handles message-related events:
- Message creation/updates/deletions
- Bulk deletion handling
- Message statistics tracking

## Usage

The tracking system is automatically initialized when the bot starts. No additional configuration is required.

### Role Restoration
When a user rejoins the server:
1. The system checks if the user has previous role history
2. Retrieves their last known roles
3. Filters out managed roles and roles the bot can't manage
4. Automatically restores the applicable roles

### Data Persistence
All user and message data is stored in MongoDB collections and persists across bot restarts.

## Environment Variables

Make sure you have the following environment variables set:
- `MONGO_URI`: MongoDB connection string
- `BOT_TOKEN`: Discord bot token
- `GUILD_ID`: (Optional) Guild ID for testing commands

## Error Handling

The system includes comprehensive error handling:
- Database connection errors
- Permission errors for role management
- Missing user data scenarios
- Invalid message data

All errors are logged to the console with appropriate emoji indicators (🔹 for success, 🔸 for warnings, ❌ for errors).
