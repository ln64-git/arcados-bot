import "dotenv/config";
import { PostgreSQLManager } from "../PostgreSQLManager";
import { config } from "../../../config";

// Ensure SSL for Neon if not in the URL/params
if (!process.env.PGSSLMODE) process.env.PGSSLMODE = "require";

async function main() {
  const userId = process.argv[2] || process.env.USER_ID;
  const guildId = process.argv[3] || process.env.GUILD_ID;

  if (!userId) {
    console.error(
      "🔸 Usage: ts-node src/features/database/scripts/check-user-exists.ts <USER_ID> [GUILD_ID]"
    );
    process.exit(2);
  }

  if (!config.postgresUrl) {
    console.error("🔸 POSTGRES_URL not configured in environment.");
    process.exit(2);
  }

  const db = new PostgreSQLManager();
  try {
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect to PostgreSQL");
      process.exit(2);
    }

    let query =
      "SELECT EXISTS (SELECT 1 FROM members WHERE user_id = $1) AS exists";
    const params: string[] = [userId];
    if (guildId) {
      query =
        "SELECT EXISTS (SELECT 1 FROM members WHERE user_id = $1 AND guild_id = $2) AS exists";
      params.push(guildId);
    }

    const result = await db.query(query, params);
    if (!result.success) {
      console.error(`🔸 Query failed: ${result.error}`);
      process.exit(2);
    }

    const exists = Boolean((result.data?.[0] as any)?.exists);
    if (exists) {
      console.log("🔹 User exists", guildId ? `(guild ${guildId})` : "");
      process.exit(0);
    } else {
      console.log("🔸 User not found", guildId ? `(guild ${guildId})` : "");
      process.exit(1);
    }
  } catch (err) {
    console.error("🔸 Error:", err);
    process.exit(2);
  } finally {
    await db.disconnect();
  }
}

main();
