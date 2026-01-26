# Social Intelligence Pipeline Architecture

A comprehensive multi-stage pipeline system for analyzing Discord communities, building relationship networks, profiling users, and understanding community dynamics.

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PIPELINE DEPENDENCY GRAPH                             │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────┐
                              │  messages   │
                              │   (raw)     │
                              └──────┬──────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
  ┌───────────────────┐   ┌───────────────────┐   ┌───────────────┐
  │ 1. RELATIONSHIP   │   │ 2. CONVERSATION   │   │    members    │
  │    GENERATION     │   │    PIPELINE       │   │    (raw)      │
  │                   │   │                   │   └───────────────┘
  │ (builds affinity  │──►│ (uses affinity    │           │
  │  from messages)   │   │  if available,    │           │
  │                   │   │  works without)   │           │
  └─────────┬─────────┘   └─────────┬─────────┘           │
            │                       │                     │
            │    ┌──────────────────┘                     │
            │    │                                        │
            ▼    ▼                                        │
  ┌──────────────────────────────────────────────────────┐│
  │              3. BASE USER PROFILES                   ││
  │              (Foundation layer)                      │◄┘
  └───────────────────────┬──────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
  ┌───────────────────────┐   ┌───────────────────────┐
  │ 4. ENRICH             │   │                       │
  │    RELATIONSHIPS      │◄──┤  (uses user profiles) │
  └───────────┬───────────┘   └───────────────────────┘
              │
              ▼
  ┌───────────────────────┐
  │ 5. ENRICH             │
  │    USER PROFILES      │
  └───────────┬───────────┘
              │
              ▼
  ┌───────────────────────────────────────────────────┐
  │ 6. PSYCHOLOGICAL ANALYSIS PIPELINES (Agentic)    │
  │                                                   │
  │  ┌─────────┐ ┌───────────┐ ┌───────┐ ┌────────┐  │
  │  │  MBTI   │ │ Enneagram │ │ Big 5 │ │Socionics│ │
  │  └────┬────┘ └─────┬─────┘ └───┬───┘ └───┬────┘  │
  │       └────────────┴───────────┴─────────┘       │
  └───────────────────────┬───────────────────────────┘
                          │
                          ▼
          ┌───────────────────────────────┐
          │ 7. NETWORK ECOSYSTEM          │
          │    (Relationship dynamics)    │
          └───────────────┬───────────────┘
                          │
                          ▼
          ┌───────────────────────────────┐
          │ 8. GUILD PROFILE              │
          │    (Complete guild analysis)  │
          └───────────────────────────────┘
```

### Key Dependency Notes

| Dependency                    | Required?    | Notes                                           |
| ----------------------------- | ------------ | ----------------------------------------------- |
| Messages → Conversations      | **Yes**      | Raw messages are the input                      |
| Messages → Relationships      | **Yes**      | Raw messages are the input                      |
| Relationships → Conversations | **Optional** | Improves grouping accuracy with affinity scores |
| Conversations → User Profiles | **Yes**      | Needed for keyword aggregation                  |
| Relationships → User Profiles | **Yes**      | Needed for network context                      |

**Recommended execution order:**

1. Run **Relationship Generation** first (or in parallel)
2. Run **Conversation Pipeline** (benefits from affinity if available)
3. Continue with remaining pipelines in order

**Alternative (faster, less accurate):**

- Run Conversations without waiting for Relationships
- Re-run Conversation Enrichment after Relationships complete to improve groupings

---

## Database Schema Overview

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CORE TABLES (Input data from Discord sync)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE guilds (
  id VARCHAR(20) PRIMARY KEY,
  name TEXT,
  -- ... other Discord fields
);

CREATE TABLE members (
  guild_id VARCHAR(20),
  user_id VARCHAR(20),
  username TEXT,
  display_name TEXT,
  bot BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE messages (
  id VARCHAR(50) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  author_id VARCHAR(20) NOT NULL,
  content TEXT,
  created_at TIMESTAMP NOT NULL,
  referenced_message_id VARCHAR(50),
  mentioned_user_ids TEXT[] DEFAULT '{}',
  -- Pipeline additions
  embedding FLOAT[],
  conversation_id VARCHAR(50)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PIPELINE 1: RELATIONSHIP GENERATION
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE relationship_edges (
  guild_id VARCHAR(20) NOT NULL,
  user_a VARCHAR(20) NOT NULL,        -- Lexicographically smaller
  user_b VARCHAR(20) NOT NULL,        -- Lexicographically larger

  -- Raw interaction counts
  msg_a_to_b INTEGER DEFAULT 0,       -- Messages from A mentioning/replying to B
  msg_b_to_a INTEGER DEFAULT 0,       -- Messages from B mentioning/replying to A
  mentions INTEGER DEFAULT 0,          -- Total @mentions between them
  replies INTEGER DEFAULT 0,           -- Total reply chain interactions
  reactions INTEGER DEFAULT 0,         -- Reactions on each other's messages
  proximity_events INTEGER DEFAULT 0,  -- Messages within 30s of each other

  -- Calculated scores
  affinity_score FLOAT,               -- Weighted combination
  reciprocity_score FLOAT,            -- How balanced is the interaction

  -- Rolling windows
  rolling_7d FLOAT DEFAULT 0,
  rolling_30d FLOAT DEFAULT 0,

  -- Metadata
  first_interaction TIMESTAMP,
  last_interaction TIMESTAMP,
  total_interactions INTEGER DEFAULT 0,

  PRIMARY KEY (guild_id, user_a, user_b),
  CONSTRAINT user_order CHECK (user_a < user_b)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PIPELINE 2: CONVERSATIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE conversations (
  id VARCHAR(50) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,

  -- Participants
  participants TEXT[] NOT NULL DEFAULT '{}',

  -- Messages
  message_ids TEXT[] NOT NULL DEFAULT '{}',
  message_count INTEGER DEFAULT 0,

  -- Time range
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,

  -- Status: 'active' → 'draft' → 'enriched' → 'finalized'
  status VARCHAR(20) DEFAULT 'active',
  grouping_method VARCHAR(50),

  -- Embeddings & Analysis
  embedding FLOAT[],
  keywords TEXT[],
  topic_label TEXT,
  topic_confidence FLOAT,
  summary TEXT,

  -- Lineage
  parent_id VARCHAR(50),
  merged_from TEXT[],
  split_reason TEXT,

  -- Metadata
  enrichment_version INTEGER DEFAULT 0,
  last_enriched_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE orphan_messages (
  message_id VARCHAR(50) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  reason VARCHAR(100),
  rescue_attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PIPELINE 3-5: USER PROFILES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE user_profiles (
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,

  -- Basic profile (Pipeline 3)
  summary TEXT,
  keywords TEXT[] DEFAULT '{}',
  aliases TEXT[] DEFAULT '{}',

  -- Communication patterns (Pipeline 5)
  communication_style JSONB DEFAULT '{}',
  activity_patterns JSONB DEFAULT '{}',
  topic_interests JSONB DEFAULT '{}',

  -- Psychological profiles (Pipeline 6)
  mbti JSONB DEFAULT '{}',
  enneagram JSONB DEFAULT '{}',
  big_five JSONB DEFAULT '{}',
  socionics JSONB DEFAULT '{}',

  -- Behavioral analysis
  behavior_patterns JSONB DEFAULT '{}',
  interaction_tendencies JSONB DEFAULT '{}',

  -- Metadata
  profile_version INTEGER DEFAULT 0,
  last_enriched_at TIMESTAMP,
  enrichment_history JSONB DEFAULT '[]',

  PRIMARY KEY (guild_id, user_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PIPELINE 4: ENRICHED RELATIONSHIPS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE relationship_profiles (
  guild_id VARCHAR(20) NOT NULL,
  user_a VARCHAR(20) NOT NULL,
  user_b VARCHAR(20) NOT NULL,

  -- Basic metrics (from edges)
  affinity_score FLOAT,
  interaction_count INTEGER,

  -- Enriched analysis
  relationship_type VARCHAR(50),       -- 'friends', 'acquaintances', 'collaborators', etc.
  dynamic_description TEXT,            -- AI-generated description

  -- Perspective analysis
  user_a_perspective JSONB DEFAULT '{}',  -- How A views B
  user_b_perspective JSONB DEFAULT '{}',  -- How B views A

  -- Conversation analysis
  shared_topics TEXT[],
  conversation_themes JSONB DEFAULT '{}',
  communication_patterns JSONB DEFAULT '{}',

  -- Metadata
  enrichment_version INTEGER DEFAULT 0,
  last_enriched_at TIMESTAMP,

  PRIMARY KEY (guild_id, user_a, user_b),
  CONSTRAINT user_order CHECK (user_a < user_b)
);

-- Note: Network ecosystem data is stored directly in guild_profiles
-- No separate network_ecosystem table needed

-- ═══════════════════════════════════════════════════════════════════════════
-- PIPELINE 7-8: GUILD PROFILES (consistent with user_profiles, relationship_profiles)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE guild_profiles (
  guild_id VARCHAR(20) PRIMARY KEY,

  -- Summary
  summary TEXT,                              -- Overview of the guild
  keywords TEXT[] DEFAULT '{}',              -- Key topics/themes

  -- Power structure
  power_structure JSONB DEFAULT '{}',        -- Leadership, influencers
  decision_makers TEXT[],                    -- Key people

  -- Network analysis (from network_ecosystem)
  influence_hierarchy JSONB DEFAULT '{}',    -- Ranked users by influence
  social_clusters JSONB DEFAULT '[]',        -- Detected subgroups
  bridge_users TEXT[],                       -- Users connecting clusters

  -- Topic analysis
  dominant_topics JSONB DEFAULT '[]',        -- What the server talks about
  topic_champions JSONB DEFAULT '{}',        -- Who drives each topic
  trending_topics JSONB DEFAULT '[]',        -- Recent hot topics

  -- Community health
  health_score FLOAT,
  engagement_metrics JSONB DEFAULT '{}',
  activity_trends JSONB DEFAULT '{}',

  -- Guild personality
  personality_fingerprint JSONB DEFAULT '{}', -- Server's "personality"
  cultural_markers TEXT[],                    -- Defining characteristics

  -- Metadata
  profile_version INTEGER DEFAULT 0,
  last_enriched_at TIMESTAMP,
  enrichment_history JSONB DEFAULT '[]'
);
```

