import type { PostgreSQLManager } from "../database/PostgreSQLManager.js";
import type { AIManager } from "../ai-assistant/AIManager.js";
import { TopicLabeler } from "./TopicLabeler.js";

/**
 * Configuration options for conversation enhancement
 */
export interface EnhancementConfig {
  lookbackHours?: number;         // How far back to process (default: 24)
  minMessagesForSplit?: number;    // Min messages to consider splitting (default: 20)
  minDurationForSplit?: number;    // Min duration in minutes (default: 60)
  batchSize?: number;              // Process N segments at a time (default: 10)
  sleepBetweenBatches?: number;    // Sleep ms between batches (default: 4000 = 15 RPM)
  enableLabeling?: boolean;        // Enable topic labeling (default: true)
  enableSummaries?: boolean;       // Enable summary generation (default: true)
  enableOrphans?: boolean;         // Enable orphan classification (default: true)
  enableSplitting?: boolean;       // Enable conversation splitting (default: false)
  dryRun?: boolean;                // Don't write to database (default: false)
}

/**
 * Processing statistics
 */
export interface EnhancementStats {
  segmentsProcessed: number;
  topicsLabeled: number;
  summariesGenerated: number;
  orphansRecovered: number;
  conversationsSplit: number;
  errors: number;
  apiCallsMade: number;
  startTime: Date;
  endTime?: Date;
}

/**
 * EnhancementOrchestrator
 *
 * Coordinates the AI enhancement pipeline for conversation segments.
 * Manages rate limiting, error handling, and progress tracking.
 */
export class EnhancementOrchestrator {
  private db: PostgreSQLManager;
  private aiManager: AIManager;
  private topicLabeler: TopicLabeler;
  private config: Required<EnhancementConfig>;
  private stats: EnhancementStats;
  private apiCallTimestamps: number[] = [];

  // Rate limiting configuration (Gemini free tier: 15 RPM)
  private readonly MAX_CALLS_PER_MINUTE = 15;
  private readonly RATE_LIMIT_WINDOW_MS = 60 * 1000;

  constructor(
    db: PostgreSQLManager,
    aiManager: AIManager,
    config: EnhancementConfig = {}
  ) {
    this.db = db;
    this.aiManager = aiManager;
    this.topicLabeler = new TopicLabeler(db, aiManager);
    this.config = {
      lookbackHours: config.lookbackHours ?? 24,
      minMessagesForSplit: config.minMessagesForSplit ?? 20,
      minDurationForSplit: config.minDurationForSplit ?? 60,
      batchSize: config.batchSize ?? 10,
      sleepBetweenBatches: config.sleepBetweenBatches ?? 4000,
      enableLabeling: config.enableLabeling ?? true,
      enableSummaries: config.enableSummaries ?? true,
      enableOrphans: config.enableOrphans ?? true,
      enableSplitting: config.enableSplitting ?? false,
      dryRun: config.dryRun ?? false,
    };

    this.stats = {
      segmentsProcessed: 0,
      topicsLabeled: 0,
      summariesGenerated: 0,
      orphansRecovered: 0,
      conversationsSplit: 0,
      errors: 0,
      apiCallsMade: 0,
      startTime: new Date(),
    };
  }

