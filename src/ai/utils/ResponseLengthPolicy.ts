export type ResponseLengthCategory = "brief" | "medium" | "long" | "extended";
export type ConversationMode = "chat" | "structured";

export interface PolicyInput {
  userPrompt: string;
  historyCount: number;
  toolContextBytes: number; // approximate size of tool results passed to model
  clarifyingTurn?: boolean; // optional external signal
  mode?: ConversationMode; // chat (natural conversation) or structured (formal queries)
}

export interface PolicyOutput {
  category: ResponseLengthCategory;
  guidance: string; // one short sentence to nudge length naturally
  maxTokens: number; // soft target provided to provider
  temperatureNudge?: number; // small adjustment
  applyGuidance: boolean; // whether to inject guidance into prompt
}

const CATEGORY_CONFIG: Record<
  ResponseLengthCategory,
  { guidance: string; maxTokens: number; temperatureNudge?: number }
> = {
  brief: {
    guidance: "One sentence, ~10-20 words. Offer specific follow-up if relevant.",
    maxTokens: 60,
    temperatureNudge: -0.05,
  },
  medium: {
    guidance:
      "1-2 sentences, ~30-40 words. End with follow-up question if helpful.",
    maxTokens: 100,
    temperatureNudge: 0,
  },
  long: {
    guidance:
      "2-3 sentences with key details. Offer 2-3 specific follow-up options.",
    maxTokens: 200,
    temperatureNudge: 0.05,
  },
  extended: {
    guidance: "Short paragraph (4-6 sentences). Include follow-up choices.",
    maxTokens: 350,
    temperatureNudge: 0.1,
  },
};

export function computeResponsePolicy(input: PolicyInput): PolicyOutput {
  const mode = input.mode || "structured";

  // For chat mode: brief, conversational responses
  if (mode === "chat") {
    return {
      category: "brief",
      guidance:
        "One sentence (~10-20 words) unless context demands more. Offer follow-up: 'I can tell you about X or Y.'",
      maxTokens: 60,
      temperatureNudge: 0,
      applyGuidance: true,
    };
  }

  // For structured mode: apply adaptive policy based on context
  const text = input.userPrompt || "";
  const charLen = text.length;
  const hasQuestion = /\?/m.test(text);
  const entropyScore = new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  ).size;

  // Simple weighted score (no keyword rules)
  let score = 0;
  // prompt length
  score += Math.min(3, Math.floor(charLen / 80)); // 0..3
  // uniqueness/entropy
  score += Math.min(3, Math.floor(entropyScore / 12)); // 0..3
  // tool context availability
  score += Math.min(3, Math.floor(input.toolContextBytes / 800)); // 0..3
  // dialog depth
  score += Math.min(2, Math.floor(input.historyCount / 2)); // 0..2
  // clarify question bias
  if (hasQuestion || input.clarifyingTurn) score += 1;

  let category: ResponseLengthCategory;
  if (score <= 2) category = "brief";
  else if (score <= 4) category = "medium";
  else if (score <= 7) category = "long";
  else category = "extended";

  const cfg = CATEGORY_CONFIG[category];
  return {
    category,
    guidance: `${cfg.guidance} Write naturally like a Discord message - minimal formatting, flowing text.`,
    maxTokens: cfg.maxTokens,
    temperatureNudge: cfg.temperatureNudge,
    applyGuidance: true,
  };
}
