# Relationship Network Foundation

A comprehensive system for tracking user relationships and calculating affinity scores based on message interaction patterns in Discord guilds.

## Overview

The Relationship Network system analyzes message interactions between users to build a network of relationships ranked by affinity scores. Each member has a `relationship_network` array containing other users sorted by interaction strength, providing rich context for AI-powered user summaries and relationship insights.

## Features

- **Affinity Scoring**: Calculate relationship strength based on message interactions
- **On-demand Computation**: Lazy evaluation of relationships when needed
- **Efficient Queries**: Optimized database queries with proper indexing
- **Extensible Design**: Easy to add new interaction types (voice, reactions, etc.)
- **Caching**: Built-in caching with configurable TTL

## Architecture

### Core Components

1. **RelationshipNetworkManager**: Main service for calculating and managing relationships
2. **SurrealDBManager**: Database operations for relationship data
3. **Schema**: Type definitions and database schema for relationship storage

### Data Flow

```
Message Interactions → Affinity Calculation → Relationship Network → Database Storage
```

## Usage

### Basic Setup

```typescript
import { RelationshipNetworkManager } from "./features/relationship-network/RelationshipNetworkManager";
import { SurrealDBManager } from "./database/SurrealDBManager";

const db = new SurrealDBManager();
await db.connect();

const relationshipManager = new RelationshipNetworkManager(db);
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
relationship_network: array<object> DEFAULT [],
user_synapse: object DEFAULT {},
```

### Message Table Indexes

```sql
DEFINE INDEX idx_messages_guild_author ON messages FIELDS guild_id, author_id;
DEFINE INDEX idx_messages_guild_timestamp ON messages FIELDS guild_id, timestamp;
DEFINE INDEX idx_messages_channel_timestamp ON messages FIELDS channel_id, timestamp;
```

## Configuration

### Affinity Weights

```typescript
const weights = {
  sameChannelMessages: 1, // Base interaction points
  mentions: 2, // Stronger signal
  replies: 3, // Strongest signal
};
```

### Computation Options

```typescript
const options = {
  timeWindowMinutes: 5, // Time window for same-channel interactions
  cacheTTLMinutes: 60, // Cache duration for computed relationships
  minAffinityScore: 1, // Minimum score to include in network
  maxRelationships: 50, // Maximum relationships per user
};
```

## Performance Considerations

- **On-demand Computation**: Relationships are computed only when requested
- **Caching**: Results are cached for 60 minutes by default
- **Efficient Queries**: Database indexes optimize message interaction queries
- **Batch Processing**: Multiple relationships computed in single operation

## Future Enhancements

- **Voice Interactions**: Add voice channel co-presence scoring
- **Reaction Patterns**: Include emoji reactions in affinity calculation
- **Temporal Decay**: Apply time-based decay to older interactions
- **AI Integration**: Populate summary, keywords, and emoji fields
- **Real-time Updates**: Incremental relationship updates on new messages

## Testing

Use the demonstration script to test the system:

```bash
npm run ts-node src/scripts/demonstrate-relationship-network.ts
```

Replace the example guild and user IDs with real values for testing.

## Error Handling

The system includes comprehensive error handling:

- `AffinityCalculationError`: Issues with individual affinity calculations
- `NetworkComputationError`: Problems building complete relationship networks
- Graceful degradation when individual calculations fail
- Detailed logging for debugging and monitoring