  /**
   * Run the full enhancement pipeline
   */
  async enhance(guildId: string): Promise<EnhancementStats> {
    console.log("🔹 Starting AI conversation enhancement...");
    console.log(`   Guild: ${guildId}`);
    console.log(`   Lookback: ${this.config.lookbackHours} hours`);
    console.log(`   Batch size: ${this.config.batchSize}`);
    console.log(`   Dry run: ${this.config.dryRun}`);
    console.log("");

    this.stats.startTime = new Date();

    try {
      // Phase 1: Topic Labeling (High Priority)
      if (this.config.enableLabeling) {
        await this.runTopicLabeling(guildId);
      }

      // Phase 2: Summary Generation (High Priority)
      if (this.config.enableSummaries) {
        await this.runSummaryGeneration(guildId);
      }

      // Phase 3: Orphan Classification (High Priority)
      if (this.config.enableOrphans) {
        await this.runOrphanClassification(guildId);
      }

      // Phase 4: Conversation Splitting (Medium Priority, expensive)
      if (this.config.enableSplitting) {
        await this.runConversationSplitting(guildId);
      }

      this.stats.endTime = new Date();
      this.printSummary();

      return this.stats;
    } catch (error) {
      console.error("❌ Enhancement pipeline failed:", error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Phase 1: Add topic labels to unlabeled segments
   */
  private async runTopicLabeling(guildId: string): Promise<void> {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📝 PHASE 1: Topic Labeling");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const since = new Date(Date.now() - this.config.lookbackHours * 60 * 60 * 1000);

    // Query unlabeled segments
    const segmentsResult = await this.db.query(
      `
      SELECT id, channel_id, message_ids, start_time, end_time, message_count
      FROM conversation_segments
      WHERE guild_id = $1
        AND (topic_label IS NULL OR topic_label = '')
        AND message_count >= 3
        AND created_at >= $2
        AND (ai_processing_status = 'pending' OR ai_processing_status IS NULL)
      ORDER BY created_at DESC
      `,
      [guildId, since]
    );

    if (!segmentsResult.success || !segmentsResult.data || segmentsResult.data.length === 0) {
      console.log("   ℹ️  No unlabeled segments found");
      return;
    }

    const segments = segmentsResult.data;
    console.log(`   Found ${segments.length} unlabeled segments`);
    console.log(`   Processing in batches of ${this.config.batchSize}...\n`);

    // Process in batches
    for (let i = 0; i < segments.length; i += this.config.batchSize) {
      const batch = segments.slice(i, i + this.config.batchSize);
      console.log(`   [${i + 1}-${Math.min(i + this.config.batchSize, segments.length)}/${segments.length}]`);

      for (const segment of batch) {
        await this.rateLimit();

        try {
          // Generate topic label
          const duration = (new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / (60 * 1000);
          const result = await this.topicLabeler.generateTopicLabel(
            guildId,
            segment.channel_id,
            segment.message_ids,
            {
              duration,
              messageCount: segment.message_count,
            }
          );

          // Update database
          if (!this.config.dryRun) {
            await this.db.query(
              `
              UPDATE conversation_segments
              SET topic_label = $2,
                  topic_confidence = $3,
                  ai_processing_status = 'completed',
                  ai_processed_at = NOW(),
                  ai_metadata = jsonb_set(
                    COALESCE(ai_metadata, '{}'::jsonb),
                    '{topic_method}',
                    to_jsonb($4::text)
                  )
              WHERE id = $1
              `,
              [segment.id, result.label, result.confidence, result.method]
            );
          }

          const methodIcon = result.method === "ai" ? "🤖" : "📊";
          console.log(`      ${methodIcon} Segment ${segment.id.slice(0, 8)}: "${result.label}"`);
          this.stats.topicsLabeled++;
          this.stats.apiCallsMade++;
        } catch (error) {
          console.error(`      ✗ Segment ${segment.id.slice(0, 8)} failed: ${error}`);
          this.stats.errors++;

          // Mark as failed
          if (!this.config.dryRun) {
            await this.db.query(
              `
              UPDATE conversation_segments
              SET ai_processing_status = 'failed',
                  ai_metadata = jsonb_set(
                    COALESCE(ai_metadata, '{}'::jsonb),
                    '{error}',
                    to_jsonb($2::text)
                  )
              WHERE id = $1
              `,
              [segment.id, String(error)]
            );
          }
        }
      }

      // Sleep between batches
      if (i + this.config.batchSize < segments.length) {
        await this.sleep(this.config.sleepBetweenBatches);
      }
    }

    this.stats.segmentsProcessed += segments.length;
    console.log(`\n   ✅ Phase 1 complete: ${this.stats.topicsLabeled} topics labeled\n`);
  }

  /**
   * Phase 2: Generate summaries for segments
   */
  private async runSummaryGeneration(guildId: string): Promise<void> {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📄 PHASE 2: Summary Generation");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // TODO: Implement summary generation
    console.log("   ℹ️  Summary generation not yet implemented");
  }

  /**
   * Phase 3: Classify and recover orphaned messages
   */
  private async runOrphanClassification(guildId: string): Promise<void> {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔍 PHASE 3: Orphan Classification");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // TODO: Implement orphan classification
    console.log("   ℹ️  Orphan classification not yet implemented");
  }

  /**
   * Phase 4: Split long conversations by topic
   */
  private async runConversationSplitting(guildId: string): Promise<void> {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✂️  PHASE 4: Conversation Splitting");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // TODO: Implement conversation splitting
    console.log("   ℹ️  Conversation splitting not yet implemented");
  }

  /**
   * Rate limiting to stay within Gemini free tier (15 RPM)
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();

    // Clean old timestamps outside the window
    this.apiCallTimestamps = this.apiCallTimestamps.filter(
      (ts) => now - ts < this.RATE_LIMIT_WINDOW_MS
    );

    // If at limit, wait until oldest call expires
    if (this.apiCallTimestamps.length >= this.MAX_CALLS_PER_MINUTE) {
      const oldestCall = Math.min(...this.apiCallTimestamps);
      const waitTime = this.RATE_LIMIT_WINDOW_MS - (now - oldestCall) + 100; // +100ms buffer
      console.log(`      ⏳ Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`);
      await this.sleep(waitTime);
    }

    // Record this API call
    this.apiCallTimestamps.push(Date.now());
  }

  /**
   * Sleep for specified milliseconds
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Print enhancement summary
   */
  private printSummary(): void {
    const duration = this.stats.endTime
      ? (this.stats.endTime.getTime() - this.stats.startTime.getTime()) / 1000
      : 0;

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 ENHANCEMENT SUMMARY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`   Segments Processed:     ${this.stats.segmentsProcessed}`);
    console.log(`   Topics Labeled:         ${this.stats.topicsLabeled}`);
    console.log(`   Summaries Generated:    ${this.stats.summariesGenerated}`);
    console.log(`   Orphans Recovered:      ${this.stats.orphansRecovered}`);
    console.log(`   Conversations Split:    ${this.stats.conversationsSplit}`);
    console.log(`   API Calls Made:         ${this.stats.apiCallsMade}`);
    console.log(`   Errors:                 ${this.stats.errors}`);
    console.log(`   Duration:               ${duration.toFixed(1)}s`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }

  /**
   * Get current stats
   */
  getStats(): EnhancementStats {
    return { ...this.stats };
  }
}