---

## Pipeline 1: Relationship Generation

**Purpose**: Build affinity scoring between all user pairs based on raw interaction data.

**Input**: `messages` table (raw Discord messages)
**Output**: `relationship_edges` table

### Architecture

```
src/pipelines/relationship-generation/
├── index.ts                      # Main orchestrator
├── InteractionExtractor.ts       # Extract interactions from messages
├── EdgeBuilder.ts                # Build/update relationship edges
├── AffinityCalculator.ts         # Calculate affinity scores
├── ReciprocityCalculator.ts      # Calculate balance of interactions
├── RollingWindowUpdater.ts       # Update 7d/30d rolling scores
└── types.ts
```

### Flow

```typescript
interface RelationshipGenerationConfig {
  guildId: string;
  startDate?: Date;
  endDate?: Date;
  batchSize: number;

  // Scoring weights
  weights: {
    mention: number; // Default: 2
    reply: number; // Default: 3
    reaction: number; // Default: 1
    proximity: number; // Default: 1
  };

  // Proximity detection
  proximityWindowMs: number; // Default: 30000 (30 seconds)
}

class RelationshipGenerationPipeline {
  async run(config: RelationshipGenerationConfig): Promise<PipelineResult> {
    // STEP 1: Extract all interactions from messages
    const interactions = await this.extractInteractions(config);

    // STEP 2: Build/update edges
    for (const interaction of interactions) {
      await this.edgeBuilder.upsertEdge(interaction);
    }

    // STEP 3: Calculate affinity scores for all edges
    await this.affinityCalculator.calculateAll(config.guildId, config.weights);

    // STEP 4: Calculate reciprocity scores
    await this.reciprocityCalculator.calculateAll(config.guildId);

    // STEP 5: Update rolling windows
    await this.rollingWindowUpdater.update(config.guildId);

    return stats;
  }
}
```

### Interaction Extraction

