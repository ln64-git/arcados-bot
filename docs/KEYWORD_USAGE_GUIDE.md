# Keyword-Based Conversation Extraction Guide

This guide explains how to use the keyword extraction system for retroactive conversation analysis and grouping.

## Overview

The keyword extraction system provides TF-IDF and semantic-based keyword extraction for Discord conversations. Keywords can be used to:

1. **Find orphaned messages** that belong to existing conversations
2. **Identify recurring topics** across time
3. **Merge conversation segments** with high topic overlap
4. **Enhance conversation scoring** with keyword similarity
5. **Detect topic drift** programmatically
6. **Provide context** for LLM-assisted sorting

## System Architecture

### Components

1. **VocabularyBuilder** - Builds per-guild TF-IDF vocabulary from conversation corpus
2. **TFIDFExtractor** - Extracts keywords using TF-IDF with n-gram support (1-3 words)
3. **SemanticKeywordExtractor** - Clusters keywords using embeddings
4. **KeywordExtractor** - Main service combining TF-IDF + semantic (70/30 weight)

### Data Flow

```
Discord Messages
     ↓
Conversation Segments (finalized)
     ↓
Keyword Extraction (hybrid: TF-IDF + semantic)
     ↓
Keywords stored in features.keywords (JSONB)
     ↓
Conversation Scoring (+10% keyword overlap dimension)
     ↓
Topic Drift Detection (TF-IDF-based, no hardcoded stopwords)
```

## Workflow

### 1. Initial Setup

Build the guild vocabulary from existing conversations:

```bash
GUILD_ID=1254694808228986912 npm run keywords:build-vocabulary
```

This analyzes all finalized conversation segments and creates:
- Term vocabulary with IDF scores
- Automatic stopword detection (terms in >80% of conversations)
- Per-guild language patterns

**Output:**
```
📈 Vocabulary Statistics:
   Total terms: 14,806
   Stopwords: 0
   Avg IDF: 5.702
   Median IDF: 6.197
```

### 2. Extract Keywords for All Conversations

Retroactively extract keywords for existing conversations:

```bash
GUILD_ID=1254694808228986912 npm run keywords:extract-all
```

This processes all finalized conversation segments and:
- Extracts 1-3 word n-grams
- Filters URL fragments and noise
- Applies hybrid TF-IDF + semantic scoring
- Stores top 10 keywords in `features.keywords`

**Output:**
```
Total processed: 983
Updated: 983
Skipped (already had keywords): 0
```

### 3. Analyze Keyword Quality

Review extracted keywords to ensure quality:

```bash
GUILD_ID=1254694808228986912 npm run keywords:analyze
```

**Key Metrics:**
- **Segments with keywords:** Percentage of conversations with extracted keywords
- **Average keywords per segment:** Should be 5-10
- **Total unique keywords:** Vocabulary diversity
- **Score distribution:** Confidence levels
- **Top keywords:** Most common terms (should be natural language)
- **Method distribution:** Extraction strategy breakdown

**Example Output:**
```
📈 Overall Statistics:
   Total segments: 983
   Segments with keywords: 515 (52.4%)
   Average keywords per segment: 6.09
   Total unique keywords: 2,488

🔥 Top 20 Most Common Keywords:
   morning              9 (1.7%)
   happy                9 (1.7%)
   good morning         8 (1.6%)
   birthday             8 (1.6%)
```

### 4. Analyze Topic Clusters

Identify recurring topics and conversation patterns:

```bash
GUILD_ID=1254694808228986912 npm run conversations:analyze-keyword-groups
```

**Insights Provided:**
- **Recurring topics:** Keywords appearing in multiple conversations
- **Conversation overlap:** Pairs of conversations with similar keywords
- **Orphaned segments:** Single-message conversations that match topics
- **Topic continuity:** Conversations about the same topic across time

**Example Output:**
```
🎯 Key Insights:
   1. 109 recurring topics (3+ conversations)
   2. 2 high-overlap pairs within 1 hour
   3. 4 orphaned messages could be merged
   4. 0 topic continuations without participant overlap
```

**Adjustable Parameters:**
```bash
# Set minimum keyword overlap threshold (default: 0.4)
GUILD_ID=xxx MIN_OVERLAP=0.5 npm run conversations:analyze-keyword-groups
```

### 5. Regroup Conversations (Optional)

Merge orphaned messages into conversations based on keyword similarity:

```bash
# Dry run (recommended first) with default settings
GUILD_ID=1254694808228986912 npm run conversations:regroup-keywords

# Customize time window and overlap threshold
GUILD_ID=xxx TIME_WINDOW=43200 MIN_OVERLAP=0.3 npm run conversations:regroup-keywords

# Execute merges after review
GUILD_ID=xxx TIME_WINDOW=43200 MIN_OVERLAP=0.3 npm run conversations:regroup-keywords -- --execute
```

