# Roll Command Feature

The roll command allows users to gamble for their freedom from voice channel bans by rolling a 20-sided die once per day.

## How it works

1. **Daily Limit**: Each user can only roll once per day (resets at midnight)
2. **Dice Roll**: Rolls a 20-sided die (1-20)
3. **Natural 20**: If you roll a 20, you get unbanned from ALL voice channels you were banned from

## Command

### `/roll`

Roll the dice and see your fate!

- **Daily Limit**: Only works once per day per user
- **Natural 20**: Automatically unbans you from all channels you were banned from
- **Results**: Shows your roll value and any unbans that occurred

## Features

- **Daily Reset**: Rolls reset at midnight (server time)
- **Automatic Unbanning**: Natural 20s instantly unban you from all channels
- **Persistent Storage**: Uses Redis (cache) and MongoDB (persistence)
- **Rich Embeds**: Beautiful visual feedback for all results

## Database Collections

- `rollData`: Stores user roll statistics including:
  - `userId`: Discord user ID
  - `guildId`: Server ID
  - `lastRollDate`: Last roll date (YYYY-MM-DD)
  - `totalRolls`: Total number of rolls made
  - `totalTwenties`: Number of natural 20s achieved
  - `lastRollValue`: Value of the last roll
  - `createdAt`: When the user first rolled
  - `lastUpdated`: Last time data was updated

## Integration with Voice System

The roll command integrates with the existing voice channel ban system:

- **Checks Bans**: Scans all voice channels to find where the user is banned
- **Automatic Unban**: Uses the existing unban system when a 20 is rolled
- **Permission Respect**: Only unbans from channels where the bot has permission
- **Logging**: All unbans are logged for audit purposes

## Permissions Required

The bot needs the following permissions:

- `Send Messages` - To send roll results
- `Embed Links` - To show rich embeds
- `Manage Channels` - To unban users from voice channels
- `Connect` - To check voice channel permissions

## Example Usage

```
/roll
🎲 You rolled a 20! You've been unbanned from 3 channel(s)! You're free!

/roll
🔸 You've already rolled today! Your last roll was 15. Try again tomorrow!

/roll
🔹 18 - Good roll! But not quite enough for freedom...
```

## Strategy Tips

- **Timing**: Roll when you're banned from multiple channels for maximum impact
- **Persistence**: Keep rolling daily - the more you roll, the better your chances
- **Luck**: It's all about luck! Even the unluckiest players can get lucky streaks
