import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function testActionProcessorDirectly() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Test the getPendingActions method directly
		console.log("🔹 Testing getPendingActions method...");
		const result = await db.getPendingActions();

		if (result.success) {
			console.log(
				`✅ getPendingActions successful: ${result.data?.length || 0} actions`,
			);
		} else {
			console.error("❌ getPendingActions failed:", result.error);
		}

		// Test the isConnected method
		console.log("🔹 Testing isConnected method...");
		const isConnected = db.isConnected();
		console.log(`✅ isConnected: ${isConnected}`);

		console.log("🔹 Action processor test completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

testActionProcessorDirectly();
