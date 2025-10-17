import { executeQuery } from "../features/database-manager/SurrealConnection";
import { createSurrealTables } from "../features/database-manager/SurrealSchema";

async function updateDiscriminatorField() {
	console.log("🔧 Updating discriminator field to allow null values...");

	try {
		// Drop the users table to recreate with updated schema
		console.log("🗑️ Dropping users table...");
		await executeQuery("REMOVE TABLE users;");
		console.log("✅ Users table dropped");

		// Recreate all tables with updated schema
		console.log("🔧 Recreating schema...");
		await createSurrealTables();
		console.log("✅ Schema recreated with updated discriminator field");

		console.log("🎉 Discriminator field update complete!");
	} catch (error) {
		console.error("🔸 Schema update failed:", error);
	}
}

updateDiscriminatorField().catch(console.error);
