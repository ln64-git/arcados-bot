import { AIProvider, RateLimitInfo } from "./AIProvider";

export abstract class BaseAIProvider implements AIProvider {
  protected rateLimits: Map<string, { count: number; resetTime: number }> =
    new Map();
  protected readonly RATE_LIMIT: number;
  protected readonly RATE_WINDOW = 60 * 1000; // 1 minute in milliseconds

  constructor(rateLimit: number = 5) {
    this.RATE_LIMIT = rateLimit;
  }

  // Abstract methods that must be implemented by subclasses
  abstract getProviderName(): string;
  abstract getModelName(): string;
  abstract callTextAPI(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string>;
  abstract callImageAPI(
    prompt: string
  ): Promise<{ url: string; buffer: Buffer }>;

  // Common rate limiting functionality
  protected checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userLimit = this.rateLimits.get(userId);

    if (!userLimit) {
      this.rateLimits.set(userId, {
        count: 1,
        resetTime: now + this.RATE_WINDOW,
      });
      return true;
    }

    // Reset if window has passed
    if (now > userLimit.resetTime) {
      this.rateLimits.set(userId, {
        count: 1,
        resetTime: now + this.RATE_WINDOW,
      });
      return true;
    }

    // Check if under limit
    if (userLimit.count < this.RATE_LIMIT) {
      userLimit.count++;
      return true;
    }

    return false;
  }

  // Common rate limit info retrieval
  getRateLimitInfo(userId: string): RateLimitInfo {
    const userLimit = this.rateLimits.get(userId);
    if (!userLimit) {
      return { remaining: this.RATE_LIMIT, resetTime: 0 };
    }

    const now = Date.now();
    if (now > userLimit.resetTime) {
      return { remaining: this.RATE_LIMIT, resetTime: 0 };
    }

    return {
      remaining: Math.max(0, this.RATE_LIMIT - userLimit.count),
      resetTime: userLimit.resetTime,
    };
  }
}
