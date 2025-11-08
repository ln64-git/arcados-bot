# Analysis Scripts Guide

## Overview

Three comprehensive analysis scripts to help you understand your Discord server's interaction patterns, conversation dynamics, and individual user behavior.

## Commands

### 1. Relationship Network Analysis
```bash
npm run analyze:relationships <guild_id>
```

**What it shows:**
- **Overall Statistics**: Total edges, interaction types distribution (mentions/replies/reactions)
- **Top 10 Most Connected Users**: Users with highest total interactions
- **Strongest Bidirectional Relationships**: Pairs with mutual interactions
- **Relationship Reciprocity**: One-way vs two-way relationships
- **Interaction Strength Distribution**: How many edges fall into different interaction ranges

**Example output:**
```
📊 RELATIONSHIP NETWORK ANALYSIS

📈 Overall Statistics:
Total Edges: 360
Edges with Mentions: 164 (45.6%)
Edges with Replies: 247 (68.6%)
Total Mentions: 251
Total Replies: 499

👥 Top 10 Most Connected Users:
Rank | Username      | Total Interactions | Connections
   1 | Lucas         |                195 |          86
   2 | shinji_ikari  |                 94 |          41

💪 Top 10 Strongest Bidirectional Relationships:
   1 | Between 0.5 and 7 Hz. | St. Evangelos | 44
```

**Use cases:**
- Identify most active community members
- Find strong friendship pairs
- Understand interaction patterns (do people reply more than mention?)
- Detect isolated users (low connection count)

---

### 2. Conversation Segments Analysis
```bash
npm run analyze:conversations <guild_id>
```

**What it shows:**
- **Overall Statistics**: Average messages/segment, duration, participants
- **Segment Size Distribution**: How many conversations have 1-5, 6-10, 11-20 messages, etc.
- **Duration Distribution**: 0-15 min, 15-60 min, 1-4 hours, etc.
- **Top 10 Largest Conversations**: Biggest conversations by message count
- **Channel Activity**: Which channels have most conversations
- **Participant Count Distribution**: 2-person vs group conversations
- **Hourly Activity Pattern**: Visual bar chart of when conversations happen

**Example output:**
```
💬 CONVERSATION SEGMENTS ANALYSIS

📈 Overall Statistics:
Total Segments: 54
Average Messages/Segment: 12.3
Average Duration: 45.2 minutes (0.8 hours)

📊 Segment Size Distribution:
Messages     | Segments   | Percentage
1-5          |         20 |  37.0%
6-10         |         15 |  27.8%

🕐 Conversation Activity by Hour of Day:
Hour | Count | Activity
  14 |    12 | ████████████████████
  15 |     8 | █████████████
```

**Use cases:**
- Understand conversation patterns (short bursts vs long discussions)
- Find peak activity hours
- Identify most active channels
- Detect anomalies (conversations spanning days = potential grouping issues)

---

### 3. Individual User Analysis
```bash
npm run analyze:user <guild_id> <user_id_or_username>
```

**What it shows:**
- **Message Statistics**: Total messages, reply rate, mentions, first/last message, messages per day
- **Top 10 Channels**: Where this user is most active
- **Top People User Interacts With**: Outgoing relationships (who they talk to)
- **Top People Who Interact With User**: Incoming relationships (who talks to them)
- **Conversation Participation**: How many conversations, avg messages per conversation
- **Activity by Hour**: Visual hourly activity pattern
- **Recent Messages**: Last 5 messages with timestamps and channels

**Example output:**
```
👤 USER ANALYSIS: Lucas
   User ID: 716817185955250176

📊 Message Statistics:
Total Messages: 1,234
Replies: 456 (37.0%)
Messages/Day: 15.3

💬 Top 10 People This User Interacts With:
Username       | Mentions | Replies | Reactions | Total
shinji_ikari   |        8 |      15 |         0 |    23
$CLUE$         |       16 |       2 |         0 |    18

🕐 Activity by Hour of Day:
Hour | Count | Activity
  14 |   145 | ██████████████████████████████
  15 |    98 | ████████████████████
```

**Use cases:**
- User behavior profiling
- Identify power users vs lurkers
- Find user's social circle
- Understand when a user is most active
- Track user engagement over time

---

## Quick Comparison: analyze vs view Commands

| Command | Purpose | Detail Level | Speed |
|---------|---------|--------------|-------|
| `analyze:relationships` | Deep network analysis | High - 6 different analyses | Slower |
| `view:relationships` | Quick top relationships | Low - just top 10 list | Fast |
| `analyze:conversations` | Full conversation insights | High - 7 analyses + charts | Slower |
| `analyze:user` | Complete user profile | High - 7 sections | Medium |
| `view:recent` | Recent activity snapshot | Low - just recent messages | Fast |

**Rule of thumb:**
- Use `view:*` for quick checks
- Use `analyze:*` for deep insights and reports

---

## Tips & Tricks

### Finding User IDs
If you don't know a user's ID:
```bash
# First, identify bots (to exclude)
npm run identify:bots <guild_id>

# Then search by partial username
npm run analyze:user <guild_id> "Lucas"
# Works with partial matches!
```

### Combining Analysis
For a complete server overview:
```bash
# 1. Overall relationship network
npm run analyze:relationships <guild_id> > relationships-report.txt

# 2. Conversation patterns
npm run analyze:conversations <guild_id> > conversations-report.txt

# 3. Top 3 users deep-dive
npm run analyze:user <guild_id> <user_1> > user1-report.txt
npm run analyze:user <guild_id> <user_2> > user2-report.txt
npm run analyze:user <guild_id> <user_3> > user3-report.txt
```

### Detecting Issues

**Red flags in `analyze:conversations`:**
- Segments with duration > 24 hours = grouping issue
- Segments with > 50 gaps of 1+ hour = multiple conversations merged
- Low reply rate (< 10%) = weak conversation cohesion

**Red flags in `analyze:relationships`:**
- Total replies = 0 = referenced_message_id not captured
- Edges with mentions > 0 but total interactions = 0 = data sync issue

**Red flags in `analyze:user`:**
- Messages/Day suddenly drops to 0 = user left or was banned
- Reply rate < 5% = potential bot or lurker
- All interactions with single user = DM bot or spam

---

## Example Workflow

### New Server Analysis
```bash
# 1. Get overview
npm run analyze:relationships <guild_id>

# 2. Check conversation quality
npm run analyze:conversations <guild_id>

# 3. Profile top 3 users from step 1
npm run analyze:user <guild_id> <top_user_1>
npm run analyze:user <guild_id> <top_user_2>
npm run analyze:user <guild_id> <top_user_3>
```

### Monthly Report
```bash
#!/bin/bash
GUILD="1254694808228986912"
DATE=$(date +%Y-%m)

npm run analyze:relationships $GUILD > reports/$DATE-relationships.txt
npm run analyze:conversations $GUILD > reports/$DATE-conversations.txt

# Top 5 users
for user in $(npm run view:relationships $GUILD 2>/dev/null | grep "1\." | awk '{print $1}'); do
  npm run analyze:user $GUILD $user > reports/$DATE-user-$user.txt
done
```

---

## Performance Notes

- **Relationship analysis**: ~2-5 seconds for 50k messages
- **Conversation analysis**: ~3-7 seconds for 50k messages
- **User analysis**: ~1-3 seconds per user

For large servers (>100k messages), consider running analyses during off-peak hours.