```typescript
interface Interaction {
  guildId: string;
  userA: string; // Normalized (smaller ID first)
  userB: string;
  type: "mention" | "reply" | "reaction" | "proximity";
  direction: "a_to_b" | "b_to_a";
  timestamp: Date;
  messageId: string;
}

class InteractionExtractor {
  async extract(config: RelationshipGenerationConfig): Promise<Interaction[]> {
    const interactions: Interaction[] = [];

    // 1. Extract mentions
    const mentions = await db.query(
      `
      SELECT id, author_id, mentioned_user_ids, created_at
      FROM messages
      WHERE guild_id = $1
        AND array_length(mentioned_user_ids, 1) > 0
        AND created_at BETWEEN $2 AND $3
    `,
      [config.guildId, config.startDate, config.endDate]
    );

    for (const msg of mentions.rows) {
      for (const mentionedId of msg.mentioned_user_ids) {
        interactions.push(
          this.normalizeInteraction({
            guildId: config.guildId,
            from: msg.author_id,
            to: mentionedId,
            type: "mention",
            timestamp: msg.created_at,
            messageId: msg.id,
          })
        );
      }
    }

    // 2. Extract replies
    const replies = await db.query(
      `
      SELECT m.id, m.author_id, m.created_at, ref.author_id as replied_to
      FROM messages m
      JOIN messages ref ON m.referenced_message_id = ref.id
      WHERE m.guild_id = $1
        AND m.created_at BETWEEN $2 AND $3
    `,
      [config.guildId, config.startDate, config.endDate]
    );

    for (const reply of replies.rows) {
      interactions.push(
        this.normalizeInteraction({
          guildId: config.guildId,
          from: reply.author_id,
          to: reply.replied_to,
          type: "reply",
          timestamp: reply.created_at,
          messageId: reply.id,
        })
      );
    }

    // 3. Extract proximity events (messages within 30s of each other)
    const proximityEvents = await this.extractProximityEvents(config);
    interactions.push(...proximityEvents);

    return interactions;
  }

  private normalizeInteraction(raw: RawInteraction): Interaction {
    // Ensure userA < userB lexicographically
    const [userA, userB] = [raw.from, raw.to].sort();
    return {
      guildId: raw.guildId,
      userA,
      userB,
      type: raw.type,
      direction: raw.from === userA ? "a_to_b" : "b_to_a",
      timestamp: raw.timestamp,
      messageId: raw.messageId,
    };
  }
}
```

### Affinity Calculation

```typescript
class AffinityCalculator {
  async calculateAll(guildId: string, weights: Weights): Promise<void> {
    await db.query(
      `
      UPDATE relationship_edges
      SET affinity_score = (
        (mentions * $2) +
        (replies * $3) +
        (reactions * $4) +
        (proximity_events * $5) +
        (msg_a_to_b + msg_b_to_a)
      ) * (1 + LOG(total_interactions + 1) * 0.1),
      
      reciprocity_score = CASE
        WHEN (msg_a_to_b + msg_b_to_a) = 0 THEN 0
        ELSE 1 - ABS(msg_a_to_b - msg_b_to_a)::FLOAT / (msg_a_to_b + msg_b_to_a)
      END
      
      WHERE guild_id = $1
    `,
      [
        guildId,
        weights.mention,
        weights.reply,
        weights.reaction,
        weights.proximity,
      ]
    );
  }
}
```

---

## Pipeline 2: Conversations

**Purpose**: Group raw messages into coherent conversations.

**Input**: `messages` (required), `relationship_edges` (optional, improves accuracy)
**Output**: `conversations`, `orphan_messages`

### How Relationships Improve Grouping

Without affinity data:

- Groups by explicit signals only (replies, mentions, time proximity)
- Works well for ~80% of conversations

With affinity data:

- Extends time windows for high-affinity user pairs
- Better handles interleaved conversations between different groups
- Improves accuracy to ~90%+

_(Detailed in previous conversation - see Phase 1: Base Grouping and Phase 2: Enrichment)_

### Key Integration Point

```typescript
// ProximityGrouper uses relationship_edges
class ProximityGrouper {
  async preloadRelationships(
    guildId: string,
    userIds: string[]
  ): Promise<void> {
    const edges = await db.query(
      `
      SELECT user_a, user_b, affinity_score
      FROM relationship_edges
      WHERE guild_id = $1
        AND user_a = ANY($2)
        AND user_b = ANY($2)
    `,
      [guildId, userIds]
    );

    // Cache for fast lookup during grouping
    for (const edge of edges.rows) {
      this.affinityCache.set(
        `${edge.user_a}:${edge.user_b}`,
        edge.affinity_score
      );
    }
  }

  // Use affinity to extend grouping windows
  getEffectiveWindow(
    userA: string,
    userB: string,
    baseWindowMs: number
  ): number {
    const affinity = this.getAffinity(userA, userB);
    const bonus = Math.min(affinity / 100, 1.0); // Max 2x window
    return baseWindowMs * (1 + bonus);
  }
}
```

---

## Pipeline 3: Base User Profiles

**Purpose**: Create foundational user profiles from conversations and basic activity.

**Input**: `conversations`, `messages`, `members`
**Output**: `user_profiles` (basic fields)

### Architecture

```
src/pipelines/base-user-profiles/
├── index.ts
├── ProfileBuilder.ts             # Build initial profiles
├── KeywordAggregator.ts          # Aggregate user's keywords from conversations
├── AliasTracker.ts               # Track username/nickname changes
├── SummaryGenerator.ts           # Generate basic summary
└── types.ts
```

### Flow

```typescript
class BaseUserProfilePipeline {
  async run(config: BaseProfileConfig): Promise<PipelineResult> {
    const users = await this.getActiveUsers(config.guildId);

    for (const user of users) {
      // STEP 1: Aggregate keywords from user's conversations
      const keywords = await this.keywordAggregator.aggregate(
        user.id,
        config.guildId
      );

      // STEP 2: Get aliases from member history
      const aliases = await this.aliasTracker.getAliases(
        user.id,
        config.guildId
      );

      // STEP 3: Calculate basic activity stats
      const activityStats = await this.calculateActivityStats(
        user.id,
        config.guildId
      );

      // STEP 4: Generate basic summary
      const summary = await this.summaryGenerator.generate({
        user,
        keywords,
        activityStats,
        conversationCount: await this.getConversationCount(user.id),
      });

      // STEP 5: Write profile
      await this.writeProfile(user.id, config.guildId, {
        summary,
        keywords,
        aliases,
        activity_patterns: activityStats,
      });
    }

    return stats;
  }
}
```

### Summary Generation (Simple, No AI)

```typescript
class SummaryGenerator {
  generate(data: UserData): string {
    const { user, keywords, activityStats, conversationCount } = data;

    const topKeywords = keywords.slice(0, 5).join(", ");
    const activityLevel = this.categorizeActivity(activityStats.messagesPerDay);

    return (
      `${user.display_name} is ${activityLevel} in the server, ` +
      `participating in ${conversationCount} conversations. ` +
      `Often discusses: ${topKeywords}.`
    );
  }

  private categorizeActivity(messagesPerDay: number): string {
    if (messagesPerDay > 50) return "highly active";
    if (messagesPerDay > 20) return "regularly active";
    if (messagesPerDay > 5) return "moderately active";
    return "occasionally active";
  }
}
```

---

## Pipeline 4: Enrich Relationships

**Purpose**: Analyze relationships from user perspectives using conversations.

**Input**: `user_profiles`, `conversations`, `relationship_edges`
**Output**: `relationship_profiles`

### Architecture

```
src/pipelines/enrich-relationships/
├── index.ts
├── ConversationAnalyzer.ts       # Analyze shared conversations
├── PerspectiveBuilder.ts         # Build user A's view of user B
├── DynamicClassifier.ts          # Classify relationship type
├── PatternExtractor.ts           # Extract communication patterns
└── types.ts
```

