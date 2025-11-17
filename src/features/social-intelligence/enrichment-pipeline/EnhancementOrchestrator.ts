import { PostgreSQLManager } from "../../../database/PostgreSQLManager";
import type { AIManager } from "../../ai-assistant/AIManager";

/**
 * Configuration options for conversation enhancement
 */
export interface EnhancementConfig {
  lookbackHours?: number; // How far back to process (default: 24)
  minMessagesForSplit?: number; // Min messages to consider splitting (default: 20)
  minDurationForSplit?: number; // Min duration in minutes (default: 60)
  batchSize?: number; // Process N segments at a time (default: 10)
  sleepBetweenBatches?: number; // Sleep ms between batches (default: 4000 = 15 RPM)
  enableSummaries?: boolean; // Enable summary generation (default: true)
  enableOrphans?: boolean; // Enable orphan classification (default: true)
  enableSplitting?: boolean; // Enable conversation splitting (default: false)
  dryRun?: boolean; // Don't write to database (default: false)
  regenerateSummaries?: boolean; // Regenerate summaries even if they exist (default: false)
}

/**
 * Processing statistics
 */
export interface EnhancementStats {
  segmentsProcessed: number;
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
    this.config = {
      lookbackHours: config.lookbackHours ?? 24,
      minMessagesForSplit: config.minMessagesForSplit ?? 20,
      minDurationForSplit: config.minDurationForSplit ?? 60,
      batchSize: config.batchSize ?? 10,
      sleepBetweenBatches: config.sleepBetweenBatches ?? 4000,
      enableSummaries: config.enableSummaries ?? true,
      enableOrphans: config.enableOrphans ?? true,
      enableSplitting: config.enableSplitting ?? false,
      dryRun: config.dryRun ?? false,
      regenerateSummaries: config.regenerateSummaries ?? false,
    };

