# Topic Drift Detection - Testing & Tuning Guide

## Overview

The Topic Drift Detection system uses AI to intelligently split conversations when topics change, preventing unrelated messages from being grouped together.

## System Components

### 1. TopicDriftDetector Service
**Location**: `src/features/relationship-network/TopicDriftDetector.ts`

Core service that:
- Generates topic labels using AI
- Detects when conversations drift to new topics
- Analyzes conversations for split points using embeddings + LLM

### 2. ConversationManager Integration
**Location**: `src/features/relationship-network/ConversationManager.ts`

Real-time drift detection in `addMessageToStream()`:
- Checks for topic drift before routing messages to conversations
- Generates topic labels after 5 messages
- Creates new conversations when drift detected

Batch processing in `regenerateConversationsAdvanced()`:
- Phase 3 analyzes grouped conversations for internal splits
- Splits conversations with 10+ messages or 60+ min duration
- Uses sliding window approach

### 3. Database Schema
**Added columns to `conversation_segments` table:**
- `topic_label` - AI-generated short topic description
- `topic_confidence` - Confidence score (0-1)
- `parent_segment_id` - If split from another conversation
- `split_reason` - Why conversation was split (for debugging)

## Testing the System

### Step 1: Enable Topic Drift Detection

The system needs to be initialized with AIManager. In your bot initialization code:

```typescript
import { ConversationManager } from "./features/relationship-network/ConversationManager";
import { AIManager } from "./features/ai-assistant/AIManager";

const db = new PostgreSQLManager();
await db.connect();

const conversationManager = new ConversationManager(db);
const aiManager = AIManager.getInstance();

// Enable topic drift detection
conversationManager.setAIManager(aiManager);
```

### Step 2: Analyze Existing Conversations

Find a conversation with obvious topic drift:

```bash
# List recent conversations
npm run inspect:conversations

# Analyze specific conversation for topic drift
npm run analyze:topic-drift <conversation_id>
```

The analysis tool shows:
- Semantic similarity scores between message windows
- Detected split points with confidence scores
- Topic labels for each segment
- Recommendations for splitting

### Step 3: Run Post-Processing Split

Split existing conversations that have topic drift:

```bash
# Split conversations from past 7 days with 20+ messages
GUILD_ID=your_guild npm run split:conversations

# Customize parameters
GUILD_ID=your_guild DAYS=14 MIN_MESSAGES=30 MIN_DURATION=90 npm run split:conversations
```

**Environment Variables:**
- `GUILD_ID` - Guild to process (required)
- `DAYS` - Lookback period (default: 7)
- `MIN_MESSAGES` - Minimum messages to analyze (default: 20)
- `MIN_DURATION` - Minimum duration in minutes (default: 60)

### Step 4: Test Real-Time Detection

Real-time detection works automatically once `setAIManager()` is called. Monitor logs for:

```
🔸 Topic drift detected: AI detected clear topic change
```

## Tuning Thresholds

### Semantic Similarity Thresholds

**Location**: `TopicDriftDetector.ts`

```typescript
private readonly BASE_SEMANTIC_THRESHOLD = 0.45;  // Aggressive baseline (highly sensitive)
private readonly HIGH_CONFIDENCE_THRESHOLD = 0.65; // Clearly same topic
private readonly LOW_CONFIDENCE_THRESHOLD = 0.35;  // Likely different topic
```

**Current Tuning:**
- **0.45** = Highly sensitive to topic changes, will catch subtle shifts
- **Previously 0.55** = Balanced but missed some distinct topic changes
- **Originally 0.65** = Too conservative, missed obvious topic shifts

**Tuning Guide:**
- **Lower BASE_SEMANTIC_THRESHOLD** (0.40) = Even more aggressive splitting
- **Raise BASE_SEMANTIC_THRESHOLD** (0.50-0.55) = More moderate splitting
- If too many false splits: Raise thresholds by 0.05-0.10
- If missing obvious splits: Lower thresholds by 0.05

### Conversation Size Filters

**Location**: `ConversationManager.ts` (Phase 3) and `split-conversations-by-topic.ts`

```typescript
// Only analyze conversations with:
if (convo.messages.length < 10) continue;        // Min 10 messages
if (duration < 60) continue;                     // Min 60 minutes
```

**Tuning Guide:**
- Increase minimums to focus on longer conversations
- Decrease to catch drift in shorter conversations
- Trade-off: Lower values = more API calls/processing time

### Analysis Window Size

**Location**: `TopicDriftDetector.ts` in `analyzeConversationForSplits()`

```typescript
const windowSize = 4;  // Analyze 4-message windows (highly granular)
const stepSize = 2;    // Move forward 2 messages at a time
```

**Current Tuning:**
- **4 messages** = Highly granular detection of topic shifts
- **2 message step** = Maximum sensitivity, 50% overlap between windows
- **Previously 5/3** = Good but missed some distinct topic boundaries
- **Originally 8/5** = Too coarse, averaged out topic changes

**Tuning Guide:**
- Larger windowSize (6-8) = More context, fewer splits, less API calls
- Smaller windowSize (3) = Extreme sensitivity, may over-split
- Adjust stepSize to control granularity (smaller = finer analysis, MORE API calls)

### AI Prompts

**Location**: `TopicDriftDetector.ts`

**Topic Label Generation:**
```typescript
// Line ~70
const prompt = `Analyze these messages and provide a SHORT topic label (2-5 words max)...`;
```

**Split Decision:**
```typescript
// Line ~355
const prompt = `Current conversation topic: "${currentTopicLabel}"...
Are these messages about the SAME topic or a DIFFERENT topic?
- If SAME topic or naturally related: respond with "continue"
- If DIFFERENT topic: respond with "split: [new topic label]"
- Be MODERATE - split when topics clearly change, but keep related discussions together`;
```