**Merge Criteria:**
- **Minimum keyword overlap:** 40% weighted similarity (configurable via `MIN_OVERLAP`)
- **Time window:** 24 hours / 1440 minutes (configurable via `TIME_WINDOW`)
- **Same channel:** Required (orphans only merge with conversations in same channel)
- **Shared participants:** Prioritized in scoring but not required

**Recommended Settings:**

| Scenario | TIME_WINDOW | MIN_OVERLAP | Notes |
|----------|-------------|-------------|-------|
| Conservative | 1440 (24h) | 0.5 (50%) | Only merge highly related, recent messages |
| Balanced | 10080 (7d) | 0.4 (40%) | Good default for most servers |
| Aggressive | 43200 (30d) | 0.3 (30%) | Merge older orphans, looser topic matching |
| Very aggressive | 525600 (1yr) | 0.25 (25%) | Long-running topics, may create false positives |

**Merge Quality Score:**
```
score = (keyword_overlap × (1 + shared_participants)) / (1 + time_diff_minutes / 10)
```

**Output (Dry Run):**
```
🎯 Top 20 Merge Candidates:
Orphan ID                     Target ID                     Overlap   Time        Shared
seg_1424476383601496095_1762  seg_1420478808644911247_1762  40.7%     15830.0m    1
seg_1406443352500736001_1762  seg_1413722550135034050_1762  70.7%     28939.8m    1
```

## Use Cases

### 1. Finding Orphaned Messages

**Problem:** Single-message "conversations" that actually belong to nearby topics.

**Solution:**
```bash
# Analyze orphans
GUILD_ID=xxx npm run conversations:analyze-keyword-groups

# If orphans found, merge them
GUILD_ID=xxx npm run conversations:regroup-keywords -- --execute
```

### 2. Identifying Long-Running Topics

**Problem:** Want to track conversations about the same topic across days/weeks.

**Solution:** Look at "Recurring Topics" output:
```
Keyword             Convs   Time Span
morning             9       473.9d    # Topic recurring for 1.3 years
good morning        8       481.2d
```

### 3. Detecting Topic Drift

**Problem:** Conversation veered off-topic mid-discussion.

**Solution:** The `TopicDriftDetector` now uses TF-IDF-based keyword extraction instead of hardcoded stopwords. It automatically detects when keyword overlap drops below threshold.

### 4. Improving Conversation Scoring

**Problem:** Messages are semantically similar but not detected by embeddings.

**Solution:** Keyword overlap is now 10% of the conversation score:
```typescript
// ConversationScorer.ts weights:
relationship: 45%
semantic:     25%
temporal:     20%
keywords:     10%
```

### 5. Preparing for LLM-Assisted Sorting

**Problem:** Want to give LLM rich context about conversation topics.

**Solution:** Keywords provide:
- Topic labels for conversations
- Quick topic similarity comparison
- Foundation for semantic clustering
- Context without reading full message content

## Advanced Configuration

### Rebuilding Vocabulary

Rebuild vocabulary when:
- Adding many new conversations
- Vocabulary is >1 month old
- Language patterns have shifted

```bash
GUILD_ID=xxx npm run keywords:build-vocabulary
```

### Clearing and Re-Extracting Keywords

If keyword quality degrades or you update extraction logic:

```bash
# Clear existing keywords
psql $POSTGRES_URL -c "UPDATE conversation_segments
  SET features = features - 'keywords'
  WHERE guild_id = 'xxx' AND features ? 'keywords';"

# Re-extract
GUILD_ID=xxx npm run keywords:extract-all
```

### Customizing Extraction Parameters

Edit `src/features/keywords/TFIDFExtractor.ts`:

```typescript
// Adjust these constants
private readonly DEFAULT_TOP_N = 10;          // Keywords per conversation
private readonly DEFAULT_MIN_SCORE = 0.1;     // Minimum TF-IDF score
private readonly MAX_NGRAM_LENGTH = 3;        // Max phrase length
```

Edit `src/features/keywords/VocabularyBuilder.ts`:

```typescript
private readonly DEFAULT_MIN_DOC_FREQUENCY = 2;    // Min conversations containing term
private readonly DEFAULT_MAX_DOC_FREQUENCY = 0.8;  // Stopword threshold (80%)
```

### URL Filtering

The system automatically filters URL-related tokens to prevent noise. To add more filters:

Edit both `TFIDFExtractor.ts` and `VocabularyBuilder.ts`:

```typescript
const urlTokens = new Set([
  // Your custom tokens here
  "discord", "youtube", "tenor", "imgur",
  // ...
]);
```

## Integration with Existing Systems

### 1. ConversationManager

Keywords are automatically extracted during segment finalization:

```typescript
// src/features/relationship-network/ConversationManager.ts
const keywords = await this.keywordExtractor.extractKeywords(
  keywordMessages,
  buffer.guildId,
  { topN: 10, method: "hybrid" }
);

features.keywords = keywords;
```

### 2. ConversationScorer

Keyword overlap is calculated during conversation scoring:

