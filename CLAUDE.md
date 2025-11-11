# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Running the bot
- **Development mode with auto-restart:** `npm run dev`
- **Production start:** `npm start`
- **Production with environment variable:** `NODE_ENV=production npm start`
- **Debug mode with inspector:** `npm run start:debug`

### Code quality
- **Lint code:** `npm run lint`
- **Fix linting issues:** `npm run lint:fix`
- **Format code:** `npm run format`

### Building
- **Compile TypeScript:** `npm run build`
- **Production build (compile + clean cache):** `npm run build:prod`
- **Clean build artifacts:** `npm run clean`

### Database & Synchronization
- **Sync guild data to PostgreSQL:** `npm run sync:guild`
- **Drop guild data from PostgreSQL:** `npm run drop:guild`
- **Recreate PostgreSQL schema:** `npm run recreate:schema`
- **Clean all PostgreSQL data:** `npm run drop:all`
- **Heal database inconsistencies:** Database healer runs automatically on bot startup (DatabaseHealer class)
- **Sync a single channel:** `npm run sync:channel`
- **Regenerate relationship network:** `npm run regenerate:relationships`
- **Regenerate conversations:** `npm run regenerate:conversations`
- **Generate embeddings:** `npm run generate:embeddings` (uses Bun)

### Testing & Debugging
- **Test minimal bot functionality:** `npm run test:minimal`
- **Test action creation:** `npm run test:actions`
- **Test voice channel features:** `npm run test:voice`
- **Test PostgreSQL connection:** `npm run test:postgres`
- **Test AI assistant:** `npm run test:ai`
- **Watch database changes:** `npm run watch-db`
- **Watch user changes:** `npm run watch-users`
- **Check recent activity:** `npm run view:recent`
- **Inspect active conversations (24h):** `npm run inspect:conversations`
- **Analyze conversation grouping accuracy:** `npm run analyze:conversation-accuracy` (uses Gemini AI to compare programmatic vs semantic conversation detection)

## Architecture Overview

### Core Components

**Bot.ts** - The main orchestrator. On initialization:
1. Connects to PostgreSQL (optional but enables all advanced features)
2. Sets up Discord event handlers (slash commands, bot mentions, message replies)
3. Deploys commands (guild-specific or globally)
4. Initializes relationship/conversation tracking, database healing, and live sync watching

### Feature Layers

#### Guild Synchronization (`src/features/guild-sync/`)
Syncs Discord data to PostgreSQL with real-time updates:
- **GuildSyncManager**: Batch syncs guilds, channels, roles, members, and messages on demand
- **DatabaseHealer** (Bot.ts:81-86): Runs at boot and periodically; validates data consistency, backfills missing relationships/segments, repairs reply chains
- **LiveSyncWatcher** (Bot.ts:90-96): Real-time event listener that incrementally updates PostgreSQL as Discord events occur (messageCreate, reactionAdd, memberJoin, etc.)

#### Relationship Network (`src/features/relationship-network/`)
Models user interactions as directed edges with interaction counters:
- **NetworkManager**: Calculates affinity scores between users combining message interactions and conversations
- **ConversationManager**: Groups messages into multi-participant conversation segments via interaction clustering (5-minute inactivity threshold, minimum 3 messages)
- **Types** (`types.ts`): Defines `ConversationEntry`, `AffinityScoreResult`, `UserInteractionSummary`

#### Database (`src/features/database/`)
- **PostgreSQLManager**: Single connection pool; provides query methods for CRUD operations on guilds, channels, members, messages, relationship edges, conversation segments, and embeddings
- Handles graceful degradation if PostgreSQL is unavailable
- Returns `DatabaseResult<T>` with `success` flag, `data`, and optional `error` field

#### AI Assistant (`src/features/ai-assistant/`)
Provides multi-provider LLM chat with tool integration:
- **AIManager** (singleton): Manages Grok, OpenAI, Gemini, and Ollama providers; registers database tools for context retrieval
- **DatabaseTools**: Registry of tools that call database methods; includes user tools, relationship tools, conversation tools, message tools, server tools, context tools, and analysis tools
- **Personas**: "sophia" (philosophical) and "casual" (friendly); selected based on context
- **ChatSessionManager**: Tracks multi-turn conversations; stores session history per user

#### Message Handling in Bot.ts
**Bot mentions** (lines 169-315):
1. Detects @botname mentions (not replies, uses regex patterns)
2. Extracts user content, maps self-referential queries (e.g., "who am I") to explicit mentions for tool resolution
3. Generates AI response via AIManager
4. Sends response in Discord-safe chunks (max 1900 chars) with sanitized @everyone mentions
5. Starts a new chat session

