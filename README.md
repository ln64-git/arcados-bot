# Arcados Discord Bot

A comprehensive Discord bot with real-time SurrealDB integration, built with TypeScript and Discord.js v14.

## Features

- 🔹 Dynamic command registration
- 🔹 TypeScript support
- 🔹 Error handling
- 🔹 Guild-specific or global command deployment
- 🔹 Clean, extensible architecture
- 🔹 **Real-time SurrealDB synchronization**
- 🔹 **Live Query subscriptions**
- 🔹 **Database-triggered Discord actions**
- 🔹 **Full Discord data sync (guilds, channels, members, roles, messages)**
- 🔹 **Graceful degradation when database unavailable**
- 🔹 **Voice Channel Manager** - Self-organizing voice channels with owner-based moderation

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Create a `.env` file:**

   ```env
   # Required Discord settings
   BOT_TOKEN=your_discord_bot_token_here
   GUILD_ID=your_guild_id_for_testing  # Optional, for guild-specific commands

   # SurrealDB Cloud settings (optional - bot works without database)
   SURREAL_URL=wss://your-instance.surrealdb.com/rpc
   SURREAL_NAMESPACE=arcados-bot
   SURREAL_DATABASE=arcados-bot
   SURREAL_USERNAME=your_username
   SURREAL_PASSWORD=your_password
   # OR use token authentication:
   SURREAL_TOKEN=your_surreal_token

   # Optional Discord settings
   BOT_PREFIX=!
   BOT_OWNER_ID=your_user_id
   SPAWN_CHANNEL_ID=your_spawn_channel_id  # Required for Voice Channel Manager
   ```

3. **Get your Discord bot token:**

   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to "Bot" section and create a bot
   - Copy the token and add it to your `.env` file

4. **Set up SurrealDB Cloud (optional):**

   - Sign up at [SurrealDB Cloud](https://surrealdb.com/cloud)
   - Create a new project
   - Get your connection URL and credentials
   - Add them to your `.env` file
   - **Note:** The bot will work without SurrealDB, but you'll miss out on real-time sync features

5. **Invite your bot to a server:**
   - In the Discord Developer Portal, go to "OAuth2" > "URL Generator"
   - Select "bot" and "applications.commands" scopes
   - Select necessary permissions (Send Messages, Use Slash Commands, Manage Roles, etc.)
   - Use the generated URL to invite your bot

## Usage

### Running the bot:

```bash
npm start
```

### Development mode (with auto-restart):

```bash
npm run dev
```

## SurrealDB Integration

This bot features comprehensive SurrealDB integration with real-time synchronization:

### What Gets Synced

- **Guilds**: Server information, member counts, settings
- **Channels**: All text/voice channels with metadata
- **Members**: User data, roles, join dates
- **Roles**: Role permissions, colors, positions
- **Messages**: Message content, timestamps, attachments (optional)

### Real-time Features

- **Live Queries**: Instant notifications when database changes
- **Database Actions**: Trigger Discord actions from database changes
- **Bidirectional Sync**: Discord events update database, database changes trigger Discord actions

### Database Actions

The bot can execute Discord actions based on database changes:

- **Member Role Updates**: External admin panel → Discord role changes
- **Member Bans**: Database ban records → Discord kicks/bans
- **Scheduled Messages**: Database records → Discord messages at specified times
- **Milestone Celebrations**: Member count thresholds → Celebration messages
- **Achievement Roles**: XP thresholds → Role assignments
- **Global Bans**: Centralized ban list → Multi-guild enforcement

### Graceful Degradation

- Bot continues functioning if SurrealDB is unavailable
- All Discord features work without database connection
- Automatic reconnection with exponential backoff
- Error logging without crashes

## Adding Commands

The bot supports dynamic command registration. Here's how to add a command:

```typescript
import { SlashCommandBuilder } from "discord.js";
import { Command } from "./Bot";

const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong!"),

  async execute(interaction) {
    await interaction.reply("Pong!");
  },
};

// Add the command to your bot
bot.addCommand(pingCommand);
```

## Project Structure

```
src/
├── Bot.ts                    # Main bot class
├── main.ts                   # Entry point
├── config/                   # Configuration management
├── database/                 # SurrealDB integration
│   ├── schema.ts            # Database schemas and types
│   └── SurrealDBManager.ts  # Database connection and operations
├── features/                # Bot features
│   ├── discord-sync/        # Discord-SurrealDB synchronization
│   │   ├── DiscordSyncManager.ts  # Sync orchestration
│   │   ├── actions.ts       # Database-triggered actions
│   │   └── types.ts         # Sync-specific types
│   ├── ai-assistant/        # AI features
│   ├── server-lore/         # Server lore features
│   └── speak-voice-call/    # Voice call features
├── commands/                # Slash commands
├── types/                   # TypeScript type definitions
└── utils/                   # Utility functions
```

## Environment Variables

### Required

- `BOT_TOKEN`: Your Discord bot token

### Optional Discord Settings

- `GUILD_ID`: Guild ID for testing commands locally
- `BOT_PREFIX`: Command prefix (default: "!")
- `BOT_OWNER_ID`: Bot owner user ID

### SurrealDB Settings (Optional)

- `SURREAL_URL`: SurrealDB connection URL (WebSocket)
- `SURREAL_NAMESPACE`: Database namespace (default: "arcados-bot")
- `SURREAL_DATABASE`: Database name (default: "arcados-bot")
- `SURREAL_USERNAME`: Database username (default: "root")
- `SURREAL_PASSWORD`: Database password (default: "root")
- `SURREAL_TOKEN`: OAuth2 token (alternative to username/password)

## Voice Channel Manager

The Voice Channel Manager is a powerful feature that creates a self-organizing voice channel ecosystem. Users can spawn personal voice channels by joining a designated spawn channel, with full ownership and moderation capabilities.

### How It Works

1. **Channel Spawning**: When a user joins the spawn channel, a new voice channel is automatically created for them
2. **Ownership**: The first user in a channel becomes the owner and can moderate other users
3. **Ownership Transfer**: When the owner leaves, ownership passes to the longest resident
4. **Auto-Deletion**: Channels are automatically deleted when empty
5. **Grandfather Protection**: Users present during ownership changes are protected from immediate disruption

### Commands

- `/claim` - Reclaim a voice channel you previously owned
- `/renounce` - Drop ownership of your current voice channel
- `/mute @user` - Mute a user in your channel (owner only)
- `/unmute @user` - Remove mute from a user (owner only)
- `/deafen @user` - Deafen a user in your channel (owner only)
- `/undeafen @user` - Remove deafen from a user (owner only)
- `/ban @user` - Ban a user from your channels (owner only)
- `/unban @user` - Remove a user from your ban list (owner only)
- `/channel-prefs` - Configure your voice channel preferences

### Configuration

Set the `SPAWN_CHANNEL_ID` environment variable to the ID of the voice channel where users should join to spawn new channels.

### Features

- **Scoped Moderation**: All moderation is limited to your owned channels
- **User Preferences**: Customize channel names, user limits, and privacy settings
- **Ban Lists**: Maintain personal ban lists that apply to all your channels
- **Grandfather Protection**: Prevents disruption during ownership changes
- **Real-time Updates**: Changes apply instantly via SurrealDB Live Queries

## License

MIT