### Flow

```typescript
class EnrichRelationshipPipeline {
  async run(config: EnrichRelationshipConfig): Promise<PipelineResult> {
    // Get all relationship edges above threshold
    const edges = await this.getSignificantEdges(
      config.guildId,
      config.minAffinity
    );

    for (const edge of edges) {
      // STEP 1: Get shared conversations
      const conversations = await this.getSharedConversations(
        edge.user_a,
        edge.user_b,
        config.guildId
      );

      if (conversations.length === 0) continue;

      // STEP 2: Load both user profiles
      const profileA = await this.getProfile(edge.user_a, config.guildId);
      const profileB = await this.getProfile(edge.user_b, config.guildId);

      // STEP 3: Analyze conversations between them
      const conversationAnalysis = await this.conversationAnalyzer.analyze(
        conversations,
        edge.user_a,
        edge.user_b
      );

      // STEP 4: Build perspective analysis
      // How does A perceive B? How does B perceive A?
      const perspectiveA = await this.perspectiveBuilder.build(
        profileA,
        profileB,
        conversations,
        "a_perspective"
      );
      const perspectiveB = await this.perspectiveBuilder.build(
        profileB,
        profileA,
        conversations,
        "b_perspective"
      );

      // STEP 5: Classify relationship type
      const relationshipType = await this.dynamicClassifier.classify({
        edge,
        conversationAnalysis,
        perspectiveA,
        perspectiveB,
      });

      // STEP 6: Extract communication patterns
      const patterns = await this.patternExtractor.extract(conversations, edge);

      // STEP 7: Generate dynamic description (AI)
      const description = await this.generateDescription({
        edge,
        profileA,
        profileB,
        relationshipType,
        patterns,
      });

      // STEP 8: Write enriched profile
      await this.writeRelationshipProfile({
        guild_id: config.guildId,
        user_a: edge.user_a,
        user_b: edge.user_b,
        affinity_score: edge.affinity_score,
        interaction_count: edge.total_interactions,
        relationship_type: relationshipType,
        dynamic_description: description,
        user_a_perspective: perspectiveA,
        user_b_perspective: perspectiveB,
        shared_topics: conversationAnalysis.topics,
        conversation_themes: conversationAnalysis.themes,
        communication_patterns: patterns,
      });
    }

    return stats;
  }
}
```

### Perspective Builder

```typescript
interface UserPerspective {
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  interaction_style: string; // How they interact with the other
  topics_discussed: string[]; // What they talk about with them
  response_patterns: {
    avg_response_time_minutes: number;
    initiates_conversation_rate: number;
    engagement_level: "high" | "medium" | "low";
  };
  notable_patterns: string[]; // AI-detected patterns
}

class PerspectiveBuilder {
  async build(
    sourceProfile: UserProfile,
    targetProfile: UserProfile,
    conversations: Conversation[],
    perspective: "a_perspective" | "b_perspective"
  ): Promise<UserPerspective> {
    const sourceId =
      perspective === "a_perspective"
        ? sourceProfile.user_id
        : targetProfile.user_id;
    const targetId =
      perspective === "a_perspective"
        ? targetProfile.user_id
        : sourceProfile.user_id;

    // Analyze how source user interacts with target user
    const messages = await this.getMessagesBetween(
      sourceId,
      targetId,
      conversations
    );

    // Calculate response patterns
    const responsePatterns = this.calculateResponsePatterns(
      messages,
      sourceId,
      targetId
    );

    // Extract topics discussed specifically with this person
    const topics = this.extractTopicsWithPerson(messages, sourceId);

    // Analyze sentiment in their interactions
    const sentiment = await this.analyzeSentiment(messages, sourceId);

    // Detect interaction style
    const style = this.detectInteractionStyle(messages, sourceId);

    return {
      sentiment,
      interaction_style: style,
      topics_discussed: topics,
      response_patterns: responsePatterns,
      notable_patterns: [], // Filled by AI in later step
    };
  }
}
```

---

## Pipeline 5: Enrich User Profiles

**Purpose**: Build deeper user analysis from relationships, conversations, and patterns.

**Input**: `relationship_profiles`, `conversations`, `user_profiles` (basic)
**Output**: `user_profiles` (enriched communication_style, behavior_patterns, etc.)

### Architecture

```
src/pipelines/enrich-user-profiles/
├── index.ts
├── CommunicationStyleAnalyzer.ts  # How they communicate
├── ActivityPatternAnalyzer.ts     # When they're active
├── TopicInterestAnalyzer.ts       # What they care about
├── BehaviorPatternAnalyzer.ts     # How they behave in groups
├── InteractionTendencyAnalyzer.ts # How they interact with different people
└── types.ts
```

### Flow

```typescript
class EnrichUserProfilePipeline {
  async run(config: EnrichUserProfileConfig): Promise<PipelineResult> {
    const users = await this.getActiveUsers(config.guildId);

    for (const user of users) {
      // Load context
      const relationships = await this.getRelationshipProfiles(
        user.id,
        config.guildId
      );
      const conversations = await this.getUserConversations(
        user.id,
        config.guildId
      );
      const messages = await this.getUserMessages(user.id, config.guildId);

      // STEP 1: Communication Style Analysis
      const communicationStyle = await this.communicationStyleAnalyzer.analyze(
        messages
      );
      // Output: { formality, verbosity, emoji_usage, vocabulary_complexity, avg_message_length }

      // STEP 2: Activity Pattern Analysis
      const activityPatterns = await this.activityPatternAnalyzer.analyze(
        messages
      );
      // Output: { peak_hours, active_days, burst_tendency, consistency_score }

      // STEP 3: Topic Interest Analysis
      const topicInterests = await this.topicInterestAnalyzer.analyze(
        conversations
      );
      // Output: { topics: [{ topic, engagement_score, expertise_level }] }

      // STEP 4: Behavior Pattern Analysis
      const behaviorPatterns = await this.behaviorPatternAnalyzer.analyze({
        messages,
        conversations,
        relationships,
      });
      // Output: { response_patterns, conversation_role, group_dynamics }

      // STEP 5: Interaction Tendency Analysis
      const interactionTendencies =
        await this.interactionTendencyAnalyzer.analyze({
          relationships,
          conversations,
        });
      // Output: { prefers_group_vs_1on1, conversation_initiation_rate, etc. }

      // STEP 6: Update profile
      await this.updateProfile(user.id, config.guildId, {
        communication_style: communicationStyle,
        activity_patterns: activityPatterns,
        topic_interests: topicInterests,
        behavior_patterns: behaviorPatterns,
        interaction_tendencies: interactionTendencies,
      });
    }

    return stats;
  }
}
```

### Communication Style Analyzer

