import type { PostgreSQLManager } from "../../../database/PostgreSQLManager";
import type { AIManager } from "../../ai-assistant/AIManager.js";
import { KeywordExtractor } from "./KeywordExtractor.js";

/**
 * Topic label result
 */
export interface TopicLabelResult {
  label: string;
  confidence: number;
  method: "ai" | "keywords" | "error";
}

/**
 * Message for topic labeling
 */
interface TopicMessage {
  id: string;
  author_id: string;
  content: string;
  created_at: Date;
}

/**
 * TopicLabeler
 *
 * Generates concise topic labels (2-5 words) for conversation segments.
 * Uses AI (Gemini Flash) as primary method, falls back to TF-IDF keywords.
 */
export class TopicLabeler {
  private db: PostgreSQLManager;
  private aiManager: AIManager;
  private keywordExtractor: KeywordExtractor;

  constructor(db: PostgreSQLManager, aiManager: AIManager) {
    this.db = db;
    this.aiManager = aiManager;
    this.keywordExtractor = new KeywordExtractor(db);
  }

  /**
   * Generate topic label for a conversation segment
   */
  async generateTopicLabel(
    guildId: string,
    channelId: string,
    messageIds: string[],
    segmentMetadata?: {
      duration?: number;
      participantCount?: number;
      messageCount?: number;
    }
  ): Promise<TopicLabelResult> {
    // Fetch message content
    const messages = await this.fetchMessages(guildId, channelId, messageIds);

    if (messages.length === 0) {
      return {
        label: "empty conversation",
        confidence: 0,
        method: "error",
      };
    }

    // AI-only - no keyword fallback
    return await this.generateTopicLabelWithAI(messages, segmentMetadata);
  }

  /**
   * Generate topic label using AI (Gemini Flash)
   */
  private async generateTopicLabelWithAI(
    messages: TopicMessage[],
    metadata?: {
      duration?: number;
      participantCount?: number;
      messageCount?: number;
    }
  ): Promise<TopicLabelResult> {
    // Sample messages evenly distributed across the conversation
    const sampledMessages = this.sampleMessages(messages, 10);

    // Build metadata string
    const metadataStr = this.buildMetadataString(messages, metadata);

    // Construct prompt
    const prompt = this.buildTopicLabelPrompt(sampledMessages, metadataStr);

    // Call AI (use Grok for topic labeling - better rate limits)
    const response = await this.aiManager.generateText(
      prompt,
      "system",  // userId
      "grok",    // provider
      {
        useDiscordFormatting: false,
      }
    );

    if (!response.success || !response.content || !response.content.trim()) {
      throw new Error(`AI request failed: ${response.error || "Empty response"}`);
    }

    // Clean up response
    const label = this.cleanTopicLabel(response.content);

    return {
      label,
      confidence: 0.85,
      method: "ai",
    };
  }

  /**
   * Generate topic label using TF-IDF keywords (fallback)
   */
  private async generateTopicLabelWithKeywords(
    messages: TopicMessage[],
    guildId: string
  ): Promise<TopicLabelResult> {
    try {
      const result = await this.keywordExtractor.extractKeywords(
        messages.map((m) => ({
          id: m.id,
          author_id: m.author_id,
          content: m.content,
          created_at: m.created_at,
          guild_id: guildId,
          channel_id: "",
        })),
        guildId,
        { topN: 3 }
      );

      // extractKeywords returns an object with keywords array
      const keywords = Array.isArray(result) ? result : (result && 'keywords' in result ? result.keywords : []) || [];

      if (keywords.length === 0) {
        return {
          label: "general discussion",
          confidence: 0.3,
          method: "keywords",
        };
      }

      // Combine top 2-3 keywords
      const label = keywords
        .slice(0, 3)
        .map((k: any) => k.word)
        .join(" ");

      return {
        label,
        confidence: 0.6,
        method: "keywords",
      };
    } catch (error) {
      console.warn("   ⚠️  Keyword extraction failed:", error);
      return {
        label: "conversation",
        confidence: 0.2,
        method: "error",
      };
    }
  }

