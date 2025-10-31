import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function testHealing() {
  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect");
      return;
    }

    console.log("✅ Connected\n");

    const guildId = process.env.GUILD_ID || process.argv[2];
    if (!guildId) {
      console.error("🔸 Provide GUILD_ID as env var or argument");
      return;
    }

    console.log(`🔹 Testing healing for guild: ${guildId}\n`);

    // Check channel watermarks
    console.log("📝 Channel watermarks:");
    const watermarks = await db.query(
      `SELECT id, name, last_message_id, last_message_sync 
       FROM channels 
       WHERE guild_id = $1 AND last_message_id IS NOT NULL 
       ORDER BY last_message_sync DESC 
       LIMIT 10`,
      [guildId]
    );
    if (watermarks.success && watermarks.data) {
      watermarks.data.forEach((ch: any) => {
        console.log(
          `   #${ch.name}: ${ch.last_message_id} (synced ${new Date(ch.last_message_sync).toLocaleString()})`
        );
      });
    } else {
      console.log("   No watermarks found");
    }

    // Check message gaps
    console.log("\n🔍 Checking for message gaps...");
    const gaps = await db.query(
      `SELECT c.id, c.name, c.last_message_id, 
              (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.active = true) as message_count
       FROM channels c 
       WHERE c.guild_id = $1 AND c.active = true
       LIMIT 10`,
      [guildId]
    );
    if (gaps.success && gaps.data) {
      gaps.data.forEach((ch: any) => {
        console.log(
          `   #${ch.name}: ${ch.message_count} messages, watermark: ${ch.last_message_id || "none"}`
        );
      });
    }

    // Check members without relationships
    console.log("\n👥 Members without relationship networks:");
    const membersWithoutNetworks = await db.query(
      `SELECT user_id, display_name 
       FROM members 
       WHERE guild_id = $1 
         AND (relationship_network IS NULL OR relationship_network = '[]'::jsonb)
         AND bot = false
       LIMIT 10`,
      [guildId]
    );
    if (membersWithoutNetworks.success && membersWithoutNetworks.data) {
      if (membersWithoutNetworks.data.length === 0) {
        console.log("   All members have networks ✅");
      } else {
        membersWithoutNetworks.data.forEach((m: any) => {
          console.log(`   - ${m.display_name} (${m.user_id})`);
        });
      }
    }

    console.log("\n✅ Healing test complete");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

testHealing();

