# Starboard Feature

The starboard feature automatically tracks and displays highly-reacted messages in a dedicated channel.

## How it works

1. **Reaction Tracking**: When users react to messages with the ⭐ emoji, the bot tracks the reaction count
2. **Threshold**: Messages need 3 or more star reactions to be added to the starboard
3. **Automatic Posting**: When a message reaches the threshold, it's automatically posted to the starboard channel
4. **Live Updates**: The starboard message is updated in real-time as more reactions are added or removed
5. **Auto-Removal**: If a message drops below 3 stars, it's automatically removed from the starboard

## Configuration

Add the following environment variable to your `.env` file:

```env
STARBOARD_CHANNEL_ID=your_starboard_channel_id_here
```

## Commands

### `/starboard stats`

Shows statistics about the starboard:

- Total starred messages
- Total stars given
- Average stars per message
- Most starred message

### `/starboard recent [limit]`

Shows recent starred messages (1-10, default 5)

## Features

- **Rich Embeds**: Starboard messages include author info, original content, star count, and jump links
- **Image Support**: Automatically includes images from the original message
- **Persistent Storage**: Uses both Redis (cache) and MongoDB (persistence) for reliability
- **Real-time Updates**: Star counts update automatically as reactions change
- **Bot Message Filtering**: Ignores messages from bots to prevent spam

## Database Collections

- `starboardEntries`: Stores starboard entry data including original message ID, starboard message ID, star count, and timestamps

## Permissions Required

The bot needs the following permissions in the starboard channel:

- `Send Messages`
- `Embed Links`
- `Read Message History`

The bot needs the following permissions in channels where it monitors reactions:

- `Read Message History`
- `Add Reactions` (to see reaction counts)
