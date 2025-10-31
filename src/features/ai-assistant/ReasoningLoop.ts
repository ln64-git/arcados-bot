import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import { RelationshipNetworkManager } from "../relationship-network/NetworkManager";

type Message = { role: "system" | "user" | "assistant"; content: string };

type ToolCall =
  | { type: "tool"; name: string; args?: Record<string, any> }
  | { type: "final"; answer: string }
  | { type: "memory.write"; key: string; value: string };

type PlanResponse = {
  thought?: string;
  next: ToolCall;
};

type ToolRegistry = Record<
  string,
  (args: Record<string, any>) => Promise<{ ok: boolean; data?: any; error?: string }>
>;

type LoopOptions = {
  maxSteps?: number;
  systemPreamble?: string;
};

export class ReasoningLoop {
  constructor(
    private callModel: (messages: Message[]) => Promise<string>,
    private tools: ToolRegistry,
    private memoryWrite?: (key: string, value: string) => Promise<void>
  ) {}

  public async run(
    userPrompt: string,
    context: { userId: string; guildId: string; history?: Message[] },
    options?: LoopOptions
  ): Promise<string> {
    const maxSteps = options?.maxSteps ?? 3;

    const messages: Message[] = [
      {
        role: "system",
        content:
          options?.systemPreamble ??
          "You are a helpful, concise assistant for Discord. Think step by step. Use tools when helpful. Keep replies short for chat.",
      },
      ...(context.history || []),
      { role: "user", content: userPrompt },
    ];

    for (let i = 0; i < maxSteps; i++) {
      const planRaw = await this.callModel([
        ...messages,
        {
          role: "system",
          content:
            'Output a single JSON object with keys: "thought" (optional), "next". "next" must be one of: ' +
            '{ "type":"tool","name":"<toolName>","args":{...} } OR ' +
            '{ "type":"memory.write","key":"string","value":"string"} OR ' +
            '{ "type":"final","answer":"string"}',
        },
      ]);

      let plan: PlanResponse;
      try {
        const cleaned = planRaw.trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        plan = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
      } catch {
        return "Sorry, I couldn't figure that out.";
      }

      if (plan.next.type === "final") {
        return plan.next.answer;
      }

      if (plan.next.type === "memory.write") {
        if (this.memoryWrite && plan.next.key && plan.next.value) {
          try {
            await this.memoryWrite(plan.next.key, plan.next.value);
          } catch {}
        }
        messages.push({
          role: "assistant",
          content: `Noted memory: ${plan.next.key}`,
        });
        continue;
      }

      if (plan.next.type === "tool") {
        const tool = this.tools[plan.next.name];
        if (!tool) {
          messages.push({
            role: "assistant",
            content: `Tool ${plan.next.name} unavailable.`,
          });
          continue;
        }
        let observation = { ok: false, error: "unknown" };
        try {
          observation = await tool(plan.next.args || {});
        } catch (e: any) {
          observation = { ok: false, error: e?.message || "tool failure" };
        }
        messages.push({
          role: "assistant",
          content: `Tool:${plan.next.name}\nArgs:${JSON.stringify(plan.next.args || {})}\nObservation:${JSON.stringify(observation)}`,
        });
      }
    }

    return "That's what I have for now.";
  }
}

/**
 * Create reasoning loop with standard tools for relationship memory
 */
export function createReasoningLoop(
  db: PostgreSQLManager,
  relationshipManager: RelationshipNetworkManager,
  botUserId: string,
  callModel: (messages: Message[]) => Promise<string>
): ReasoningLoop {
  const tools: ToolRegistry = {
    getUserRelationshipSummary: async (args: any) => {
      try {
        const userId = args.userId || args.user_id;
        const guildId = args.guildId || args.guild_id;

        const dyadResult = await relationshipManager.getDyadSummary(
          botUserId,
          userId,
          guildId
        );

        if (!dyadResult.success || !dyadResult.data) {
          return { ok: false, error: "No relationship data" };
        }

        const summary = {
          bot_to_user: dyadResult.data.a_to_b,
          user_to_bot: dyadResult.data.b_to_a,
        };

        return { ok: true, data: summary };
      } catch (e: any) {
        return { ok: false, error: e?.message || "tool error" };
      }
    },

    getPeerMatrix: async (args: any) => {
      try {
        const participantIds = args.participantIds || args.participants || [];
        const guildId = args.guildId || args.guild_id;

        if (participantIds.length < 2) {
          return { ok: false, error: "Need at least 2 participants" };
        }

        const matrixResult = await relationshipManager.getPeerMatrix(
          participantIds,
          guildId
        );

        if (!matrixResult.success || !matrixResult.data) {
          return { ok: false, error: "Failed to get matrix" };
        }

        return { ok: true, data: matrixResult.data };
      } catch (e: any) {
        return { ok: false, error: e?.message || "tool error" };
      }
    },

    getGroupSegments: async (args: any) => {
      try {
        const participantIds = args.participantIds || args.participants || [];
        const guildId = args.guildId || args.guild_id;
        const limit = args.limit || 5;

        const segmentsResult = await db.getSegmentsForParticipants(
          guildId,
          participantIds,
          limit,
          args.since ? new Date(args.since) : undefined
        );

        if (!segmentsResult.success || !segmentsResult.data) {
          return { ok: false, error: "Failed to get segments" };
        }

        return { ok: true, data: segmentsResult.data };
      } catch (e: any) {
        return { ok: false, error: e?.message || "tool error" };
      }
    },
  };

  const memoryWrite = async (key: string, value: string) => {
    try {
      const [guildId, userId] = key.split(":user:");
      if (guildId && userId) {
        const memberId = `${guildId}_${botUserId}`;
        const edgesResult = await db.getEdgesForUser(guildId, botUserId, 100);
        if (edgesResult.success && edgesResult.data) {
          const edge = edgesResult.data.find(
            (e) => e.user_a === botUserId && e.user_b === userId
          );
          if (edge) {
            // Append note to edge (would need a notes field or separate table)
            // For now, just log it
            console.log(`Memory note for ${key}: ${value}`);
          }
        }
      }
    } catch {}
  };

  return new ReasoningLoop(callModel, tools, memoryWrite);
}

