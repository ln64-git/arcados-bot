import { PostgreSQLManager } from "../database/PostgreSQLManager";

/**
 * Migration script to add relationship network fields to existing PostgreSQL schema
 */

async function migratePostgreSQLSchema(): Promise<void> {
	console.log("🔹 PostgreSQL Relationship Network Schema Migration");
	console.log("=".repeat(60));

	const db = new PostgreSQLManager();

	try {
		const connected = await db.connect();
		if (!connected) {
			console.log("🔸 Failed to connect to PostgreSQL database");
			return;
		}

		console.log("🔹 Connected to PostgreSQL database");

		// Check if relationship_network column already exists
		const checkColumn = await db.query(`
			SELECT column_name 
			FROM information_schema.columns 
			WHERE table_name = 'members' 
			AND column_name = 'relationship_network'
		`);

		if (
			checkColumn.success &&
			checkColumn.data &&
			checkColumn.data.length > 0
		) {
			console.log("✅ relationship_network column already exists");
		} else {
			console.log("🔹 Adding relationship_network column to members table...");

			const addColumn = await db.query(`
				ALTER TABLE members 
				ADD COLUMN relationship_network JSONB DEFAULT '[]'
			`);

			if (addColumn.success) {
				console.log("✅ Successfully added relationship_network column");
			} else {
				console.log(
					`🔸 Failed to add relationship_network column: ${addColumn.error}`,
				);
			}
		}

		// Check if summary column exists
		const checkSummary = await db.query(`
			SELECT column_name 
			FROM information_schema.columns 
			WHERE table_name = 'members' 
			AND column_name = 'summary'
		`);

		if (
			checkSummary.success &&
			checkSummary.data &&
			checkSummary.data.length > 0
		) {
			console.log("✅ summary column already exists");
		} else {
			console.log("🔹 Adding summary column to members table...");

			const addSummary = await db.query(`
				ALTER TABLE members 
				ADD COLUMN summary TEXT
			`);

			if (addSummary.success) {
				console.log("✅ Successfully added summary column");
			} else {
				console.log(`🔸 Failed to add summary column: ${addSummary.error}`);
			}
		}

		// Check if keywords column exists
		const checkKeywords = await db.query(`
			SELECT column_name 
			FROM information_schema.columns 
			WHERE table_name = 'members' 
			AND column_name = 'keywords'
		`);

		if (
			checkKeywords.success &&
			checkKeywords.data &&
			checkKeywords.data.length > 0
		) {
			console.log("✅ keywords column already exists");
		} else {
			console.log("🔹 Adding keywords column to members table...");

			const addKeywords = await db.query(`
				ALTER TABLE members 
				ADD COLUMN keywords TEXT[]
			`);

			if (addKeywords.success) {
				console.log("✅ Successfully added keywords column");
			} else {
				console.log(`🔸 Failed to add keywords column: ${addKeywords.error}`);
			}
		}

		// Check if emojis column exists
		const checkEmojis = await db.query(`
			SELECT column_name 
			FROM information_schema.columns 
			WHERE table_name = 'members' 
			AND column_name = 'emojis'
		`);

		if (
			checkEmojis.success &&
			checkEmojis.data &&
			checkEmojis.data.length > 0
		) {
			console.log("✅ emojis column already exists");
		} else {
			console.log("🔹 Adding emojis column to members table...");

			const addEmojis = await db.query(`
				ALTER TABLE members 
				ADD COLUMN emojis TEXT[]
			`);

			if (addEmojis.success) {
				console.log("✅ Successfully added emojis column");
			} else {
				console.log(`🔸 Failed to add emojis column: ${addEmojis.error}`);
			}
		}

		// Check if notes column exists
		const checkNotes = await db.query(`
			SELECT column_name 
			FROM information_schema.columns 
			WHERE table_name = 'members' 
			AND column_name = 'notes'
		`);

		if (checkNotes.success && checkNotes.data && checkNotes.data.length > 0) {
			console.log("✅ notes column already exists");
		} else {
			console.log("🔹 Adding notes column to members table...");

			const addNotes = await db.query(`
				ALTER TABLE members 
				ADD COLUMN notes TEXT[]
			`);

			if (addNotes.success) {
				console.log("✅ Successfully added notes column");
			} else {
				console.log(`🔸 Failed to add notes column: ${addNotes.error}`);
			}
		}

		// Verify final schema
		console.log("\n🔹 Verifying final schema...");
		const verifySchema = await db.query(`
			SELECT column_name, data_type, is_nullable, column_default
			FROM information_schema.columns 
			WHERE table_name = 'members' 
			AND column_name IN ('relationship_network', 'summary', 'keywords', 'emojis', 'notes')
			ORDER BY column_name
		`);

		if (verifySchema.success && verifySchema.data) {
			console.log("✅ Schema verification successful:");
			verifySchema.data.forEach((column: any) => {
				console.log(
					`   - ${column.column_name}: ${column.data_type} (nullable: ${column.is_nullable})`,
				);
			});
		}

		console.log("\n🔹 Migration completed successfully!");
		console.log("=".repeat(60));
		console.log(
			"🔹 Your PostgreSQL schema is now ready for relationship networks",
		);
	} catch (error) {
		console.error("🔸 Migration failed:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from PostgreSQL");
	}
}

// Run the migration
if (import.meta.url === `file://${process.argv[1]}`) {
	migratePostgreSQLSchema().catch(console.error);
}

export { migratePostgreSQLSchema };
