# Social Intelligence System

## What is this?

The **Social Intelligence System** is the core data intelligence layer that transforms raw Discord interactions into structured, queryable relationship and conversation insights. It's **not** an AI assistant - it's the foundation that feeds the AI assistant with rich social context.

Think of it as a "social graph engine" that continuously analyzes:
- **Who talks to whom** (relationship mapping)
- **What conversations happened** (conversation detection)
- **What conversations are about** (semantic analysis)
- **How to enrich user profiles** (enrichment pipeline)

## Architecture Overview

```
Discord Message
    ↓
[LiveEventSync]
    ↓
┌─────────────────────────────────────────────────────┐
│         SOCIAL INTELLIGENCE SYSTEM                  │
│                                                     │
│  ┌───────────────────┐  ┌──────────────────────┐  │
│  │ Relationship      │  │ Conversation         │  │
│  │ Mapping           │  │ Detection            │  │
│  │                   │  │                      │  │
│  │ • Track edges     │  │ • Buffer messages    │  │
│  │ • Calculate       │  │ • Multi-strategy     │  │
│  │   affinity        │  │   grouping           │  │
│  │ • Rollup to       │  │ • Create streaming   │  │
│  │   JSONB           │  │   conversations      │  │
│  └───────────────────┘  └──────────────────────┘  │
│           │                      │                  │
│           └──────────┬───────────┘                  │
│                      ▼                              │
│           ┌──────────────────────┐                 │
│           │ Semantic Analysis     │                 │
│           │                       │                 │
│           │ • Extract keywords    │                 │
│           │ • Generate embeddings │                 │
│           │ • Label topics (AI)   │                 │
│           └──────────────────────┘                 │
│                      │                              │
│                      ▼                              │
│           ┌──────────────────────┐                 │
│           │ Enrichment Pipeline   │                 │
│           │                       │                 │
│           │ • Full keyword        │                 │
│           │   extraction (hybrid) │                 │
│           │ • AI topic labeling   │                 │
│           │ • Profile updates     │                 │
│           └──────────────────────┘                 │
│                      │                              │
└──────────────────────┼──────────────────────────────┘
                       ▼
             [PostgreSQL Storage]
                 │           │
                 ▼           ▼
     streaming_conversations  conversation_segments
     relationship_edges       members.relationship_network
                       │
                       ▼
            [AI Assistant Queries]
```

## Key Components

### 1. **Conversation Detection**

**Location**: `conversation-detection/`

**Purpose**: Identify which messages belong together as conversations

**How it works**:
1. **Message Buffering**: LiveEventSync sends messages to `ConversationDetector`
2. **Immediate Streaming**: On 2+ messages, create `streaming_conversation` (queryable immediately!)
3. **Multi-Strategy Grouping**: Apply 5 strategies to group messages:
   - **ReplyChainStrategy** (Priority 1): Follow explicit reply chains
   - **MentionStrategy** (Priority 2): Group @mentions within 10-min window
   - **SemanticStrategy** (Priority 3): Use embeddings + relationship scores
   - **ProximityStrategy** (Priority 4): Temporal clustering fallback
   - **TopicContinuityStrategy** (Post-processor): Merge fragmented topics
4. **Finalization Trigger**: 10-min inactivity OR 50-message buffer
5. **Storage**: Migrate `streaming_conversation` → `conversation_segments`

**Key Files**:
- `ConversationDetector.ts` - Main orchestrator
- `MessageBuffer.ts` - Per-channel buffering
- `ConversationGrouper.ts` - Multi-strategy coordinator
- `ConversationScorer.ts` - Weighted scoring (relationships 45%, semantics 25%, time 20%, keywords 10%)
- `ConversationValidator.ts` - Constraints (min 3 messages, max 24h duration, max 8h gap)
- `strategies/*.ts` - 5 grouping strategies

**Data Flow**:
```
Message → Buffer → [2 messages] → Create Streaming → Preliminary Keywords
                        ↓
                [10-min timeout]
                        ↓
                Multi-Strategy Grouping → Validation → Full Enrichment
                        ↓
                Finalized Conversation (stored in conversation_segments)
```

---

### 2. **Semantic Analysis**

**Location**: `semantic-analysis/`

**Purpose**: Understand what conversations are about

**How it works**:
1. **Keyword Extraction**: Three methods
   - **TF-IDF**: Uses guild-specific vocabulary (IDF scores from `guild_vocabulary` table)
   - **Semantic**: Cluster terms by semantic similarity
   - **Hybrid** (default): 70% TF-IDF + 30% semantic
2. **Embedding Generation**: 768-dim vectors via `Xenova/all-mpnet-base-v2` (local inference)
3. **Topic Labeling**: AI-generated 2-5 word labels (Grok), fallback to keywords
4. **Topic Drift Detection**: Detect when conversation topic changes significantly