```typescript
interface CommunicationStyle {
  formality_score: number; // 0-1, formal vs casual
  verbosity_score: number; // 0-1, brief vs verbose
  emoji_density: number; // emojis per message
  vocabulary_diversity: number; // unique words / total words
  avg_message_length: number;
  punctuation_style: string; // 'minimal', 'standard', 'expressive'
  capitalization_style: string; // 'standard', 'lowercase', 'mixed'
  question_rate: number; // % of messages that are questions
  exclamation_rate: number; // % with exclamation marks
}

class CommunicationStyleAnalyzer {
  analyze(messages: Message[]): CommunicationStyle {
    const totalMessages = messages.length;
    const allText = messages.map((m) => m.content).join(" ");
    const words = allText.split(/\s+/);

    return {
      formality_score: this.calculateFormality(messages),
      verbosity_score: this.calculateVerbosity(messages),
      emoji_density: this.countEmojis(allText) / totalMessages,
      vocabulary_diversity: new Set(words).size / words.length,
      avg_message_length: words.length / totalMessages,
      punctuation_style: this.detectPunctuationStyle(messages),
      capitalization_style: this.detectCapitalizationStyle(messages),
      question_rate:
        messages.filter((m) => m.content.includes("?")).length / totalMessages,
      exclamation_rate:
        messages.filter((m) => m.content.includes("!")).length / totalMessages,
    };
  }
}
```

---

## Pipeline 6: Psychological Analysis (Agentic)

**Purpose**: Deep psychological profiling using AI agents with tool access.

**Input**: `user_profiles` (enriched), `conversations`, `relationship_profiles`
**Output**: `user_profiles.mbti`, `user_profiles.enneagram`, `user_profiles.big_five`, `user_profiles.socionics`

### Architecture

```
src/pipelines/psychological-analysis/
├── index.ts                       # Orchestrator
├── agents/
│   ├── BaseAnalysisAgent.ts       # Base agent with tool access
│   ├── MBTIAgent.ts               # MBTI analysis agent
│   ├── EnneagramAgent.ts          # Enneagram analysis agent
│   ├── BigFiveAgent.ts            # Big Five analysis agent
│   └── SocionicsAgent.ts          # Socionics analysis agent
├── tools/
│   ├── SearchMessagesTool.ts      # Search user's messages
│   ├── GetConversationsTool.ts    # Get conversations
│   ├── GetRelationshipsTool.ts    # Get relationship data
│   ├── AnalyzePatternTool.ts      # Pattern analysis
│   └── GetContextTool.ts          # Get surrounding context
├── reasoning/
│   ├── ReasoningLoop.ts           # Chain of thought reasoning
│   └── ConfidenceCalculator.ts    # Calculate diagnosis confidence
└── types.ts
```

### Agentic Flow

```typescript
interface AnalysisTools {
  searchMessages: (query: string, userId: string) => Promise<Message[]>;
  getConversations: (
    userId: string,
    filters?: ConversationFilters
  ) => Promise<Conversation[]>;
  getRelationships: (userId: string) => Promise<RelationshipProfile[]>;
  analyzePattern: (
    messages: Message[],
    patternType: string
  ) => Promise<PatternResult>;
  getContext: (messageId: string, windowSize: number) => Promise<Message[]>;
}

abstract class BaseAnalysisAgent {
  protected tools: AnalysisTools;
  protected aiEngine: AIEngine;
  protected reasoningLoop: ReasoningLoop;

  abstract get systemPrompt(): string;
  abstract get analysisType(): string;

  async analyze(userId: string, guildId: string): Promise<AnalysisResult> {
    // Load user profile context
    const profile = await this.loadProfile(userId, guildId);

    // Initialize reasoning loop
    const reasoning = await this.reasoningLoop.start({
      goal: `Analyze ${userId}'s ${this.analysisType} profile`,
      context: this.buildInitialContext(profile),
      tools: this.tools,
      maxIterations: 10,
      confidenceThreshold: 0.7,
    });

    // Agent reasoning loop
    while (!reasoning.isComplete()) {
      // Get next action from AI
      const action = await this.aiEngine.generate({
        system: this.systemPrompt,
        messages: reasoning.getHistory(),
        tools: this.getToolDefinitions(),
      });

      if (action.toolCall) {
        // Execute tool
        const result = await this.executeTool(action.toolCall);
        reasoning.addToolResult(result);
      } else if (action.reasoning) {
        // Add reasoning step
        reasoning.addThought(action.reasoning);
      } else if (action.conclusion) {
        // Agent reached conclusion
        reasoning.conclude(action.conclusion);
      }
    }

    // Calculate confidence based on evidence gathered
    const confidence = this.confidenceCalculator.calculate(
      reasoning.getEvidence()
    );

    return {
      type: this.analysisType,
      result: reasoning.getConclusion(),
      confidence,
      reasoning_trace: reasoning.getTrace(),
      evidence: reasoning.getEvidence(),
    };
  }
}
```

### MBTI Agent Example

```typescript
class MBTIAgent extends BaseAnalysisAgent {
  get analysisType() {
    return "mbti";
  }

  get systemPrompt() {
    return `You are an expert MBTI analyst examining a Discord user's personality.

Your task is to determine the user's MBTI type by examining their:
- Communication style and patterns
- How they interact with different people
- Topics they engage with and how
- Decision-making patterns visible in conversations
- How they respond to conflict or disagreement

You have access to tools to search messages, get conversations, and analyze patterns.

Use chain-of-thought reasoning:
1. First, gather evidence for Extraversion vs Introversion
2. Then, gather evidence for Sensing vs Intuition
3. Then, gather evidence for Thinking vs Feeling
4. Finally, gather evidence for Judging vs Perceiving

For each dimension, search for specific behavioral evidence before making a determination.

When you have sufficient evidence (confidence > 70%), provide your conclusion in format:
{
  "type": "ENFP",
  "dimensions": {
    "E_I": { "score": 0.7, "evidence": [...] },
    "S_N": { "score": 0.8, "evidence": [...] },
    "T_F": { "score": 0.6, "evidence": [...] },
    "J_P": { "score": 0.75, "evidence": [...] }
  },
  "overall_confidence": 0.72,
  "reasoning_summary": "..."
}`;
  }

