import "dotenv/config";
import { config } from "../config/index.js";
import {
  backfillRecentConversations,
  type BackfillOptions,
} from "./backfill-recent-conversations.js";

function parseChannelIds(input?: string): string[] | undefined {
  if (!input) return undefined;
  return input
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

async function main() {
  const guildId =
    process.argv[2] || process.env.GUILD_ID || config.guildId || "";
  if (!guildId) {
    console.error(
      "🔸 Please provide a guild ID (argument or GUILD_ID env variable)."
    );
    process.exit(1);
  }

  const hoursArg = process.argv[3] ?? process.env.GEMINI_SPLIT_HOURS ?? "24";
  const delayArg =
    process.argv[4] ?? process.env.GEMINI_SPLIT_DELAY_MS ?? "45000";
  const channelArg =
    process.argv[5] ?? process.env.GEMINI_SPLIT_CHANNELS ?? "";

  const hours = Number.parseInt(hoursArg, 10);
  const delayMs = Number.parseInt(delayArg, 10);
  const channelIds = parseChannelIds(channelArg);

  const options: BackfillOptions = {
    forceEnableTopicSplitting: true,
    sleepBetweenChannelsMs: Number.isFinite(delayMs) ? Math.max(delayMs, 0) : 0,
    channelIds,
  };

  console.log("🔹 Running Gemini topic sorting pass");
  console.log(
    `   Guild: ${guildId}, Window: last ${hours}h, Delay: ${
      options.sleepBetweenChannelsMs ?? 0
    }ms, Channels: ${
      channelIds && channelIds.length > 0 ? channelIds.join(", ") : "auto"
    }`
  );

  await backfillRecentConversations(guildId, hours, options);
  console.log("✅ Gemini topic sorting pass complete.");
}

main().catch((error) => {
  console.error("🔸 Gemini topic sorting failed:", error);
  process.exit(1);
});
