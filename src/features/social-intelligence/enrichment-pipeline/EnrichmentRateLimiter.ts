/**
 * EnrichmentRateLimiter
 *
 * Manages token budget and rate limiting for enrichment pipeline.
 * Enforces hard caps:
 * - $1.00/day
 * - $40.00/month
 *
 * Prevents excessive LLM costs by tracking usage and blocking enrichment
 * when budgets are exceeded.
 */

import type { AIProvider } from "../../../ai/providers/base/BaseAIProvider";

interface RateLimitConfig {
	dailyCap: number; // USD
	monthlyCap: number; // USD
	warningThreshold: number; // Percentage (0-1)
}

interface CostEstimate {
	inputTokens: number;
	outputTokens: number;
	estimatedCost: number;
}

interface UsageStats {
	dailyCost: number;
	monthlyCost: number;
	dailyResetTime: Date;
	monthlyResetTime: Date;
	enrichmentsToday: number;
	enrichmentsMonth: number;
	lastWarningTime?: Date;
}

export class EnrichmentRateLimiter {
	private static instance: EnrichmentRateLimiter;

	// Hard caps (in USD)
	private readonly DAILY_CAP = 1.0;
	private readonly MONTHLY_CAP = 40.0;
	private readonly WARNING_THRESHOLD = 0.8; // Warn at 80%

	// Token cost estimates (approximate, provider-specific)
	private readonly COST_PER_1K_INPUT_TOKENS = {
		grok: 0.005, // $5 per 1M tokens
		gemini: 0.00015, // $0.15 per 1M tokens (flash)
		openai: 0.01, // $10 per 1M tokens (gpt-4o-mini)
	};

	private readonly COST_PER_1K_OUTPUT_TOKENS = {
		grok: 0.015, // $15 per 1M tokens
		gemini: 0.0006, // $0.60 per 1M tokens (flash)
		openai: 0.03, // $30 per 1M tokens (gpt-4o-mini)
	};

	private stats: UsageStats;

	private constructor() {
		this.stats = this.loadStats();
		this.resetIfNeeded();
	}

	public static getInstance(): EnrichmentRateLimiter {
		if (!EnrichmentRateLimiter.instance) {
			EnrichmentRateLimiter.instance = new EnrichmentRateLimiter();
		}
		return EnrichmentRateLimiter.instance;
	}

	/**
	 * Check if an enrichment can be afforded within budget caps
	 */
	public async canAffordEnrichment(
		estimatedCost: number,
	): Promise<{ canAfford: boolean; reason?: string }> {
		this.resetIfNeeded();

		// Check daily cap
		if (this.stats.dailyCost + estimatedCost > this.DAILY_CAP) {
			return {
				canAfford: false,
				reason: `Daily budget exceeded ($${this.stats.dailyCost.toFixed(4)}/$${this.DAILY_CAP})`,
			};
		}

		// Check monthly cap
		if (this.stats.monthlyCost + estimatedCost > this.MONTHLY_CAP) {
			return {
				canAfford: false,
				reason: `Monthly budget exceeded ($${this.stats.monthlyCost.toFixed(2)}/$${this.MONTHLY_CAP})`,
			};
		}

		// Check warning threshold
		const dailyPercentage =
			(this.stats.dailyCost + estimatedCost) / this.DAILY_CAP;
		const monthlyPercentage =
			(this.stats.monthlyCost + estimatedCost) / this.MONTHLY_CAP;

		if (
			(dailyPercentage > this.WARNING_THRESHOLD ||
				monthlyPercentage > this.WARNING_THRESHOLD) &&
			(!this.stats.lastWarningTime ||
				Date.now() - this.stats.lastWarningTime.getTime() > 3600000) // 1 hour
		) {
			console.warn(
				`⚠️  Enrichment budget warning: Daily ${(dailyPercentage * 100).toFixed(1)}%, Monthly ${(monthlyPercentage * 100).toFixed(1)}%`,
			);
			this.stats.lastWarningTime = new Date();
			this.saveStats();
		}

		return { canAfford: true };
	}

	/**
	 * Estimate cost of an enrichment based on token counts
	 */
	public estimateCost(
		inputTokens: number,
		outputTokens: number,
		provider: "grok" | "gemini" | "openai" = "grok",
	): CostEstimate {
		const inputCost =
			(inputTokens / 1000) * this.COST_PER_1K_INPUT_TOKENS[provider];
		const outputCost =
			(outputTokens / 1000) * this.COST_PER_1K_OUTPUT_TOKENS[provider];

		return {
			inputTokens,
			outputTokens,
			estimatedCost: inputCost + outputCost,
		};
	}

	/**
	 * Estimate cost for conversation summary enrichment
	 */
	public estimateConversationCost(messageCount: number): CostEstimate {
		// Rough estimates based on typical conversation summaries
		// Input: message samples + keywords + prompt (~150 tokens per message sample)
		// Output: summary (~200 tokens)
		const inputTokens = Math.min(messageCount * 150, 3000); // Cap at 3000
		const outputTokens = 200;

		return this.estimateCost(inputTokens, outputTokens, "grok");
	}