  private getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "search_messages",
        description: "Search user messages for specific patterns or keywords",
        parameters: {
          query: { type: "string", description: "Search query" },
          filters: {
            type: "object",
            properties: {
              sentiment: {
                type: "string",
                enum: ["positive", "negative", "neutral"],
              },
              has_question: { type: "boolean" },
              has_emoji: { type: "boolean" },
              min_length: { type: "number" },
            },
          },
        },
      },
      {
        name: "get_conversations",
        description: "Get conversations the user participated in",
        parameters: {
          type: { type: "string", enum: ["1on1", "group", "all"] },
          topic: { type: "string", optional: true },
          limit: { type: "number" },
        },
      },
      {
        name: "analyze_response_patterns",
        description: "Analyze how user responds to different situations",
        parameters: {
          situation: {
            type: "string",
            enum: ["conflict", "question", "emotional", "factual", "planning"],
          },
        },
      },
      {
        name: "compare_with_relationships",
        description: "Compare behavior with different relationship types",
        parameters: {
          relationship_type: {
            type: "string",
            enum: ["close_friends", "acquaintances", "all"],
          },
        },
      },
    ];
  }
}
```

### Reasoning Loop

```typescript
interface ReasoningStep {
  type: "thought" | "tool_call" | "tool_result" | "conclusion";
  content: any;
  timestamp: Date;
}

class ReasoningLoop {
  private history: ReasoningStep[] = [];
  private evidence: Evidence[] = [];
  private concluded: boolean = false;
  private conclusion: any = null;

  async start(config: ReasoningConfig): Promise<void> {
    // Add initial context
    this.addThought(`Starting ${config.goal}`);
    this.addThought(`Initial context: ${JSON.stringify(config.context)}`);
  }

  addThought(thought: string): void {
    this.history.push({
      type: "thought",
      content: thought,
      timestamp: new Date(),
    });
  }

  addToolResult(result: ToolResult): void {
    this.history.push({
      type: "tool_result",
      content: result,
      timestamp: new Date(),
    });

    // Extract evidence from result
    if (result.evidence) {
      this.evidence.push(...result.evidence);
    }
  }

  conclude(conclusion: any): void {
    this.concluded = true;
    this.conclusion = conclusion;
    this.history.push({
      type: "conclusion",
      content: conclusion,
      timestamp: new Date(),
    });
  }

  isComplete(): boolean {
    return this.concluded || this.history.length >= this.maxIterations;
  }

  getTrace(): ReasoningTrace {
    return {
      steps: this.history,
      evidence_count: this.evidence.length,
      iterations: this.history.filter((h) => h.type === "thought").length,
      tools_used: this.history.filter((h) => h.type === "tool_call").length,
    };
  }
}
```

---

## Pipeline 7: Network Ecosystem

**Purpose**: Analyze relationship dynamics and build hierarchical ecosystem.

**Input**: `user_profiles` (complete with psych), `relationship_profiles`
**Output**: `guild_profiles` (network fields: influence_hierarchy, social_clusters, bridge_users)

### Architecture

```
src/pipelines/network-ecosystem/
├── index.ts
├── GraphBuilder.ts                # Build weighted relationship graph
├── ClusterDetector.ts             # Detect social clusters
├── InfluenceRanker.ts             # Rank users by influence
├── BridgeIdentifier.ts            # Find bridge users
└── types.ts
```

### Flow

```typescript
class NetworkEcosystemPipeline {
  async run(config: NetworkEcosystemConfig): Promise<PipelineResult> {
    // STEP 1: Build weighted graph
    const graph = await this.graphBuilder.build(config.guildId);
    // Nodes: users, Edges: relationship weights

    // STEP 2: Detect social clusters (community detection)
    const clusters = await this.clusterDetector.detect(graph);
    // Uses Louvain or similar algorithm

    // STEP 3: Identify bridge users (connect clusters)
    const bridges = await this.bridgeIdentifier.identify(graph, clusters);

    // STEP 4: Rank influence
    const influenceRanking = await this.influenceRanker.rank(graph, {
      factors: {
        connection_count: 0.2,
        connection_strength: 0.3,
        conversation_initiation: 0.2,
        response_rate_received: 0.15,
        bridge_centrality: 0.15,
      },
    });

    // STEP 5: Analyze relationship dynamics
    const dynamics = await this.dynamicsAnalyzer.analyze({
      graph,
      clusters,
      userProfiles: await this.loadUserProfiles(config.guildId),
    });

    // STEP 6: Identify strongest bonds
    const strongestBonds = this.findStrongestBonds(graph, 20);

    // STEP 7: Analyze communication flows
    const communicationFlows = await this.analyzeCommunicationFlows(
      config.guildId
    );

    // STEP 8: Update guild_profiles with network data
    await this.updateGuildProfile(config.guildId, {
      influence_hierarchy: influenceRanking,
      social_clusters: clusters,
      bridge_users: bridges,
    });

    return stats;
  }
}
```

### Cluster Detection

```typescript
class ClusterDetector {
  async detect(graph: WeightedGraph): Promise<SocialCluster[]> {
    // Louvain community detection
    const communities = this.louvain(graph);

    const clusters: SocialCluster[] = [];

    for (const [clusterId, memberIds] of communities.entries()) {
      // Analyze cluster characteristics
      const members = await this.loadMembers(memberIds);
      const internalDensity = this.calculateInternalDensity(graph, memberIds);
      const dominantTopics = await this.findDominantTopics(memberIds);

      clusters.push({
        id: clusterId,
        members: memberIds,
        size: memberIds.length,
        internal_density: internalDensity,
        dominant_topics: dominantTopics,
        central_member: this.findMostCentralMember(graph, memberIds),
        label: await this.generateClusterLabel(members, dominantTopics),
      });
    }

    return clusters;
  }
}
```

---

## Pipeline 8: Guild Profile Enrichment

**Purpose**: Complete the guild profile with topics, health, and personality analysis.

**Input**: `guild_profiles` (with network data), `user_profiles`, `conversations`
**Output**: `guild_profiles` (fully enriched)

### Architecture

```
src/pipelines/guild-profile-enrichment/
├── index.ts
├── PowerStructureAnalyzer.ts      # Analyze leadership/influence
├── TopicAnalyzer.ts               # Analyze dominant topics
├── HealthScorer.ts                # Calculate community health
├── PersonalityAnalyzer.ts         # Server's personality
├── SummaryGenerator.ts            # Generate guild summary
└── types.ts
```

### Flow

```typescript
class GuildProfileEnrichmentPipeline {
  async run(config: GuildProfileConfig): Promise<PipelineResult> {
    // Load current guild profile (with network data from Pipeline 7)
    const guildProfile = await this.loadGuildProfile(config.guildId);

    // STEP 1: Power structure analysis
    const powerStructure = await this.powerStructureAnalyzer.analyze({
      influenceHierarchy: guildProfile.influence_hierarchy,
      clusters: guildProfile.social_clusters,
    });

    // STEP 2: Topic analysis
    const topicAnalysis = await this.topicAnalyzer.analyze(config.guildId);
    // Output: { dominant, trending, topic_champions }

    // STEP 3: Health scoring
    const healthMetrics = await this.healthScorer.calculate(config.guildId);
    // Output: { score, engagement, activity_trends }

    // STEP 4: Personality analysis
    const personality = await this.personalityAnalyzer.analyze({
      topicAnalysis,
      memberProfiles: await this.loadAllProfiles(config.guildId),
      communicationPatterns: await this.aggregateCommunicationPatterns(
        config.guildId
      ),
    });
    // Output: { fingerprint, cultural_markers }

    // STEP 5: Generate summary
    const summary = await this.summaryGenerator.generate({
      guildProfile,
      powerStructure,
      topicAnalysis,
      healthMetrics,
      personality,
    });

    // STEP 6: Extract keywords
    const keywords = this.extractKeywords(topicAnalysis, personality);

    // STEP 7: Update guild_profiles
    await this.updateGuildProfile(config.guildId, {
      summary,
      keywords,
      power_structure: powerStructure,
      decision_makers: powerStructure.leaders,
      dominant_topics: topicAnalysis.dominant,
      topic_champions: topicAnalysis.champions,
      trending_topics: topicAnalysis.trending,
      health_score: healthMetrics.score,
      engagement_metrics: healthMetrics,
      activity_trends: healthMetrics.activity_trends,
      personality_fingerprint: personality.fingerprint,
      cultural_markers: personality.cultural_markers,
      profile_version: guildProfile.profile_version + 1,
      last_enriched_at: new Date(),
    });

    return stats;
  }
}
```

### Summary Generator

```typescript
class SummaryGenerator {
  async generate(data: GuildAnalysisData): Promise<string> {
    // Generate a concise summary of the guild
    const prompt = `Generate a 2-3 sentence summary of this Discord server.

TOPICS: ${data.topicAnalysis.dominant.join(", ")}
MEMBER COUNT: ${data.guildProfile.social_clusters.reduce(
      (sum, c) => sum + c.members.length,
      0
    )}
TOP PERSONALITIES: ${data.powerStructure.leaders.slice(0, 3).join(", ")}
HEALTH SCORE: ${data.healthMetrics.score}
CULTURAL MARKERS: ${data.personality.cultural_markers.join(", ")}

Write a natural summary that captures what makes this community unique.`;

    const response = await this.aiEngine.generate({
      system:
        "You are summarizing a Discord community. Be concise and specific.",
      prompt,
    });

    return response.text.trim();
  }
}
```

---

## Pipeline Orchestration

### Run Order & Dependencies

```typescript
// src/pipelines/orchestrator.ts

