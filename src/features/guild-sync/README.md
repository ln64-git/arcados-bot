# PostgreSQL Guild Sync

This feature allows you to sync your Discord guild data to a PostgreSQL database instead of SurrealDB.

## Setup

### 1. Environment Variables

Add the following to your `.env` file:

```env
# PostgreSQL Database
POSTGRES_URL=postgresql://username:password@localhost:5432/database_name

# Discord Bot (required)
BOT_TOKEN=your_discord_bot_token
GUILD_ID=your_guild_id
```

### 2. Database Schema

The PostgreSQL manager will automatically create the following tables:

- **guilds** - Guild information (name, description, icon, owner, member count)
- **channels** - Channel information (name, type, position, topic, NSFW status)
- **roles** - Role information (name, color, position, permissions)
- **members** - Member information (nickname, join date, roles)
- **messages** - Message information (content, attachments, embeds)

## Usage

### Test PostgreSQL Connection

```bash
npm run test:postgres
```

This will:

- Test the PostgreSQL connection
- Initialize the database schema
- Verify the connection is working

### Sync Guild Data

```bash
npm run sync:guild
```

This will:

- Connect to Discord and PostgreSQL
- Sync all guild data (guild info, channels, roles, members, messages)
- Display progress and statistics
- Show final guild statistics

## Features

### Automatic Schema Creation

The PostgreSQL manager automatically creates all necessary tables and indexes:

```sql
-- Tables created automatically:
CREATE TABLE guilds (...);
CREATE TABLE channels (...);
CREATE TABLE roles (...);
CREATE TABLE members (...);
CREATE TABLE messages (...);

-- Indexes for performance:
CREATE INDEX idx_channels_guild_id ON channels(guild_id);
CREATE INDEX idx_messages_guild_id ON messages(guild_id);
-- ... and more
```

### Data Synchronization

The sync process includes:

1. **Guild Information** - Name, description, icon, owner, member count
2. **Channels** - All text and voice channels with metadata
3. **Roles** - All roles with permissions and properties
4. **Members** - All guild members with roles and join dates
5. **Messages** - All messages from text channels (with rate limiting)

### Error Handling

- Graceful degradation if PostgreSQL is unavailable
- Comprehensive error logging
- Automatic retry for failed operations
- Rate limiting to respect Discord API limits

## Database Schema Details

### Guilds Table

```sql
CREATE TABLE guilds (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    owner_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    member_count INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Channels Table

```sql
CREATE TABLE channels (
    id VARCHAR(20) PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type INTEGER NOT NULL,
    position INTEGER,
    topic TEXT,
    nsfw BOOLEAN DEFAULT false,
    parent_id VARCHAR(20),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Messages Table

```sql
CREATE TABLE messages (
    id VARCHAR(20) PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id VARCHAR(20) NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    edited_at TIMESTAMP WITH TIME ZONE,
    attachments TEXT[],
    embeds TEXT[],
    active BOOLEAN DEFAULT true
);
```

## Troubleshooting

### Connection Issues

1. **Check your POSTGRES_URL format:**

   ```
   postgresql://username:password@host:port/database
   ```

2. **Verify database exists:**

   ```sql
   CREATE DATABASE your_database_name;
   ```

3. **Check permissions:**
   ```sql
   GRANT ALL PRIVILEGES ON DATABASE your_database_name TO your_username;
   ```

### Sync Issues

1. **Check Discord bot permissions:**

   - Bot needs to be in the guild
   - Bot needs appropriate permissions to read channels, members, messages

2. **Rate limiting:**

   - The sync process includes rate limiting
   - Large guilds may take time to sync completely

3. **Memory usage:**
   - For very large guilds, consider running sync during off-peak hours

## API Reference

### PostgreSQLManager

```typescript
const db = new PostgreSQLManager();

// Connect to database
await db.connect();

// Upsert operations
await db.upsertGuild(guildData);
await db.upsertChannel(channelData);
await db.upsertRole(roleData);
await db.upsertMember(memberData);
await db.upsertMessage(messageData);

// Query operations
const result = await db.query("SELECT * FROM guilds WHERE active = true");

// Get guild statistics
const stats = await db.getGuildStats(guildId);

// Disconnect
await db.disconnect();
```

### GuildSyncManager

```typescript
const syncManager = new GuildSyncManager();

// Start full sync
await syncManager.start();

// Get guild statistics
await syncManager.getGuildStats();
```
