# Testing Guide: Realtime Relationship Networks

## Prerequisites

1. **Ensure PostgreSQL is set up:**
   ```bash
   # Your .env should have:
   POSTGRES_URL=your_postgres_connection_string
   GUILD_ID=your_test_guild_id
   ```

2. **Install dependencies (if not already):**
   ```bash
   npm install
   ```

## Testing Steps

### 1. Initial Boot & Database Healing

**Start the bot:**
```bash
npm run dev
```

**What to watch for:**
- Console should show: `🔹 Starting database healing pass...`
- `🔹 Healing guild: <guild_name>`
- `🔹 Syncing channels...`
- `🔹 Syncing members...`
- `🔹 Syncing messages...`
- `✅ Database healing pass completed`

**Verify healing worked:**
```bash
npm run test:healing
```

This shows:
- Channel watermarks (last synced message IDs)
- Message counts per channel
- Members that need relationship networks

### 2. Test Live Sync (Message Interactions)

**In your Discord server:**

1. **Send some messages** in a channel:
   - Have multiple users chat back and forth
   - Mention each other
   - Reply to messages

2. **Wait 2 minutes** (for rollup timer)

3. **Check what was recorded:**
   ```bash
   npm run test:realtime [GUILD_ID] [USER_ID]
   ```

   Example:
   ```bash
   npm run test:realtime 1254694808228986912
   ```

   This shows:
   - Total relationship edges created
   - Recent edges with interaction counts
   - Conversation segments detected
   - If you provide a USER_ID, shows that user's relationships

### 3. Test Conversation Segments

**In Discord:**

1. **Start a multi-user conversation:**
   - Get 2-3 people chatting in the same channel
   - Keep it going for a few minutes
   - Then let it sit idle for 5+ minutes (to trigger finalization)

2. **Check segments:**
   ```bash
   npm run test:realtime [GUILD_ID]
   ```

   Look for the "Recent conversation segments" section showing:
   - Number of participants
   - Message counts
   - Time ranges

### 4. Test Relationship Edges

**Verify edge updates:**

```sql
-- Connect to your PostgreSQL and run:
SELECT 
  user_a, 
  user_b, 
  msg_a_to_b, 
  msg_b_to_a, 
  mentions, 
  replies, 
  total,
  last_interaction
FROM relationship_edges 
WHERE guild_id = 'YOUR_GUILD_ID'
ORDER BY last_interaction DESC 
LIMIT 10;
```

**What you should see:**
- Directed edges (A→B and B→A may differ)
- Interaction counters incrementing
- `last_interaction` timestamps updating

### 5. Test Database Queries Directly

**Check edge counts:**
```sql
SELECT COUNT(*) FROM relationship_edges WHERE guild_id = 'YOUR_GUILD_ID';
```

**Check segments:**
```sql
SELECT 
  id,
  participants,
  message_count,
  start_time,
  end_time
FROM conversation_segments
WHERE guild_id = 'YOUR_GUILD_ID'
ORDER BY start_time DESC
LIMIT 5;
```

**Check pairs:**
```sql
SELECT 
  u_min,
  u_max,
  total_interactions,
  array_length(segment_ids, 1) as segment_count
FROM relationship_pairs
WHERE guild_id = 'YOUR_GUILD_ID'
ORDER BY last_interaction DESC
LIMIT 10;
```

### 6. Test Incremental Updates

**Watch in real-time:**

1. **Monitor the database while chatting:**
   ```bash
   # In one terminal, run:
   watch -n 5 'psql $POSTGRES_URL -c "SELECT COUNT(*) FROM relationship_edges WHERE guild_id = '\''YOUR_GUILD_ID'\'';"'
   ```

2. **In Discord, have users:**
   - Send messages → should increment `msg_a_to_b`/`msg_b_to_a`
   - Mention each other → should increment `mentions`
   - Reply to messages → should increment `replies`
   - React to messages → should increment `reactions`

3. **Wait 2 minutes** → rollup should update `members.relationship_network`

### 7. Test Bot Mentions with Memory

**Try mentioning the bot in conversations:**

1. **Mention the bot** in a channel with multiple users
2. The bot should respond (existing AI functionality)
3. **Check if relationships are tracked:**
   ```bash
   npm run test:realtime [GUILD_ID] [BOT_USER_ID]
   ```

   The bot should have edges to users it interacts with.

### 8. Verify Periodic Maintenance

**Wait 10+ minutes after starting the bot**, then check logs for:
- `🔹 Running periodic maintenance...`
- `🔹 Compacted old segments`
- `✅ Periodic maintenance completed`

**Check rolling windows:**
```sql
SELECT 
  user_a,
  user_b,
  rolling_7d,
  rolling_30d,
  total
FROM relationship_edges
WHERE guild_id = 'YOUR_GUILD_ID'
  AND last_interaction > NOW() - INTERVAL '7 days'
LIMIT 10;
```

## Common Issues & Debugging

### Issue: No edges being created

**Check:**
1. Is `LiveSyncWatcher` started? (should see in logs)
2. Are messages being sent? (must be non-bot users)
3. Check console for errors from `LiveSyncWatcher`


### Issue: Segments not finalizing

**Check:**
1. Are there at least 3 messages in the conversation?
2. Has it been 5+ minutes since last message?
3. Check `ConversationManager` logs for finalization errors

**Manual trigger** (for testing):
- Wait 5 minutes of inactivity
- Or restart the bot (triggers `finalizeAllSegments`)

### Issue: Rollups not happening

**Check:**
1. Is the 2-minute timer running? (check logs)
2. Are users in the `rollupQueue`? (users should be queued after interactions)

**Manual trigger:**
```typescript
// In a script or REPL:
const relManager = new RelationshipNetworkManager(db);
await relManager.rollupEdgesToMemberNetwork(userId, guildId);
```

### Issue: Healing taking too long

**This is expected on first run** - it needs to:
- Sync all channels
- Sync all members
- Backfill messages (up to 1000 per channel)

**To speed up:**
- Limit channels in `DatabaseHealer.healChannels()` (add a filter)
- Reduce `maxMessages` in backfill methods

## Quick Test Checklist

- [ ] Bot starts without errors
- [ ] Database healing runs on boot
- [ ] LiveSyncWatcher starts
- [ ] Messages create edges (check `test:realtime`)
- [ ] Mentions increment `mentions` counter
- [ ] Replies increment `replies` counter
- [ ] Reactions increment `reactions` counter
- [ ] Segments finalize after 5m inactivity
- [ ] Rollups happen every 2 minutes
- [ ] Maintenance runs every 10 minutes

## Performance Testing

**For a busy server:**

1. **Monitor edge table growth:**
   ```sql
   SELECT COUNT(*) FROM relationship_edges;
   ```

2. **Check segment count:**
   ```sql
   SELECT COUNT(*) FROM conversation_segments;
   ```

3. **Watch for performance issues:**
   - Slow queries on `relationship_edges`
   - Large `segment_ids` arrays in `relationship_pairs`
   - Too many segments (should compact old ones)

**If performance degrades:**
- Reduce `limit` in `rollupEdgesToMemberNetwork`
- Increase compaction frequency
- Trim `segment_ids` more aggressively

## Next Steps

Once basic testing is working:
1. Test with multiple channels
2. Test with 10+ users chatting simultaneously
3. Test bot mentions in group conversations
4. Verify relationship networks are being used by AI (when wired up)

