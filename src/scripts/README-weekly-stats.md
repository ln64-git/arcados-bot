# Weekly Message Statistics Script

## Overview

The `analyze-weekly-message-stats.ts` script provides daily message counts and estimated token counts for all messages in your Discord server over the past 7 days.

## Usage

### Using npm script (recommended):
```bash
npm run analyze:weekly-stats <guild_id>
```

### Using tsx directly:
```bash
npx tsx src/scripts/analyze-weekly-message-stats.ts <guild_id>
```

### Using environment variable:
```bash
# Set GUILD_ID in your .env file, then:
npm run analyze:weekly-stats
```

## Output

The script displays:

1. **Daily Breakdown Table**
   - Date
   - Number of messages
   - Estimated token count
   - Number of unique authors
   - Number of channels with activity

2. **Weekly Summary**
   - Total messages across all 7 days
   - Total estimated tokens
   - Average messages/tokens per day
   - Average tokens per message
   - Busiest day (highest message count)
   - Quietest day (lowest message count)

3. **Estimated API Costs**
   - Cost estimates for using all messages as context in various AI APIs
   - Includes GPT-4 Turbo, GPT-4o, and Claude 3.5 Sonnet

## Token Estimation

The script uses a simple approximation of **~4 characters per token** for English text. This is a common industry standard that works reasonably well for most text:

- This matches OpenAI's general guidance
- It's close to the actual tokenization for most English content
- May vary slightly for code, emojis, or non-English text

## Example Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Weekly Message Statistics - Guild: 123456789
  11/5/2025 → 11/12/2025
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Daily Breakdown:

┌─────────────────┬──────────┬────────────┬──────────┬──────────┐
│      Date       │ Messages │   Tokens   │ Authors  │ Channels │
├─────────────────┼──────────┼────────────┼──────────┼──────────┤
│ 11/5/2025       │      342 │     12,456 │       24 │        8 │
│ 11/6/2025       │      289 │     10,234 │       19 │        7 │
│ 11/7/2025       │      401 │     15,678 │       31 │       12 │
...
└─────────────────┴──────────┴────────────┴──────────┴──────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Weekly Summary:
   📨 Total Messages: 2,456
   🔤 Total Tokens: 89,234
   📈 Average per Day: 351 messages, 12,748 tokens
   💬 Average Tokens per Message: 36
   🔥 Busiest Day: 11/7/2025 (401 messages, 15,678 tokens)
   😴 Quietest Day: 11/6/2025 (289 messages, 10,234 tokens)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Use Cases

- **Context Window Planning**: Understand how much message history fits in AI model context windows
- **API Cost Estimation**: Estimate costs before using messages in AI workflows
- **Activity Monitoring**: Track server activity trends over time
- **Capacity Planning**: Plan for database and processing requirements

## Notes

- Only counts active messages (where `active = true` in the database)
- Token estimation is approximate and may differ from actual tokenizer counts
- Cost estimates assume input tokens only (output tokens cost more)
- Requires PostgreSQL database with messages synced