  /**
   * Fetch messages from database
   */
  private async fetchMessages(
    guildId: string,
    channelId: string,
    messageIds: string[]
  ): Promise<TopicMessage[]> {
    if (messageIds.length === 0) {
      return [];
    }

    const result = await this.db.query(
      `
      SELECT id, author_id, content, created_at
      FROM messages
      WHERE guild_id = $1
        AND channel_id = $2
        AND id = ANY($3::TEXT[])
      ORDER BY created_at ASC
      `,
      [guildId, channelId, messageIds]
    );

    if (!result.success || !result.data) {
      return [];
    }

    return result.data.map((row: any) => ({
      id: row.id,
      author_id: row.author_id,
      content: row.content || "",
      created_at: new Date(row.created_at),
    }));
  }

  /**
   * Sample messages evenly distributed across conversation
   */
  private sampleMessages(messages: TopicMessage[], maxSamples: number): TopicMessage[] {
    if (messages.length <= maxSamples) {
      return messages;
    }

    const step = messages.length / maxSamples;
    const sampled: TopicMessage[] = [];

    for (let i = 0; i < maxSamples; i++) {
      const index = Math.floor(i * step);
      const message = messages[index];
      if (message) {
        sampled.push(message);
      }
    }

    return sampled;
  }

  /**
   * Build metadata string for prompt
   */
  private buildMetadataString(
    messages: TopicMessage[],
    metadata?: {
      duration?: number;
      participantCount?: number;
      messageCount?: number;
    }
  ): string {
    const participants = new Set(messages.map((m) => m.author_id));
    const duration = metadata?.duration
      ? `${Math.round(metadata.duration)} min`
      : this.calculateDuration(messages);
    const messageCount = metadata?.messageCount || messages.length;
    const participantCount = metadata?.participantCount || participants.size;

    return `- Duration: ${duration}\n- Participants: ${participantCount} users\n- Messages: ${messageCount}`;
  }

  /**
   * Calculate conversation duration from messages
   */
  private calculateDuration(messages: TopicMessage[]): string {
    if (messages.length < 2) {
      return "< 1 min";
    }

    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    if (!firstMessage || !lastMessage) {
      return "< 1 min";
    }

    const first = firstMessage.created_at.getTime();
    const last = lastMessage.created_at.getTime();
    const durationMs = last - first;
    const minutes = Math.round(durationMs / (60 * 1000));

    if (minutes < 1) {
      return "< 1 min";
    } else if (minutes < 60) {
      return `${minutes} min`;
    } else {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
  }

  /**
   * Build topic label prompt
   */
  private buildTopicLabelPrompt(messages: TopicMessage[], metadata: string): string {
    const messageList = messages
      .map((m, i) => {
        const timestamp = m.created_at.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const content = m.content.length > 800 ? m.content.slice(0, 800) + "..." : m.content;
        return `[${timestamp}] ${content}`;
      })
      .join("\n");

    return `Analyze this Discord conversation and provide a concise topic label.

Conversation metadata:
${metadata}

Sample messages (evenly distributed):
${messageList}

Provide a 2-5 word topic label that describes what users are discussing.

Examples:
- "bot feature planning"
- "game strategy discussion"
- "weekend plans"
- "music recommendations"
- "debugging issues"

Respond with ONLY the topic label, nothing else.`;
  }

  /**
   * Clean and validate topic label
   */
  private cleanTopicLabel(raw: string): string {
    // Remove quotes, extra whitespace
    let label = raw.trim().toLowerCase();
    label = label.replace(/^["']|["']$/g, "");
    label = label.replace(/\s+/g, " ");

    // Truncate if too long (>30 chars)
    if (label.length > 30) {
      const words = label.split(" ");
      if (words.length > 5) {
        label = words.slice(0, 5).join(" ");
      } else {
        label = label.slice(0, 30);
      }
    }

    return label;
  }
}