**Bot replies** (lines 318-400):
1. Tracks message replies to bot messages using session IDs (stored in ChatSessionManager)
2. Continues conversation context by passing session history to AI
3. Applies same chunking and sanitization logic

### Supporting Systems

**AIManager tools** integrate with database:
- Tools implicitly use guild context (set via `runWithGuildContext`) to infer guildId
- User tools retrieve member profiles, summaries, keywords, emojis, notes
- Relationship tools calculate affinity, list top connections
- Conversation tools fetch segments, participants, embeddings
- Analysis tools provide metadata and trends

**LiveSyncWatcher events**:
- messageCreate → increments edge counters, buffers message for conversation segment finalization
- reactionAdd/reactionRemove → increments edge counters
- guildMemberAdd/Update → updates member profiles
- channelCreate/Update/Delete → updates channel records
- roleCreate/Update/Delete → updates role records
- Conversation segments auto-finalize after 5 minutes inactivity or segment compaction

**Conversation Segment Lifecycle**:
1. ConversationManager detects active conversations via interaction clustering in channel buffers
2. Segments are finalized when inactivity threshold is reached
3. Finalized segments are inserted into `conversation_segments` table with message IDs, participant list, timestamps, and optional embeddings
4. Used for context retrieval (what topics have users discussed)

## Configuration

**Environment Variables** (src/config/index.ts):
- **Required**: `BOT_TOKEN` (Discord bot token)
- **Optional Discord**: `GUILD_ID` (for guild-specific command deployment), `BOT_PREFIX`, `BOT_OWNER_ID`, `SPAWN_CHANNEL_ID` (for voice channel manager)
- **Optional Database**: `POSTGRES_URL` (connection string; default: local postgres), `DB_NAME` (default: "arcados")
- **Optional Integrations**: `OPENAI_API_KEY`, `GROK_API_KEY`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `OLLAMA_URL`, `OLLAMA_MODEL`

Bot gracefully degrades if PostgreSQL is unavailable; all Discord features work without it.

## Adding Commands

Commands are in `src/commands/` and dynamically loaded via `loadCommands()` in Bot.ts:63-66.

**Command Structure**:
```typescript
import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types";

const myCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("mycmd")
    .setDescription("Description")
    .addStringOption(opt => opt.setName("arg").setDescription("Help").setRequired(true)),

  async execute(interaction) {
    const arg = interaction.options.getString("arg");
    await interaction.reply(`Response: ${arg}`);
  },
};

export default myCommand;
```

Commands automatically receive guild context and can access AI tools, database methods, and user/relationship data.

## Code Style

- **Formatter**: Biome (see package.json biome config)
- **Language**: TypeScript with strict mode
- **Imports**: ES module syntax (`import ... from "..."`)
- **Format**: Tabs (width 2), line width 100, double quotes, semicolons, trailing commas (ES5)
- **Patterns**: Class-based managers, static singletons for global state (e.g., AIManager), error handling via try/catch with logging via console.error
- **Sanitization**: All bot output sanitized for @everyone/@here mentions via `sanitizeEveryone()` function

## Key Files to Know

- [Bot.ts](src/Bot.ts) - Main event orchestrator and command dispatcher
- [PostgreSQLManager.ts](src/features/database/PostgreSQLManager.ts) - Database interface
- [NetworkManager.ts](src/features/relationship-network/NetworkManager.ts) - Affinity/relationship logic
- [ConversationManager.ts](src/features/relationship-network/ConversationManager.ts) - Conversation segmentation
- [DatabaseHealer.ts](src/features/guild-sync/DatabaseHealer.ts) - Boot-time consistency checks
- [LiveSyncWatcher.ts](src/features/guild-sync/LiveSyncWatcher.ts) - Real-time event sync
- [AIManager.ts](src/features/ai-assistant/AIManager.ts) - Multi-provider LLM orchestration
- [DatabaseTools.ts](src/features/ai-assistant/DatabaseTools.ts) - Tool registry for AI

## Common Tasks

**Modify AI behavior**: Personas are in AIManager.ts (lines 33-48); persona selection in generateText calls specifies which to use.

**Add a database schema**: PostgreSQLManager has schema creation methods; update via migration pattern in `recreate:schema` script.

**Track new interaction types**: ConversationManager uses regex patterns (lines 36-54) to classify messages; add new patterns as needed, then regenerate conversation segments.

**Integrate new LLM provider**: Create provider class extending BaseAIProvider, register in AIManager.initializeProviders(), add API key to config.

**Debug conversation detection**: ConversationManager buffers messages per channel with inactivity timeouts; add console.log in detectConversations method or watch-db script.

**Extend bot mention handling**: Message handling logic in Bot.ts lines 169-315; modify sanitization, context resolution, or chunking as needed.
