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
    guidance:
      "Keep it tight—one short sentence unless essential context is missing.",
    maxTokens: 120,
    temperatureNudge: -0.05,
  },
  medium: {
    guidance: "Aim for 2–4 sentences that directly answer.",
    maxTokens: 280,
    temperatureNudge: 0,
  },
  long: {
    guidance: "One short paragraph; add a concrete example if it helps.",
    maxTokens: 600,
    temperatureNudge: 0.05,
  },
  extended: {
    guidance: "A few short paragraphs if it adds value—avoid padding.",
    maxTokens: 1200,
    temperatureNudge: 0.1,
  },
};

export function computeResponsePolicy(input: PolicyInput): PolicyOutput {
  const mode = input.mode || "structured";

  // For chat mode: allow flexible, natural responses
  if (mode === "chat") {
    return {
      category: "medium",
      guidance:
        "Respond naturally - be as brief or detailed as needed to fully understand and help. Match the user's intent.",
      maxTokens: 600, // Allow more room for natural, understanding responses
      temperatureNudge: 0.05, // Slightly more creative/adaptive
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
