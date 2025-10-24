import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function checkDatabaseData() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check guilds
		const guilds = await db.db.query("SELECT * FROM guilds LIMIT 5");
		console.log(`🔹 Guilds in database: ${guilds[0]?.length || 0}`);
		if (guilds[0]?.length > 0) {
			console.log("Sample guild:", JSON.stringify(guilds[0][0], null, 2));
		}

		// Check members
		const members = await db.db.query("SELECT * FROM members LIMIT 5");
		console.log(`🔹 Members in database: ${members[0]?.length || 0}`);
		if (members[0]?.length > 0) {
			console.log("Sample member:", JSON.stringify(members[0][0], null, 2));
		}

		// Check messages
		const messages = await db.db.query("SELECT * FROM messages LIMIT 5");
		console.log(`🔹 Messages in database: ${messages[0]?.length || 0}`);
		if (messages[0]?.length > 0) {
			console.log("Sample message:", JSON.stringify(messages[0][0], null, 2));
		}

		// Check channels
		const channels = await db.db.query("SELECT * FROM channels LIMIT 5");
		console.log(`🔹 Channels in database: ${channels[0]?.length || 0}`);
		if (channels[0]?.length > 0) {
			console.log("Sample channel:", JSON.stringify(channels[0][0], null, 2));
		}

		// Check specific user
		const userResult = await db.getMember(
			"99195129516007424",
			process.env.GUILD_ID || "",
		);
		if (userResult.success && userResult.data) {
			console.log(
				`🔹 Found user alex:`,
				JSON.stringify(userResult.data, null, 2),
			);
		} else {
			console.log("🔸 User alex not found");
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

checkDatabaseData().catch(console.error);