```typescript
// src/features/relationship-network/ConversationScorer.ts
private calculateKeywordScore(
  keywords1?: ConversationKeywords,
  keywords2?: ConversationKeywords,
): number {
  if (!keywords1 || !keywords2) return 0;

  // Jaccard similarity + weighted overlap
  const jaccard = this.calculateJaccardSimilarity(keywords1.terms, keywords2.terms);
  const weighted = this.calculateWeightedOverlap(keywords1.terms, keywords2.terms);

  return (jaccard + weighted) / 2;
}
```

### 3. TopicDriftDetector

Now uses TF-IDF extraction instead of hardcoded stopwords:

```typescript
// src/features/relationship-network/TopicDriftDetector.ts
private extractKeywords(text: string): Set<string> {
  const keywords = this.tfidfExtractor.extractKeywordsSimple([message], 5);
  return new Set(keywords.map((k) => k.word));
}
```

## Performance Considerations

### Vocabulary Building
- **Time:** ~1 second per 1000 conversations
- **Memory:** ~50MB per 15,000 terms
- **Recommendation:** Rebuild weekly for active servers

### Keyword Extraction
- **Time:** ~5-10ms per conversation (hybrid mode)
- **Memory:** Minimal (streaming processing)
- **Recommendation:** Extract in batches of 100-500

### Database Impact
- **Storage:** ~1KB per conversation (JSONB keywords)
- **Indexes:** GIN index on `features` column recommended
- **Recommendation:** Vacuum after large batch extractions

## Troubleshooting

### "No keywords extracted"

**Causes:**
- Messages too short (< 2 words)
- All stopwords detected
- URL-heavy content

**Solutions:**
- Lower `DEFAULT_MIN_SCORE` threshold
- Check vocabulary stopword ratio
- Review message content quality

### "Keywords contain noise"

**Causes:**
- URL fragments not filtered
- Low-quality message content
- Wrong language detection

**Solutions:**
- Add URL tokens to filter list
- Increase `DEFAULT_MIN_DOC_FREQUENCY`
- Rebuild vocabulary with quality filter

### "High overlap but no merges"

**Causes:**
- Time window too narrow (default: 30min)
- Overlap threshold too high (default: 40%)
- Different channels

**Solutions:**
- Increase `TIME_WINDOW_MINUTES` in regroup script
- Lower `KEYWORD_THRESHOLD`
- Enable cross-channel merging (edit script)

## Future Enhancements

Potential improvements to the keyword system:

1. **LLM-based keyword refinement** - Use Gemini to validate/enhance keywords
2. **Topic clustering** - Automatically group conversations into topic categories
3. **Trend detection** - Identify emerging topics over time
4. **Multi-language support** - Language-specific tokenization and stopwords
5. **Entity extraction** - Detect names, places, products mentioned
6. **Keyword-based search** - Find conversations by keyword query
7. **Topic recommendations** - Suggest related conversations to users

## API Reference

### KeywordExtractor

```typescript
class KeywordExtractor {
  // Extract keywords from conversation messages
  async extractKeywords(
    messages: KeywordMessage[],
    guildId: string,
    options?: KeywordExtractionOptions
  ): Promise<ConversationKeywords>

  // Build vocabulary for a guild
  async buildVocabulary(guildId: string, forceRebuild?: boolean): Promise<void>

  // Get vocabulary statistics
  async getVocabularyStats(guildId: string): Promise<VocabularyStats | null>

  // Calculate keyword overlap between conversations
  calculateKeywordOverlap(
    keywords1: ConversationKeywords,
    keywords2: ConversationKeywords,
    weighted?: boolean
  ): number
}
```

### Options

```typescript
interface KeywordExtractionOptions {
  method?: "tfidf" | "semantic" | "hybrid";  // default: "hybrid"
  topN?: number;                              // default: 10
  minScore?: number;                          // default: 0.1
  vocabulary?: Map<string, VocabularyEntry>;  // optional custom vocab
}
```

### Output Format

```typescript
interface ConversationKeywords {
  terms: KeywordScore[];        // Extracted keywords
  extracted_at: string;         // ISO timestamp
  method: string;               // Extraction method used
  version: string;              // Algorithm version
}

interface KeywordScore {
  word: string;                 // Keyword or phrase
  score: number;                // Normalized score (0-1)
  count: number;                // Frequency in conversation
  type: "tfidf" | "tfidf-bigram" | "tfidf-trigram" | "semantic" | "hybrid";
}
```

## Conclusion

The keyword extraction system provides a powerful foundation for programmatic conversation analysis. By leveraging TF-IDF, semantic clustering, and per-guild vocabularies, it captures conversation topics without hardcoded rules or language assumptions.

Use keywords to:
- ✅ Find and merge orphaned messages
- ✅ Track recurring topics across time
- ✅ Enhance conversation scoring
- ✅ Detect topic drift automatically
- ✅ Prepare quality context for LLM-assisted sorting

For questions or issues, refer to the troubleshooting section or check the source code documentation.