**Key Files**:
- `SemanticAnalyzer.ts` - Main orchestrator
- `KeywordExtractor.ts` - Hybrid extraction coordinator
- `TFIDFExtractor.ts` - TF-IDF implementation
- `SemanticKeywordExtractor.ts` - Semantic clustering
- `VocabularyBuilder.ts` - Build guild IDF vocabulary
- `EmbeddingService.ts` - Local transformer model (singleton)
- `TopicDriftDetector.ts` - Detect topic changes

**Extraction Timing**:
- **Preliminary Keywords** (streaming): Fast TF-IDF only (<5 seconds)
- **Full Keywords** (finalized): Hybrid TF-IDF + semantic (10 minutes)

**Data Flow**:
```
Streaming Conversation → Quick TF-IDF → preliminary_keywords (JSONB)
                              ↓
                      [10-min finalization]
                              ↓
                  Hybrid Keywords + Embeddings
                              ↓
                  features.keywords (JSONB)
```

---

### 3. **Relationship Mapping**

**Location**: `relationship-mapping/`

**Purpose**: Track who interacts with whom and calculate affinity scores

**How it works**:
1. **Real-time Edge Tracking**: LiveEventSync records all interactions
   - Mention: +2 points
   - Reply: +3 points
   - Reaction: +1 point
   - Proximity (same channel, 30s window): +1 point
2. **Batched Rollup**: Every 30 seconds OR 50 interactions
   - Aggregate edges → Calculate affinity → Update `members.relationship_network` JSONB
3. **Live View** (NEW): `relationship_network_live` prioritizes fresh data
   - If edges modified <30s ago: rebuild from raw edges (real-time)
   - Else: use cached JSONB (performance)

**Affinity Calculation**:
```typescript
affinity = (
  conversation_points +  // Shared conversation segments
  message_points +       // Time-windowed interactions (5-min clusters)
  bonus_points           // Mentions, replies, name usage
) / user_total_interactions * 100
```

**Key Files**:
- `RelationshipMapper.ts` - Main orchestrator
- `InteractionTracker.ts` - Real-time edge updates
- `AffinityCalculator.ts` - Scoring logic
- `NetworkAggregator.ts` - Rollup to JSONB

**Data Flow**:
```
Message with @mention → InteractionTracker.recordInteraction()
                              ↓
                  Increment relationship_edges counters
                              ↓
                      [30s rollup trigger]
                              ↓
                  AffinityCalculator.calculateAllAffinity()
                              ↓
            Update members.relationship_network JSONB
                              ↓
      AI tools query relationship_network_live VIEW (prioritizes fresh data)
```

---

### 4. **Enrichment Pipeline**

**Location**: `enrichment-pipeline/`

**Purpose**: Post-process conversations and profiles with AI-generated insights

**How it works**:
1. **Conversation Enrichment**: Add AI topic labels, summaries (future)
2. **Profile Enrichment**: Update user profiles with keywords, conversation history
3. **Rate Limiting**: 15 calls/minute (Gemini free tier)

**Key Files**:
- `EnrichmentOrchestrator.ts` - Main coordinator
- `ConversationEnricher.ts` - Add labels, summaries
- `ProfileEnricher.ts` - Update user profiles

**Data Flow**:
```
Finalized Conversation → ConversationEnricher.enrich()
                              ↓
      ProfileEnricher.updateUserProfile()
                              ↓
   Update members table (keywords, relationship network summary)
```

---

### 5. **Storage Layer**

**Location**: `storage/`

**Purpose**: Data access layer for all PostgreSQL operations

**Key Files**:
- `ConversationStore.ts` - streaming_conversations + conversation_segments operations
- `RelationshipStore.ts` - relationship_edges operations
- `ProfileStore.ts` - members operations
- `VocabularyStore.ts` - guild_vocabulary operations

**Key Tables**:

**streaming_conversations** (NEW - real-time queryable)
```sql
id, guild_id, channel_id, participants[], message_ids[],
start_time, last_activity, status,
preliminary_keywords (JSONB), preliminary_embedding (FLOAT[])
```

**conversation_segments** (finalized conversations)
```sql
id, guild_id, channel_id, participants[], message_ids[],
start_time, end_time, status, features (JSONB), summary
```

**relationship_edges** (raw interaction counts)
```sql
guild_id, user_a, user_b,
msg_a_to_b, msg_b_to_a, mentions, replies, reactions,
rolling_7d, rolling_30d, total, last_interaction
```

**members.relationship_network** (aggregated JSONB)
```json
[
  {
    "user_id": "xyz",
    "raw_points": 150,
    "relevance_percentage": 15.2,
    "conversations": [...]
  }
]
```

**Key Views**:

**relationship_network_live** (NEW - eliminates 30s lag)
```sql
-- Prioritizes fresh raw edges over cached JSONB
-- AI tools should query this view instead of members.relationship_network
```

**conversations_unified** (NEW - combines streaming + finalized)
```sql
-- Returns both active (streaming) and finalized conversations
-- AI tools should query this view instead of conversation_segments
```

