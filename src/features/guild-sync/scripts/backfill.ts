import { GuildSyncManager } from "../GuildSyncManager";

async function run() {
  const manager = new GuildSyncManager();
  await manager.start();
}

run().catch((err) => {
  console.error("🔸 Backfill failed:", err);
  process.exit(1);
});
