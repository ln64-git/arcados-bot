# Arcados Discord Bot

A comprehensive Discord bot with real-time PostgreSQL integration and relationship networks, built with TypeScript and Discord.js v14.

## Features

- 🔹 Dynamic command registration
- 🔹 TypeScript support
- 🔹 Error handling
- 🔹 Guild-specific or global command deployment
- 🔹 Clean, extensible architecture
- 🔹 **Real-time PostgreSQL synchronization**
- 🔹 **Incremental relationship network updates**
- 🔹 **Multi-participant conversation segments**
- 🔹 **Full Discord data sync (guilds, channels, members, roles, messages)**
- 🔹 **Boot-time database healing and maintenance**
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

   # PostgreSQL settings (optional - bot works without database)
   POSTGRES_URL=your_postgres_connection_string

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

4. **Set up PostgreSQL (optional):**

   - Use any PostgreSQL database (local or cloud like Neon, Supabase, etc.)
   - Get your connection string
   - Add `POSTGRES_URL` to your `.env` file
   - **Note:** The bot will work without PostgreSQL, but you'll miss out on relationship networks and conversation tracking

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

## PostgreSQL Integration & Relationship Networks

This bot features comprehensive PostgreSQL integration with real-time relationship tracking:

### What Gets Synced

- **Guilds**: Server information, member counts, settings
- **Channels**: All text/voice channels with metadata and watermarks
- **Members**: User data, roles, join dates, relationship networks
- **Roles**: Role permissions, colors, positions
- **Messages**: Message content, timestamps, attachments
- **Relationship Edges**: Directed dyads with interaction counters
- **Conversation Segments**: Multi-participant conversation tracking

### Real-time Features

- **Incremental Updates**: O(1) edge counter updates on messages/reactions
- **Streaming Segments**: Auto-finalized conversation segments (5m inactivity, min 3 msgs)
- **Boot-time Healing**: Database consistency checks and backfill on startup
- **Periodic Maintenance**: Rolling window updates, segment compaction

### Relationship Networks

- **Directed Edges**: Track interactions between any two users
- **Multi-participant Conversations**: Support for group chats
- **Bot Memory**: Bot maintains relationship summaries per user
- **Peer Context**: Understands relationships between active conversation participants

### Graceful Degradation

- Bot continues functioning if PostgreSQL is unavailable
- All Discord features work without database connection
- Automatic reconnection with retry/backoff
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
├── database/                 # PostgreSQL integration
│   └── PostgreSQLManager.ts  # Database connection and operations
├── features/                # Bot features
│   ├── guild-sync/          # Guild synchronization
│   │   ├── DatabaseHealer.ts  # Boot-time healing and maintenance
│   │   └── LiveSyncWatcher.ts # Real-time event watcher
│   ├── relationship-network/ # Relationship tracking
│   │   ├── NetworkManager.ts  # Relationship network builder
│   │   └── ConversationManager.ts # Conversation segment manager
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

### PostgreSQL Settings (Optional)

- `POSTGRES_URL`: PostgreSQL connection string
- `DB_NAME`: Database name (default: "arcados")

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
- **Real-time Updates**: Changes apply instantly via PostgreSQL triggers and live sync watchers

## License

MIT
