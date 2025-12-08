/**
 * ConversationWorkflowManager
 *
 * Manages the complete workflow for conversation detection and maintenance.
 * Encapsulates initialization, periodic cleanup, and lifecycle management
 * for conversation-related intelligence features.
 */

import type { Client, Guild } from "discord.js";
import type { PostgreSQLManager } from "../../../database/PostgreSQLManager";
import { RelationshipMapper } from "../relationship-mapping/RelationshipMapper";
import { ConversationDetector } from "./ConversationDetector";

export interface ConversationWorkflowConfig {
  /**
   * Optional guild ID to limit operations to a single guild
   */
  guildId?: string;

  /**
   * Interval for cleaning up stale conversations (milliseconds)
   * @default 900000 (15 minutes)
   */
  cleanupInterval?: number;

  /**
   * Interval for flushing inactive conversation buffers (milliseconds)
   * @default 120000 (2 minutes)
   */
  bufferFlushInterval?: number;

  /**
   * Interval for semantic merging of related conversations (milliseconds)
   * @default 3600000 (1 hour)
   */
  semanticMergingInterval?: number;

  /**
   * Enable verbose logging for debugging
   * @default false
   */
  verbose?: boolean;
}

export class ConversationWorkflowManager {
  private client: Client;
  private db: PostgreSQLManager;
  private config: Required<ConversationWorkflowConfig>;

  private relationshipMapper?: RelationshipMapper;
  private conversationDetector?: ConversationDetector;

  private cleanupTimer?: NodeJS.Timeout;
  private bufferFlushTimer?: NodeJS.Timeout;
  private semanticMergingTimer?: NodeJS.Timeout;

  private isRunning = false;

  constructor(
    client: Client,
    db: PostgreSQLManager,
    config: ConversationWorkflowConfig = {}
  ) {
    this.client = client;
    this.db = db;

    // Apply defaults
    this.config = {
      guildId: config.guildId || "",
      cleanupInterval: config.cleanupInterval ?? 15 * 60 * 1000, // 15 minutes
      bufferFlushInterval: config.bufferFlushInterval ?? 2 * 60 * 1000, // 2 minutes
      semanticMergingInterval:
        config.semanticMergingInterval ?? 60 * 60 * 1000, // 1 hour
      verbose: config.verbose ?? false,
    };
  }

  /**
   * Initialize conversation detection components and start all workflows
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("🔸 ConversationWorkflowManager is already running");
      return;
    }

    this.log("🔹 Initializing conversation detection workflow...");

    // Initialize components
    this.relationshipMapper = new RelationshipMapper(this.db);
    this.conversationDetector = new ConversationDetector(this.db);

    // Load active conversations for configured guilds
    await this.loadActiveConversations();

    // Start periodic maintenance tasks
    this.startPeriodicCleanup();
    this.startBufferFlushing();
    this.startSemanticMerging();

    this.isRunning = true;
    this.log("🔹 Conversation detection workflow started");
  }

  /**
   * Stop all workflows and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.log("🔹 Stopping conversation detection workflow...");

    // Clear all timers
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    if (this.bufferFlushTimer) {
      clearInterval(this.bufferFlushTimer);
      this.bufferFlushTimer = undefined;
    }

    if (this.semanticMergingTimer) {
      clearInterval(this.semanticMergingTimer);
      this.semanticMergingTimer = undefined;
    }

    // Final buffer flush to ensure conversations are finalized
    try {
      await this.conversationDetector?.flushInactiveBuffers();
    } catch (error) {
      console.error("🔸 Error during final buffer flush:", error);
    }

    this.isRunning = false;
    this.log("🔹 Conversation detection workflow stopped");
  }

  /**
   * Get the relationship mapper instance
   */
  getRelationshipMapper(): RelationshipMapper | undefined {
    return this.relationshipMapper;
  }