class PipelineOrchestrator {
  async runFullAnalysis(guildId: string): Promise<FullAnalysisResult> {
    const results: Record<string, PipelineResult> = {};

    // PHASE 1: Foundation - Both pipelines consume raw messages
    // Option A: Run sequentially (recommended for best accuracy)
    console.log("=== PHASE 1A: RELATIONSHIP GENERATION ===");
    results.relationships = await this.runRelationshipGeneration(guildId);

    console.log("=== PHASE 1B: CONVERSATION GROUPING ===");
    // Conversation pipeline uses affinity scores if available (improves accuracy)
    results.conversations_base = await this.runConversationGrouping(guildId);
    results.conversations_enriched = await this.runConversationEnrichment(
      guildId
    );

    // Option B: Run in parallel (faster, slightly less accurate)
    // const [relationships, conversations] = await Promise.all([
    //   this.runRelationshipGeneration(guildId),
    //   this.runConversationGrouping(guildId)
    // ]);
    // results.relationships = relationships;
    // results.conversations_base = conversations;
    // // Re-run enrichment to incorporate affinity data
    // results.conversations_enriched = await this.runConversationEnrichment(guildId);

    // PHASE 2: Base Profiles (uses conversations + relationships)
    console.log("=== PHASE 2: BASE PROFILES ===");
    results.base_profiles = await this.runBaseUserProfiles(guildId);

    // PHASE 3: Relationship Enrichment (uses profiles + conversations)
    console.log("=== PHASE 3: RELATIONSHIP ENRICHMENT ===");
    results.enriched_relationships = await this.runEnrichRelationships(guildId);

    // PHASE 4: Profile Enrichment (uses enriched relationships)
    console.log("=== PHASE 4: PROFILE ENRICHMENT ===");
    results.enriched_profiles = await this.runEnrichUserProfiles(guildId);

    // PHASE 5: Psychological Analysis (uses enriched profiles)
    console.log("=== PHASE 5: PSYCHOLOGICAL ANALYSIS ===");
    results.mbti = await this.runMBTIAnalysis(guildId);
    results.enneagram = await this.runEnneagramAnalysis(guildId);
    results.big_five = await this.runBigFiveAnalysis(guildId);
    results.socionics = await this.runSocionicsAnalysis(guildId);

    // PHASE 6: Network Ecosystem (uses complete profiles)
    console.log("=== PHASE 6: NETWORK ECOSYSTEM ===");
    results.network = await this.runNetworkEcosystem(guildId);

    // PHASE 7: Guild Profile Enrichment (completes guild_profiles)
    console.log("=== PHASE 7: GUILD PROFILE ENRICHMENT ===");
    results.guild = await this.runGuildProfileEnrichment(guildId);

    return results;
  }

  // Individual pipeline runners with error handling
  private async runRelationshipGeneration(
    guildId: string
  ): Promise<PipelineResult> {
    const pipeline = new RelationshipGenerationPipeline(this.db);
    return pipeline.run({ guildId, batchSize: 1000 });
  }

  // ... other runners
}
```

### Incremental Updates

```typescript
// For ongoing updates after initial analysis