---

## Integration with AI Assistant

The AI Assistant queries Social Intelligence data via `DatabaseTools`:

**Query Conversations**:
```typescript
// OLD: Only finalized conversations (10-min lag)
const conversations = await db.query("SELECT * FROM conversation_segments WHERE ...");

// NEW: Both streaming + finalized (real-time)
const conversations = await socialIntelligence.getConversations(channelId, {
  includeStreaming: true,  // Include active conversations
  includeFinalized: true,  // Include finalized conversations
});
```

**Query Relationships**:
```typescript
// OLD: Cached JSONB (30s lag)
const relationships = await db.query("SELECT relationship_network FROM members WHERE ...");

// NEW: Live view (prioritizes fresh data)
const relationships = await socialIntelligence.getRelationships(userId, guildId);
// Internally queries relationship_network_live VIEW
```

**Semantic Search**:
```typescript
// Search conversations by topic/keywords
const results = await socialIntelligence.searchConversationsByTopic("game night", guildId);
// Uses embedding cosine similarity + keyword matching
```

---

## Performance Characteristics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Conversation Lag** | 10-20 min | <1 second | 600-1200x faster |
| **Relationship Lag** | 30 seconds | <1 second | 30x faster |
| **Keyword Lag** | 10-20 min | <5 seconds (preliminary) | 120-240x faster |
| **Memory Overhead** | ~40MB | ~50MB | +25% |
| **DB Write Load** | 100% | 110% | +10% (streaming table) |
| **Query Latency** | 50-200ms | 50-200ms | No change (views use indexes) |

---

## Usage Examples

### For Bot Developers

**Initialize Social Intelligence**:
```typescript
import { SocialIntelligence } from "./features/social-intelligence";

const socialIntelligence = new SocialIntelligence(postgresManager);

// Called by LiveEventSync
await socialIntelligence.processMessage(message);
```

**Query from AI Tools**:
```typescript
// Get all conversations in a channel (including active ones)
const conversations = await socialIntelligence.getConversations(channelId, {
  includeStreaming: true,
  minMessages: 3,
});

// Get user's relationships (live data)
const relationships = await socialIntelligence.getRelationships(userId, guildId);

// Search conversations by topic
const results = await socialIntelligence.searchConversationsByTopic(
  "minecraft server",
  guildId,
  { minSimilarity: 0.4, limit: 10 }
);
```

---

## Migration from Old Structure

**Old Locations** → **New Locations**:

```
relationship-network/ConversationManager.ts
  → conversation-detection/ConversationDetector.ts

relationship-network/NetworkManager.ts
  → relationship-mapping/RelationshipMapper.ts

keywords/KeywordExtractor.ts
  → semantic-analysis/KeywordExtractor.ts

embeddings/EmbeddingService.ts
  → semantic-analysis/EmbeddingService.ts
```

**Database Changes**:
- Added `streaming_conversations` table
- Added `relationship_network_live` view
- Added `conversations_unified` view

**No Breaking Changes**: Existing `conversation_segments` and `relationship_edges` tables unchanged.

---

## Future Enhancements

1. **Real-time Summaries**: Generate AI summaries incrementally (not just at finalization)
2. **Conversation Threading**: Better handle interleaved conversations in busy channels
3. **Influence Scoring**: Identify influential users based on conversation centrality
4. **Sentiment Analysis**: Track conversation sentiment over time
5. **Topic Trend Detection**: Identify trending topics across guilds

---

## Troubleshooting

**Q: Streaming conversations not appearing?**
- Check `streaming_conversations` table: `SELECT * FROM streaming_conversations WHERE status = 'active';`
- Verify LiveEventSync is calling `socialIntelligence.processMessage()`

**Q: Relationship data still lagging?**
- Verify AI tools are querying `relationship_network_live` view (not direct `members.relationship_network`)
- Check `relationship_edges.last_interaction` to ensure edges are updating

**Q: Keywords not extracting?**
- Verify `guild_vocabulary` table has IDF scores: `SELECT COUNT(*) FROM guild_vocabulary WHERE guild_id = 'xxx';`
- Run `VocabularyBuilder.buildVocabulary()` manually if needed

**Q: High memory usage?**
- Streaming conversations table growing unbounded (finalization not triggering?)
- Check for orphaned streaming conversations: `SELECT COUNT(*) FROM streaming_conversations WHERE last_activity < NOW() - INTERVAL '1 hour';`

---

## Contributing

When adding new features, follow these principles:

1. **Real-time First**: Default to streaming/live data, not cached
2. **Layered Architecture**: Keep conversation detection, semantic analysis, and relationship mapping separate
3. **Database Views**: Use views for complex queries (don't duplicate logic in TypeScript)
4. **Incremental Enrichment**: Extract quick insights immediately, full enrichment on finalization
5. **Comprehensive Types**: All data structures in `types.ts`

---

For questions or issues, see the main project documentation or open an issue on GitHub.
