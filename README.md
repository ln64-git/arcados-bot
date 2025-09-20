# Discord Bot Template

A minimal, dynamic Discord bot template built with TypeScript and Discord.js v14.

## Features

- 🔹 Dynamic command registration
- 🔹 TypeScript support
- 🔹 Error handling
- 🔹 Guild-specific or global command deployment
- 🔹 Clean, extensible architecture

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.env` file:**
   ```env
   BOT_TOKEN=your_discord_bot_token_here
   GUILD_ID=your_guild_id_for_testing  # Optional, for guild-specific commands
   ```

3. **Get your Discord bot token:**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to "Bot" section and create a bot
   - Copy the token and add it to your `.env` file

4. **Invite your bot to a server:**
   - In the Discord Developer Portal, go to "OAuth2" > "URL Generator"
   - Select "bot" and "applications.commands" scopes
   - Select necessary permissions (Send Messages, Use Slash Commands, etc.)
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

## Adding Commands

The bot supports dynamic command registration. Here's how to add a command:

```typescript
import { SlashCommandBuilder } from 'discord.js';
import { Command } from './Bot';

const pingCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),
    
    async execute(interaction) {
        await interaction.reply('Pong!');
    }
};

// Add the command to your bot
bot.addCommand(pingCommand);
```

## Project Structure

```
src/
├── Bot.ts          # Main bot class
├── main.ts         # Entry point
└── commands/       # Command files (create as needed)
```

## Environment Variables

- `BOT_TOKEN` (required): Your Discord bot token
- `GUILD_ID` (optional): Guild ID for testing commands locally

## License

MIT