class IncrementalUpdater {
  async update(guildId: string, since: Date): Promise<void> {
    // 1. Update relationship edges with new messages
    await this.relationshipPipeline.runIncremental(guildId, since);

    // 2. Process new conversations
    await this.conversationPipeline.runIncremental(guildId, since);

    // 3. Update affected user profiles
    const affectedUsers = await this.getAffectedUsers(guildId, since);
    for (const userId of affectedUsers) {
      await this.profilePipeline.updateUser(userId, guildId);
    }

    // 4. Mark guild profile as stale (needs re-enrichment)
    await this.markStale(guildId, ["guild_profile"]);
  }
}
```

---

## Directory Structure (New Project)

```
social-intelligence/
├── src/
│   ├── database/
│   │   ├── index.ts
│   │   ├── schema.sql
│   │   └── migrations/
│   │
│   ├── pipelines/
│   │   ├── orchestrator.ts
│   │   │
│   │   ├── relationship-generation/
│   │   │   ├── index.ts
│   │   │   ├── InteractionExtractor.ts
│   │   │   ├── EdgeBuilder.ts
│   │   │   ├── AffinityCalculator.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── conversation-grouping/
│   │   │   ├── index.ts
│   │   │   ├── ChannelChunker.ts
│   │   │   ├── ReplyChainBuilder.ts
│   │   │   ├── MentionGrouper.ts
│   │   │   ├── ProximityGrouper.ts
│   │   │   ├── RelationshipGrouper.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── conversation-enrichment/
│   │   │   ├── index.ts
│   │   │   ├── EmbeddingGenerator.ts
│   │   │   ├── TopicDriftSplitter.ts
│   │   │   ├── SemanticMerger.ts
│   │   │   ├── OrphanRescuer.ts
│   │   │   ├── ConversationScorer.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── base-user-profiles/
│   │   │   ├── index.ts
│   │   │   ├── ProfileBuilder.ts
│   │   │   ├── KeywordAggregator.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── enrich-relationships/
│   │   │   ├── index.ts
│   │   │   ├── ConversationAnalyzer.ts
│   │   │   ├── PerspectiveBuilder.ts
│   │   │   ├── DynamicClassifier.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── enrich-user-profiles/
│   │   │   ├── index.ts
│   │   │   ├── CommunicationStyleAnalyzer.ts
│   │   │   ├── ActivityPatternAnalyzer.ts
│   │   │   ├── BehaviorPatternAnalyzer.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── psychological-analysis/
│   │   │   ├── index.ts
│   │   │   ├── agents/
│   │   │   │   ├── BaseAnalysisAgent.ts
│   │   │   │   ├── MBTIAgent.ts
│   │   │   │   ├── EnneagramAgent.ts
│   │   │   │   ├── BigFiveAgent.ts
│   │   │   │   └── SocionicsAgent.ts
│   │   │   ├── tools/
│   │   │   │   ├── SearchMessagesTool.ts
│   │   │   │   ├── GetConversationsTool.ts
│   │   │   │   ├── GetRelationshipsTool.ts
│   │   │   │   └── AnalyzePatternTool.ts
│   │   │   ├── reasoning/
│   │   │   │   ├── ReasoningLoop.ts
│   │   │   │   └── ConfidenceCalculator.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── network-ecosystem/
│   │   │   ├── index.ts
│   │   │   ├── GraphBuilder.ts
│   │   │   ├── ClusterDetector.ts
│   │   │   ├── InfluenceRanker.ts
│   │   │   ├── BridgeIdentifier.ts
│   │   │   └── types.ts
│   │   │
│   │   └── guild-profile-enrichment/
│   │       ├── index.ts
│   │       ├── PowerStructureAnalyzer.ts
│   │       ├── TopicAnalyzer.ts
│   │       ├── HealthScorer.ts
│   │       ├── PersonalityAnalyzer.ts
│   │       ├── SummaryGenerator.ts
│   │       └── types.ts
│   │
│   ├── ai/
│   │   ├── AIEngine.ts
│   │   ├── EmbeddingService.ts
│   │   └── providers/
│   │
│   ├── scripts/
│   │   ├── run-full-analysis.ts
│   │   ├── run-pipeline.ts
│   │   └── incremental-update.ts
│   │
│   └── types/
│       └── index.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## What Can Be Ported from Existing Project

### Ready to Port (with modifications)

| Component             | Source Location                               | Target Location                            | Notes                                |
| --------------------- | --------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| ConversationDetector  | `social-intelligence/conversation-detection/` | `pipelines/conversation-grouping/`         | Simplify, remove real-time streaming |
| ConversationScorer    | Same                                          | `pipelines/conversation-enrichment/`       | Port directly                        |
| ConversationGrouper   | Same                                          | `pipelines/conversation-grouping/`         | Simplify strategies                  |
| KeywordExtractor      | `semantic-analysis/`                          | `pipelines/conversation-enrichment/`       | Port TF-IDF logic                    |
| EmbeddingService      | `semantic-analysis/`                          | `ai/`                                      | Port directly                        |
| TopicDriftDetector    | `semantic-analysis/`                          | `pipelines/conversation-enrichment/`       | Port directly                        |
| RelationshipMapper    | `relationship-mapping/`                       | `pipelines/relationship-generation/`       | Adapt for batch                      |
| AffinityCalculator    | Same                                          | Same                                       | Port directly                        |
| PsychologicalProfiler | `psychological-profiling/`                    | `pipelines/psychological-analysis/`        | Adapt to agentic                     |
| Big5/MBTI Estimators  | Same                                          | `pipelines/psychological-analysis/agents/` | Use as base                          |

### Needs to Be Built New

| Component                  | Why                         |
| -------------------------- | --------------------------- |
| RelationshipGrouper        | New strategy using affinity |
| PerspectiveBuilder         | New concept                 |
| EnrichRelationshipPipeline | New pipeline                |
| Agentic framework          | New approach with tool use  |
| ReasoningLoop              | New for chain-of-thought    |
| NetworkEcosystem pipeline  | New graph analysis          |
| GuildProfileEnrichment     | New for guild analysis      |
| SummaryGenerator           | New for guild summaries     |

---

## Configuration

```typescript
// config/pipeline.config.ts

export const PIPELINE_CONFIG = {
  // Relationship Generation
  relationships: {
    weights: {
      mention: 2,
      reply: 3,
      reaction: 1,
      proximity: 1,
    },
    proximityWindowMs: 30000,
    minAffinityForEnrichment: 10,
  },

  // Conversation Grouping
  conversations: {
    timeGapMinutes: 30,
    proximityWindowMinutes: 5,
    minMessages: 3,
    relationshipWindowBonus: 1.0, // 2x window for high affinity
  },

  // Conversation Enrichment
  enrichment: {
    embeddingModel: "all-mpnet-base-v2",
    driftThreshold: 0.4,
    mergeThreshold: 0.7,
    scoringWeights: {
      relationship: 0.45,
      semantic: 0.25,
      temporal: 0.2,
      keyword: 0.1,
    },
  },

  // Psychological Analysis
  psychological: {
    aiModel: "grok-beta",
    maxReasoningIterations: 10,
    confidenceThreshold: 0.7,
    toolTimeoutMs: 30000,
  },

  // Guild Analysis
  guild: {
    clusterAlgorithm: "louvain",
    minClusterSize: 3,
    influenceFactors: {
      connection_count: 0.2,
      connection_strength: 0.3,
      conversation_initiation: 0.2,
      response_rate: 0.15,
      bridge_centrality: 0.15,
    },
  },
};
```

---

## Next Steps

1. **Set up new project structure**
2. **Port database schema**
3. **Implement Pipeline 1** (Relationship Generation) - foundational
4. **Implement Pipeline 2** (Conversations) - uses relationships
5. **Test on real data**
6. **Implement remaining pipelines in order**
7. **Build agentic framework for psych analysis**
8. **Integrate and test full pipeline**

---

_This document serves as the blueprint for the Social Intelligence pipeline system._
