# Arcados Bot - Data Workflow

## Quick Start: Regenerate Everything

To regenerate all data from scratch for a guild:

```bash
# 1. Sync all channel messages (captures replies, mentions, etc.)
npm run sync:channel <channel_id>  # Repeat for each important channel
# OR sync entire guild (if you have a guild sync script)

# 2. Regenerate relationships from synced messages
npm run regenerate:relationships <guild_id>

# 3. Regenerate conversation segments
npm run regenerate:conversations <guild_id>

# 4. (Optional) Generate embeddings for semantic search
npm run generate:embeddings <guild_id>
```

## Core Workflows

### 1. Initial Setup / Full Sync

When setting up a new guild or doing a complete refresh:

```bash
# Sync specific channel (recommended for targeted sync)
npm run sync:channel 1287319376462348310

# Regenerate relationships (analyzes mentions, replies, reactions)
npm run regenerate:relationships 1254694808228986912

# Regenerate conversations (groups messages into conversation segments)
npm run regenerate:conversations 1254694808228986912

# Generate embeddings (for semantic similarity)
npm run generate:embeddings 1254694808228986912
```

### 2. Incremental Updates

For ongoing operation, the bot automatically:
- Syncs new messages as they arrive (real-time)
- Updates relationships incrementally
- Creates new conversation segments

### 3. Analysis & Diagnostics

Analyze the generated data:

```bash
# Deep relationship network analysis
npm run analyze:relationships <guild_id>
# Shows: interaction stats, top users, strongest pairs, reciprocity, distribution

# Conversation segments analysis
npm run analyze:conversations <guild_id>
# Shows: segment stats, size/duration distribution, channel activity, hourly patterns

# Individual user analysis
npm run analyze:user <guild_id> <user_id_or_username>
# Shows: message stats, top channels, relationships, activity patterns

# Quick views
npm run view:relationships <guild_id>  # Top relationships
npm run view:recent <guild_id>         # Recent messages
npm run identify:bots <guild_id>       # Find bot user IDs
```

### 4. Maintenance

Cleanup and optimization:

```bash
# Clean up bot command messages from segments
npm run clean:segments <guild_id>

# Consolidate duplicate/overlapping segments
npm run consolidate:segments <guild_id>
```

### 5. Emergency Reset

**⚠️ DANGER: These commands delete data!**

```bash
# Recreate database schema (drops all tables)
npm run recreate:schema

# Drop all data for all guilds
npm run drop:all
```

## Data Flow

```
Discord Messages
      ↓
sync:channel (captures message data + references)
      ↓
PostgreSQL messages table
      ↓
      ├→ regenerate:relationships → relationship_edges table
      │
      └→ regenerate:conversations → conversation_segments table
            ↓
      generate:embeddings → message embeddings
```

## Script Categories

### Essential
- `sync:channel` - Sync channel messages with reply references
- `regenerate:relationships` - Build relationship network
- `regenerate:conversations` - Create conversation segments
- `generate:embeddings` - Generate message embeddings

### Diagnostic
- `test:relationships` - View relationship stats
- `view:recent` - View recent messages
- `identify:bots` - Find bot user IDs

### Maintenance
- `clean:segments` - Remove bot commands from segments
- `consolidate:segments` - Merge duplicate segments
- `recreate:schema` - Reset database (⚠️ DANGER)
- `drop:all` - Delete all data (⚠️ DANGER)