  /**
   * Get the conversation detector instance
   */
  getConversationDetector(): ConversationDetector | undefined {
    return this.conversationDetector;
  }

  /**
   * Load active conversations for all configured guilds
   */
  private async loadActiveConversations(): Promise<void> {
    if (!this.conversationDetector) {
      throw new Error("ConversationDetector not initialized");
    }

    const guilds = this.getTargetGuilds();

    if (guilds.length === 0) {
      console.log("🔸 No guilds found to load conversations for");
      return;
    }

    this.log(`🔹 Loading active conversations for ${guilds.length} guild(s)...`);

    for (const guild of guilds) {
      try {
        await this.conversationDetector.loadActiveConversations(guild.id);
        this.log(`   ✓ Loaded conversations for ${guild.name} (${guild.id})`);
      } catch (error) {
        console.error(
          `🔸 Failed to load conversations for guild ${guild.id}:`,
          error
        );
      }
    }
  }

  /**
   * Start periodic cleanup of stale conversations
   */
  private startPeriodicCleanup(): void {
    if (!this.conversationDetector) {
      throw new Error("ConversationDetector not initialized");
    }

    this.log(
      `🔹 Starting periodic stale conversation cleanup (every ${this.config.cleanupInterval / 1000}s)`
    );

    this.cleanupTimer = setInterval(async () => {
      const guilds = this.getTargetGuilds();

      for (const guild of guilds) {
        try {
          await this.conversationDetector!.cleanupStaleConversations(guild.id);
          this.log(
            `   ✓ Cleaned up stale conversations for ${guild.name} (${guild.id})`
          );
        } catch (error) {
          console.error(
            `🔸 Failed to cleanup stale conversations for guild ${guild.id}:`,
            error
          );
        }
      }
    }, this.config.cleanupInterval);
  }

  /**
   * Start periodic flushing of inactive conversation buffers
   */
  private startBufferFlushing(): void {
    if (!this.conversationDetector) {
      throw new Error("ConversationDetector not initialized");
    }

    this.log(
      `🔹 Starting periodic buffer flushing (every ${this.config.bufferFlushInterval / 1000}s)`
    );

    this.bufferFlushTimer = setInterval(async () => {
      try {
        await this.conversationDetector!.flushInactiveBuffers();
        this.log("   ✓ Flushed inactive conversation buffers");
      } catch (error) {
        console.error("🔸 Failed to flush inactive buffers:", error);
      }
    }, this.config.bufferFlushInterval);
  }

  /**
   * Start periodic semantic merging of related conversations
   */
  private startSemanticMerging(): void {
    if (!this.conversationDetector) {
      throw new Error("ConversationDetector not initialized");
    }

    this.log(
      `🔹 Starting periodic semantic merging (every ${this.config.semanticMergingInterval / 1000}s)`
    );

    this.semanticMergingTimer = setInterval(async () => {
      const guilds = this.getTargetGuilds();

      for (const guild of guilds) {
        try {
          await this.conversationDetector!.runSemanticMergingForGuild(guild.id);
          this.log(
            `   ✓ Ran semantic merging for ${guild.name} (${guild.id})`
          );
        } catch (error) {
          console.error(
            `🔸 Failed to run semantic merging for guild ${guild.id}:`,
            error
          );
        }
      }
    }, this.config.semanticMergingInterval);
  }

  /**
   * Get the target guilds based on configuration
   */
  private getTargetGuilds(): Guild[] {
    if (this.config.guildId) {
      const guild = this.client.guilds.cache.get(this.config.guildId);
      if (guild) {
        this.log(
          `   Limiting operations to guild: ${guild.name} (${this.config.guildId})`
        );
        return [guild];
      } else {
        console.log(
          `🔸 Warning: Configured guild ID ${this.config.guildId} not found in cache`
        );
        return [];
      }
    }

    return Array.from(this.client.guilds.cache.values());
  }

  /**
   * Log a message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(message);
    }
  }
}