**Current Tuning:**
- **SENSITIVE** = Splits on distinct subjects, even if loosely related
- **Previously MODERATE** = Balanced but only caught 1 split in 110-message conversation
- **Originally CONSERVATIVE** = Missed obvious topic changes like "public speaking → bot testing"

**Tuning Guide:**
- Change to "AGGRESSIVE" for maximum splits (may over-fragment into individual messages)
- Change to "MODERATE" for fewer splits (good for related discussion threads)
- Change to "CONSERVATIVE" for minimal splits (only extreme topic changes)
- Add examples of what constitutes a topic change for your server's conversation style
- Modify based on your server's conversation patterns and desired granularity

## AI Model Configuration

Topic drift detection uses **Gemini Flash** for all topic labeling and utility work:
- Fast responses (~500ms)
- Generous free tier (1,500 requests/day)
- Good quality for classification/labeling tasks
- Cost-effective for production ($0.35 per 1M tokens if over free tier)

The final AI assistant responses continue to use Grok for higher quality.

**Model Setting**: `TOPIC_MODEL = "gemini-flash"` in `TopicDriftDetector.ts`

## Validation

### Check Split Quality

After splitting conversations:

```bash
# View the split segments
npm run inspect:conversations

# Analyze individual segments
npm run analyze:conversation 1
npm run analyze:conversation 2
```

**Good splits should:**
- Have distinct topics in each segment
- Maintain message coherence within segments
- Preserve reply chains and mentions
- Not split mid-conversation

### Monitor False Positives

**False Split Indicators:**
- Segments with < 5 messages (too aggressive)
- Same topic label across "different" segments
- Split mid-reply chain
- Users confused by fragmentation

**Solutions:**
- Raise semantic thresholds
- Increase minimum segment size
- Add topic similarity check to prevent splitting related topics

### Monitor False Negatives

**Missed Split Indicators:**
- Conversations with 50+ messages spanning multiple topics
- Users asking "what were we talking about?"
- Difficult to find relevant context in long conversations

**Solutions:**
- Lower semantic thresholds
- Decrease window size for finer granularity
- Adjust AI prompt to be less conservative

## Performance Considerations

### API Costs

Topic drift detection makes LLM calls for:
1. Topic label generation (after 5 messages per conversation)
2. Split decisions (for borderline semantic similarity)
3. Topic comparison (during batch analysis)

**Cost Control:**
- Adjust minimum message/duration filters
- Use embeddings-only mode (skip LLM calls) for initial testing
- Batch process during off-peak hours

### Processing Time

Batch splitting with `split:conversations`:
- ~2-3 seconds per conversation analyzed
- Dominated by LLM API calls
- Can process ~20-30 conversations/minute

**Optimization:**
- Process only high-priority time periods
- Run during maintenance windows
- Consider parallel processing for large backlogs

## Troubleshooting

### Issue: No splits detected when expected

**Diagnosis:**
```bash
npm run analyze:topic-drift <conversation_id>
```

Look for:
- Semantic similarity scores (should drop below 65% at split points)
- AI decision reasoning
- Embedding quality (are embeddings present?)

**Solutions:**
- Check if embeddings are generated for messages
- Lower semantic thresholds
- Review AI prompt - may be too conservative
- Verify message content isn't empty/too short

### Issue: Too many splits (over-splitting)

**Diagnosis:**
Review split_reason in database:
```sql
SELECT id, topic_label, split_reason, message_count 
FROM conversation_segments 
WHERE parent_segment_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

**Solutions:**
- Raise semantic thresholds (0.70+)
- Increase window size (10-12 messages)
- Add minimum segment size requirement
- Make AI prompt more conservative

### Issue: Real-time detection not working

**Check:**
1. Is `setAIManager()` called on ConversationManager?
2. Are messages getting embeddings?
3. Check logs for "Topic drift detected" messages
4. Verify AIManager has valid API keys

### Issue: Slow performance

**Optimize:**
- Reduce number of LLM calls by raising thresholds
- Increase window step size (faster but less granular)
- Process smaller batches
- Use faster AI model (grok vs openai)

## Best Practices

1. **Start Conservative**: Use high thresholds, then lower if needed
2. **Test on Known Cases**: Find conversations you know have drift, verify detection
3. **Monitor in Production**: Track split rates and user feedback
4. **Iterate Prompts**: Adjust AI instructions based on your server's conversation style
5. **Balance Precision/Recall**: Perfect detection is impossible - tune for your use case

## Example Workflow

```bash
# 1. Find a problematic conversation
npm run inspect:conversations

# 2. Analyze it for drift
npm run analyze:topic-drift conv_12345

# 3. If drift detected, split it
GUILD_ID=xxx npm run split:conversations

# 4. Verify the splits
npm run analyze:conversation 1
npm run analyze:conversation 2

# 5. If quality is good, process more conversations
GUILD_ID=xxx DAYS=30 npm run split:conversations

# 6. Enable real-time detection in production
# (by calling conversationManager.setAIManager(aiManager))
```

## Monitoring & Metrics

Track these metrics to tune the system:

- **Split Rate**: % of conversations split vs analyzed
- **Avg Segments**: Average segments per split conversation
- **Segment Size**: Avg messages per segment (should be 5-20)
- **Topic Coherence**: Manual review of split quality
- **User Feedback**: Are splits helping or hindering?

## Future Enhancements

Potential improvements:
- ML model to learn optimal thresholds per server
- User feedback loop (mark good/bad splits)
- Multi-topic conversations (parallel topics, not sequential)
- Cross-conversation topic tracking
- Automatic topic summarization