    this.stats = {
      segmentsProcessed: 0,
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
      // Phase 1: Summary Generation (High Priority)
      if (this.config.enableSummaries) {
        await this.runSummaryGeneration(guildId);
      }

      // Phase 2: Orphan Classification (High Priority)
      if (this.config.enableOrphans) {
        await this.runOrphanClassification(guildId);
      }

      // Phase 3: Conversation Splitting (Medium Priority, expensive)
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
   * Phase 1: Generate summaries for segments
   */
  private async runSummaryGeneration(guildId: string): Promise<void> {
    console.log(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log("📄 PHASE 1: Summary Generation");
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
    );

    const since = new Date(
      Date.now() - this.config.lookbackHours * 60 * 60 * 1000
    );

    // Query segments without summaries, with old auto-generated summaries, or all if regenerating
    // Old summaries start with number patterns like "2 users:" or "3 users:"
    const summaryCondition = this.config.regenerateSummaries
      ? "TRUE" // Regenerate all summaries
      : `(
          cs.summary IS NULL 
          OR cs.summary = ''
          OR cs.summary ~ '^\\d+\\s+users?:'  -- Old auto-generated format
        )`;

    const segmentsResult = await this.db.query(
      `
      SELECT 
        cs.id, 
        cs.channel_id, 
        cs.message_ids, 
        cs.start_time, 
        cs.end_time, 
        cs.message_count,
        cs.participants
      FROM conversation_segments cs
      WHERE cs.guild_id = $1
        AND ${summaryCondition}
        AND cs.message_count >= 3
        AND cs.start_time >= $2
        AND cs.status = 'finalized'
      ORDER BY cs.start_time DESC
      `,
      [guildId, since]
    );

    if (
      !segmentsResult.success ||
      !segmentsResult.data ||
      segmentsResult.data.length === 0
    ) {
      console.log("   ℹ️  No segments without summaries found");
      return;
    }

    const segments = segmentsResult.data;
    console.log(`   Found ${segments.length} segments without summaries`);
    console.log(`   Processing in batches of ${this.config.batchSize}...\n`);

    // Process in batches
    for (let i = 0; i < segments.length; i += this.config.batchSize) {
      const batch = segments.slice(i, i + this.config.batchSize);
      console.log(
        `   [${i + 1}-${Math.min(i + this.config.batchSize, segments.length)}/${
          segments.length
        }]`
      );

      for (const segment of batch) {
        await this.rateLimit();

        try {
          // Fetch messages for this segment
          const messagesResult = await this.db.query(
            `
            SELECT id, author_id, content, created_at
            FROM messages
            WHERE id = ANY($1::TEXT[])
            ORDER BY created_at ASC
            `,
            [segment.message_ids]
          );

          if (
            !messagesResult.success ||
            !messagesResult.data ||
            messagesResult.data.length === 0
          ) {
            console.warn(
              `      ⚠️  Segment ${segment.id.slice(0, 8)}: No messages found`
            );
            continue;
          }

          const messages = messagesResult.data;

          // Build message preview with smart sampling
          // For short conversations: use all messages
          // For long conversations: sample from beginning, middle, and end
          let sampledMessages = messages;
          if (messages.length > 30) {
            // Take first 10, middle 10, last 10
            const start = messages.slice(0, 10);
            const middleIndex = Math.floor(messages.length / 2) - 5;
            const middle = messages.slice(middleIndex, middleIndex + 10);
            const end = messages.slice(-10);
            sampledMessages = [...start, ...middle, ...end];
          }

          const messagePreview = sampledMessages
            .map((m: any) => {
              const content = (m.content || "").trim();
              return content.length > 0 ? content : "(no text content)";
            })
            .join("\n")
            .substring(0, 3000); // Increased from 2000 to 3000

          const participantCount = Array.isArray(segment.participants)
            ? segment.participants.length
            : 0;
          const duration =
            (new Date(segment.end_time).getTime() -
              new Date(segment.start_time).getTime()) /
            (60 * 1000);

          // Generate summary using AI
          const prompt = `Summarize this Discord conversation in 1-2 concise sentences. Focus on the main topics discussed.

BAD EXAMPLES (DO NOT USE):
❌ "Smell the stench and recoil—Sheldon Cooper sprays sanitizer..." (flowery language)
❌ "Capture the essence: A casual conversation unfolds..." (narrative style)
❌ "User <@886340655671046176> mentioned..." (Discord user IDs)
❌ "Dive into the chaos of this conversation..." (unnecessary drama)
❌ "Shared a YouTube link" (too vague, missing context)

GOOD EXAMPLES (USE THIS STYLE):
✅ "Complained about bad smell, questioned if someone was sick"
✅ "Discussed Trump allegedly performing oral sex on Bill Clinton; joked about Hitler's micropenis; noted difficulties for white supremacists"
✅ "Shared YouTube video of flying fish, made joke about fish spinning"
✅ "Expressed frustration for not being invited to watch BattleBots, called friends 'fakes'"
✅ "Discussed getting halal food from boyfriend, listed recent meals including steak and Hawaiian rolls, joked about alcohol discovery"

RULES:
1. Capture the MAIN topic/theme, not just the last message
2. Include important context (what, why, who if it's a public figure)
3. Avoid Discord user IDs like <@123456> or usernames
4. Public figures (Trump, celebrities, etc.) CAN be mentioned by name
5. Be factual and specific, not vague
6. Focus on conversation content, not individual users

Conversation (${messages.length} messages, ${participantCount} participants):
${messagePreview}

Summary:`;

          // Try Gemini Flash first, fallback to Grok or OpenAI if available
          let provider = "gemini-flash";
          if (process.env.GROK_API_KEY) {
            provider = "grok"; // Grok has better rate limits
          } else if (process.env.OPENAI_API_KEY) {
            provider = "openai";
          }

          // Retry logic for rate limits
          let response;
          let retries = 3;
          let lastError: Error | null = null;

          while (retries > 0) {
            try {
              response = await this.aiManager.generateText(
                prompt,
                guildId,
                provider,
                {
                  persona: "casual",
                  useDiscordFormatting: false,
                }
              );
              break; // Success, exit retry loop
            } catch (error) {
              lastError =
                error instanceof Error ? error : new Error(String(error));
              const errorMsg = lastError.message.toLowerCase();

              // Check if it's a rate limit error
              if (
                errorMsg.includes("429") ||
                errorMsg.includes("quota") ||
                errorMsg.includes("rate limit")
              ) {
                retries--;
                if (retries > 0) {
                  const waitTime = 10000; // Wait 10 seconds
                  console.log(
                    `      ⏳ Rate limit hit, waiting ${
                      waitTime / 1000
                    }s before retry...`
                  );
                  await this.sleep(waitTime);
                }
              } else {
                // Not a rate limit error, don't retry
                break;
              }
            }
          }

          if (response && response.success && response.content) {
            const summary = response.content.trim();

            // Update database
            if (!this.config.dryRun) {
              await this.db.query(
                `
                UPDATE conversation_segments
                SET summary = $2,
                    ai_processing_status = 'completed',
                    ai_processed_at = NOW()
                WHERE id = $1
                `,
                [segment.id, summary]
              );
            }

            const preview =
              summary.length > 60 ? summary.substring(0, 57) + "..." : summary;
            console.log(
              `      ✅ Segment ${segment.id.slice(0, 8)}: "${preview}"`
            );
            this.stats.summariesGenerated++;
            this.stats.apiCallsMade++;
          } else {
            const errorMsg = lastError
              ? lastError.message.substring(0, 100)
              : "Unknown error";
            console.warn(
              `      ⚠️  Segment ${segment.id.slice(
                0,
                8
              )}: AI generation failed - ${errorMsg}`
            );
            this.stats.errors++;
          }
        } catch (error) {
          console.error(
            `      ✗ Segment ${segment.id.slice(0, 8)} failed: ${error}`
          );
          this.stats.errors++;
        }
      }

      // Sleep between batches
      if (i + this.config.batchSize < segments.length) {
        await this.sleep(this.config.sleepBetweenBatches);
      }
    }

    this.stats.segmentsProcessed += segments.length;
    console.log(
      `\n   ✅ Phase 1 complete: ${this.stats.summariesGenerated} summaries generated\n`
    );
  }

  /**
   * Phase 2: Classify and recover orphaned messages
   */
  private async runOrphanClassification(guildId: string): Promise<void> {
    console.log(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log("🔍 PHASE 2: Orphan Classification");
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
    );

    // TODO: Implement orphan classification
    console.log("   ℹ️  Orphan classification not yet implemented");
  }

  /**
   * Phase 3: Split long conversations by topic
   */
  private async runConversationSplitting(guildId: string): Promise<void> {
    console.log(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log("✂️  PHASE 3: Conversation Splitting");
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
    );

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
      console.log(
        `      ⏳ Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`
      );
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

    console.log(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log("📊 ENHANCEMENT SUMMARY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`   Segments Processed:     ${this.stats.segmentsProcessed}`);
    console.log(`   Summaries Generated:    ${this.stats.summariesGenerated}`);
    console.log(`   Orphans Recovered:      ${this.stats.orphansRecovered}`);
    console.log(`   Conversations Split:    ${this.stats.conversationsSplit}`);
    console.log(`   API Calls Made:         ${this.stats.apiCallsMade}`);
    console.log(`   Errors:                 ${this.stats.errors}`);
    console.log(`   Duration:               ${duration.toFixed(1)}s`);
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
    );
  }

  /**
   * Get current stats
   */
  getStats(): EnhancementStats {
    return { ...this.stats };
  }
}