	/**
	 * Estimate cost for user profile enrichment
	 */
	public estimateUserProfileCost(conversationCount: number): CostEstimate {
		// Input: conversation summaries + user data + prompt
		// Output: profile summary delta (~300 tokens)
		const inputTokens = Math.min(conversationCount * 200, 4000);
		const outputTokens = 300;

		return this.estimateCost(inputTokens, outputTokens, "grok");
	}

	/**
	 * Estimate cost for relationship profile enrichment
	 */
	public estimateRelationshipCost(sharedConversations: number): CostEstimate {
		// Input: shared conversation summaries + user profiles + interaction metrics
		// Output: relationship summary (~250 tokens)
		const inputTokens = Math.min(sharedConversations * 200 + 1000, 4000);
		const outputTokens = 250;

		return this.estimateCost(inputTokens, outputTokens, "grok");
	}

	/**
	 * Estimate cost for guild summary enrichment
	 */
	public estimateGuildCost(topConversations: number): CostEstimate {
		// Input: top conversations + relationship data + community structure
		// Output: guild summary (~400 tokens)
		const inputTokens = Math.min(topConversations * 150 + 2000, 5000);
		const outputTokens = 400;

		return this.estimateCost(inputTokens, outputTokens, "grok");
	}

	/**
	 * Track actual cost after enrichment completes
	 */
	public async trackCost(actualCost: number, enrichmentType: string) {
		this.resetIfNeeded();

		this.stats.dailyCost += actualCost;
		this.stats.monthlyCost += actualCost;
		this.stats.enrichmentsToday++;
		this.stats.enrichmentsMonth++;

		this.saveStats();

		console.log(
			`💰 Enrichment cost tracked: $${actualCost.toFixed(4)} (${enrichmentType})`,
		);
		console.log(
			`   Daily: $${this.stats.dailyCost.toFixed(4)}/$${this.DAILY_CAP} (${((this.stats.dailyCost / this.DAILY_CAP) * 100).toFixed(1)}%)`,
		);
		console.log(
			`   Monthly: $${this.stats.monthlyCost.toFixed(2)}/$${this.MONTHLY_CAP} (${((this.stats.monthlyCost / this.MONTHLY_CAP) * 100).toFixed(1)}%)`,
		);
	}

	/**
	 * Get current usage statistics
	 */
	public getStats(): UsageStats {
		this.resetIfNeeded();
		return { ...this.stats };
	}

	/**
	 * Get remaining budget
	 */
	public getRemainingBudget(): {
		daily: number;
		monthly: number;
		dailyPercentage: number;
		monthlyPercentage: number;
	} {
		this.resetIfNeeded();

		return {
			daily: Math.max(0, this.DAILY_CAP - this.stats.dailyCost),
			monthly: Math.max(0, this.MONTHLY_CAP - this.stats.monthlyCost),
			dailyPercentage: (this.stats.dailyCost / this.DAILY_CAP) * 100,
			monthlyPercentage: (this.stats.monthlyCost / this.MONTHLY_CAP) * 100,
		};
	}

	/**
	 * Reset daily/monthly counters if time period has elapsed
	 */
	private resetIfNeeded() {
		const now = new Date();

		// Reset daily if new day
		if (now >= this.stats.dailyResetTime) {
			this.stats.dailyCost = 0;
			this.stats.enrichmentsToday = 0;
			this.stats.dailyResetTime = this.getNextMidnight();
			console.log("🔄 Daily enrichment budget reset");
			this.saveStats();
		}

		// Reset monthly if new month
		if (now >= this.stats.monthlyResetTime) {
			this.stats.monthlyCost = 0;
			this.stats.enrichmentsMonth = 0;
			this.stats.monthlyResetTime = this.getNextMonthStart();
			console.log("🔄 Monthly enrichment budget reset");
			this.saveStats();
		}
	}

	/**
	 * Get next midnight UTC
	 */
	private getNextMidnight(): Date {
		const tomorrow = new Date();
		tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
		tomorrow.setUTCHours(0, 0, 0, 0);
		return tomorrow;
	}

	/**
	 * Get first day of next month UTC
	 */
	private getNextMonthStart(): Date {
		const nextMonth = new Date();
		nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
		nextMonth.setUTCDate(1);
		nextMonth.setUTCHours(0, 0, 0, 0);
		return nextMonth;
	}

	/**
	 * Load stats from persistent storage (could use Redis, file, or DB)
	 * For now, using in-memory with file persistence
	 */
	private loadStats(): UsageStats {
		// TODO: Load from file or database
		// For now, initialize fresh
		return {
			dailyCost: 0,
			monthlyCost: 0,
			dailyResetTime: this.getNextMidnight(),
			monthlyResetTime: this.getNextMonthStart(),
			enrichmentsToday: 0,
			enrichmentsMonth: 0,
		};
	}

	/**
	 * Save stats to persistent storage
	 */
	private saveStats() {
		// TODO: Persist to file or database
		// For now, stats are in-memory only
	}

	/**
	 * Force reset all counters (for testing)
	 */
	public resetAll() {
		this.stats = this.loadStats();
		console.log("🔄 All enrichment budgets forcefully reset");
	}
}
