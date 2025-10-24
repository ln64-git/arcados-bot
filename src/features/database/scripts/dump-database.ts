import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { SurrealDBManager } from "../database/SurrealDBManager";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

interface DatabaseDump {
	dumped_at: string;
	database_info: any;
	tables: {
		guilds: any[];
		channels: any[];
		members: any[];
		roles: any[];
		messages: any[];
		actions: any[];
		sync_metadata: any[];
	};
	summary: {
		total_guilds: number;
		total_channels: number;
		total_members: number;
		total_roles: number;
		total_messages: number;
		total_actions: number;
		total_sync_metadata: number;
	};
}

async function dumpDatabase() {
	console.log("🔹 Starting comprehensive database dump...");

	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		const dump: DatabaseDump = {
			dumped_at: new Date().toISOString(),
			database_info: null,
			tables: {
				guilds: [],
				channels: [],
				members: [],
				roles: [],
				messages: [],
				actions: [],
				sync_metadata: [],
			},
			summary: {
				total_guilds: 0,
				total_channels: 0,
				total_members: 0,
				total_roles: 0,
				total_messages: 0,
				total_actions: 0,
				total_sync_metadata: 0,
			},
		};

		// Get database info
		console.log("🔹 Getting database info...");
		try {
			const dbInfo = await db.db.query("INFO FOR DB");
			dump.database_info = dbInfo[0]?.result || {};
			console.log("🔹 Database info retrieved");
		} catch (error) {
			console.log("🔸 Failed to get database info:", error.message);
		}

		// Dump guilds
		console.log("🔹 Dumping guilds...");
		try {
			const guildsResult = await db.db.query("SELECT * FROM guilds");
			dump.tables.guilds = guildsResult[0]?.result || [];
			dump.summary.total_guilds = dump.tables.guilds.length;
			console.log(`🔹 Found ${dump.summary.total_guilds} guilds`);
		} catch (error) {
			console.log("🔸 Failed to dump guilds:", error.message);
		}

		// Dump channels
		console.log("🔹 Dumping channels...");
		try {
			const channelsResult = await db.db.query("SELECT * FROM channels");
			dump.tables.channels = channelsResult[0]?.result || [];
			dump.summary.total_channels = dump.tables.channels.length;
			console.log(`🔹 Found ${dump.summary.total_channels} channels`);
		} catch (error) {
			console.log("🔸 Failed to dump channels:", error.message);
		}

		// Dump members
		console.log("🔹 Dumping members...");
		try {
			const membersResult = await db.db.query("SELECT * FROM members");
			dump.tables.members = membersResult[0]?.result || [];
			dump.summary.total_members = dump.tables.members.length;
			console.log(`🔹 Found ${dump.summary.total_members} members`);
		} catch (error) {
			console.log("🔸 Failed to dump members:", error.message);
		}

		// Dump roles
		console.log("🔹 Dumping roles...");
		try {
			const rolesResult = await db.db.query("SELECT * FROM roles");
			dump.tables.roles = rolesResult[0]?.result || [];
			dump.summary.total_roles = dump.tables.roles.length;
			console.log(`🔹 Found ${dump.summary.total_roles} roles`);
		} catch (error) {
			console.log("🔸 Failed to dump roles:", error.message);
		}

		// Dump messages (this might be large, so we'll limit it)
		console.log("🔹 Dumping messages...");
		try {
			const messagesResult = await db.db.query(
				"SELECT * FROM messages ORDER BY timestamp DESC LIMIT 10000",
			);
			dump.tables.messages = messagesResult[0]?.result || [];
			dump.summary.total_messages = dump.tables.messages.length;
			console.log(
				`🔹 Found ${dump.summary.total_messages} messages (limited to 10,000 most recent)`,
			);
		} catch (error) {
			console.log("🔸 Failed to dump messages:", error.message);
		}

		// Dump actions
		console.log("🔹 Dumping actions...");
		try {
			const actionsResult = await db.db.query("SELECT * FROM actions");
			dump.tables.actions = actionsResult[0]?.result || [];
			dump.summary.total_actions = dump.tables.actions.length;
			console.log(`🔹 Found ${dump.summary.total_actions} actions`);
		} catch (error) {
			console.log("🔸 Failed to dump actions:", error.message);
		}

		// Dump sync metadata
		console.log("🔹 Dumping sync metadata...");
		try {
			const syncResult = await db.db.query("SELECT * FROM sync_metadata");
			dump.tables.sync_metadata = syncResult[0]?.result || [];
			dump.summary.total_sync_metadata = dump.tables.sync_metadata.length;
			console.log(
				`🔹 Found ${dump.summary.total_sync_metadata} sync metadata entries`,
			);
		} catch (error) {
			console.log("🔸 Failed to dump sync metadata:", error.message);
		}

		// Generate filename with timestamp
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `database-dump-${timestamp}.json`;
		const outputPath = path.join(process.cwd(), filename);

		// Write dump to file
		console.log("🔹 Writing dump to file...");
		fs.writeFileSync(outputPath, JSON.stringify(dump, null, 2));

		// Print summary
		console.log("\n🔹 Database Dump Complete");
		console.log("=".repeat(50));
		console.log(`📁 File: ${filename}`);
		console.log(
			`📊 Total Records: ${Object.values(dump.summary).reduce((sum, count) => sum + count, 0)}`,
		);
		console.log(`🏰 Guilds: ${dump.summary.total_guilds}`);
		console.log(`📺 Channels: ${dump.summary.total_channels}`);
		console.log(`👥 Members: ${dump.summary.total_members}`);
		console.log(`🎭 Roles: ${dump.summary.total_roles}`);
		console.log(`💬 Messages: ${dump.summary.total_messages}`);
		console.log(`⚡ Actions: ${dump.summary.total_actions}`);
		console.log(`🔄 Sync Metadata: ${dump.summary.total_sync_metadata}`);
		console.log(`📂 Output: ${outputPath}`);

		return outputPath;
	} catch (error) {
		console.error("🔸 Error during database dump:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

// Run the dump
dumpDatabase().catch(console.error);
