import { Surreal } from "surrealdb";

async function testRawSurrealDB() {
	const db = new Surreal();

	try {
		// Connect to SurrealDB
		await db.connect("ws://localhost:8000/rpc");
		console.log("🔹 Connected to SurrealDB");

		// Sign in
		await db.signin({
			user: "root",
			pass: "root",
		});

		// Use the database
		await db.use("arcados", "arcados");
		console.log("🔹 Using database arcados");

		// Test a simple query
		console.log("🔹 Testing simple query...");
		const result = await db.query("SELECT COUNT() FROM actions WHERE executed = false AND active = true");
		console.log("🔹 Count result:", result);

		// Test updating a single action
		console.log("🔹 Testing update...");
		const updateResult = await db.query(
			"UPDATE actions SET executed = true WHERE id = 'actions:0gscyer57dbdnumlm16k'"
		);
		console.log("🔹 Update result:", updateResult);

		// Check if it worked
		const checkResult = await db.query(
			"SELECT executed FROM actions WHERE id = 'actions:0gscyer57dbdnumlm16k'"
		);
		console.log("🔹 Check result:", checkResult);

		console.log("🔹 Test completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.close();
	}
}

testRawSurrealDB();
