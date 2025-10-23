# Relationship Network Foundation

A comprehensive system for tracking user relationships and calculating affinity scores based on message interaction patterns in Discord guilds.

## Overview

The Relationship Network system analyzes message interactions between users to build a network of relationships ranked by affinity scores. Each member has a `relationship_network` array containing other users sorted by interaction strength, providing rich context for AI-powered user summaries and relationship insights.

## Features

- **Affinity Scoring**: Calculate relationship strength based on message interactions
- **Simple Computation**: On-demand evaluation of relationships when needed
- **Efficient Queries**: Optimized database queries with proper indexing
- **PostgreSQL Integration**: Native JSONB storage for relationship data

## Architecture

### Core Components

1. **PostgreSQLRelationshipNetworkManager**: Main service for calculating and managing relationships
2. **PostgreSQLManager**: Database operations for relationship data
3. **Schema**: Type definitions and database schema for relationship storage

### Data Flow

```
Message Interactions → Affinity Calculation → Relationship Network → Database Storage
```

## Usage

### Basic Setup

```typescript
import { PostgreSQLRelationshipNetworkManager } from "./features/relationship-network/PostgreSQLRelationshipNetworkManager";
import { PostgreSQLManager } from "./database/PostgreSQLManager";

const db = new PostgreSQLManager();
await db.connect();

const relationshipManager = new PostgreSQLRelationshipNetworkManager(db);
```

### Get Top Relationships

```typescript
// Get top 10 relationships for a user
const relationships = await relationshipManager.getTopRelationships(
  userId,
  guildId,
  10
);

if (relationships.success) {
  relationships.data.forEach((rel, index) => {
    console.log(`${index + 1}. ${rel.user_id}: ${rel.affinity_score} points`);
  });
}
```

### Calculate Affinity Score

```typescript
// Calculate affinity between two specific users
const affinity = await relationshipManager.calculateAffinityScore(
  user1Id,
  user2Id,
  guildId
);

console.log(`Affinity score: ${affinity.score}`);
console.log(`Interactions: ${affinity.interaction_summary.interaction_count}`);
```

### Update Relationships

```typescript
// Manually trigger relationship computation and storage
await relationshipManager.updateMemberRelationships(userId, guildId);
```

## Affinity Scoring Algorithm

### Interaction Types

1. **Same Channel Messages** (1 point)

   - Messages from both users in the same channel within 5-minute windows
   - Base interaction signal

2. **Mentions** (2 points)

   - Messages containing `<@userId>` mentions
   - Stronger signal indicating direct communication

3. **Replies** (3 points)
   - Direct message replies (when Discord reply metadata is available)
   - Strongest signal for conversation flow

### Score Normalization

Affinity scores are normalized using logarithmic scaling:

```
score = min(100, log10(points + 1) * 25)
```

This ensures:

- Scores stay within 0-100 range
- Diminishing returns for very high interaction counts
- Meaningful differentiation between relationship strengths

## Database Schema

### Members Table Extensions

```sql
-- Relationship network (sorted by affinity score descending)
relationship_network JSONB DEFAULT '[]',
summary TEXT,
keywords TEXT[],
emojis TEXT[],
notes TEXT[],
```

### Message Table Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_messages_guild_author ON messages(guild_id, author_id);
CREATE INDEX IF NOT EXISTS idx_messages_guild_timestamp ON messages(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_channel_timestamp ON messages(channel_id, created_at);
```

## Configuration

### Affinity Weights (Fixed)

- Same channel messages: 1 point
- Mentions: 2 points
- Replies: 3 points

### Computation Settings (Fixed)

- Time window: 5 minutes for same-channel interactions
- Maximum relationships: 50 per user
- Minimum affinity score: 0 (only positive scores included)

## Performance Considerations

- **On-demand Computation**: Relationships are computed only when requested
- **Database Storage**: Results are stored in PostgreSQL for persistence
- **Efficient Queries**: Database indexes optimize message interaction queries
- **Simple Algorithm**: Fixed weights and settings for predictable performance

## Future Enhancements

- **Voice Interactions**: Add voice channel co-presence scoring
- **Reaction Patterns**: Include emoji reactions in affinity calculation
- **AI Integration**: Populate summary, keywords, and emoji fields
- **Real-time Updates**: Incremental relationship updates on new messages

## Testing

### PostgreSQL Integration Test

Test the PostgreSQL relationship network integration:

```bash
npm run ts-node src/scripts/test-postgres-relationship-network.ts
```

### Schema Migration

If you have an existing PostgreSQL database, run the migration script to add relationship network fields:

```bash
npm run ts-node src/scripts/migrate-postgres-relationship-schema.ts
```

### Demonstration Script

Use the demonstration script to test the system:

```bash
npm run ts-node src/features/relationship-network/scripts/demonstrate-relationship-network.ts
```

Replace the example guild and user IDs with real values for testing.

## Error Handling

The system includes comprehensive error handling:

- `AffinityCalculationError`: Issues with individual affinity calculations
- `NetworkComputationError`: Problems building complete relationship networks
- Graceful degradation when individual calculations fail
- Detailed logging for debugging and monitoring
