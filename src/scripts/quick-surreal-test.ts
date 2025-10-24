import { Surreal } from "surrealdb";
import dotenv from "dotenv";

dotenv.config();

async function quickTest() {
	console.log("🔹 Quick SurrealDB Cloud test...");
	console.log(`SURREAL_URL: ${process.env.SURREAL_URL}`);
	console.log(`SURREAL_NAMESPACE: ${process.env.SURREAL_NAMESPACE}`);
	console.log(`SURREAL_DATABASE: ${process.env.SURREAL_DATABASE}`);

	const db = new Surreal();

	try {
		console.log("🔹 Connecting...");
		await db.connect(process.env.SURREAL_URL!);

		console.log("🔹 Authenticating...");
		if (process.env.SURREAL_TOKEN) {
			await db.authenticate(process.env.SURREAL_TOKEN);
		} else {
			await db.signin({
				username: process.env.SURREAL_USERNAME!,
				password: process.env.SURREAL_PASSWORD!,
			});
		}

		console.log("🔹 Setting namespace and database...");
		await db.use(process.env.SURREAL_NAMESPACE!, process.env.SURREAL_DATABASE!);

		console.log("🔹 Testing query...");
		const messages = await db.select("messages");
		console.log(`✅ Found ${messages.length} messages`);

		const userId = "99195129516007424";
		const userMessages = messages.filter(
			(msg: any) => msg.author_id === userId,
		);
		console.log(`✅ Found ${userMessages.length} messages from user ${userId}`);

		if (userMessages.length > 0) {
			userMessages.sort(
				(a: any, b: any) =>
					new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
			);

			console.log("\n🔹 Earliest 5 messages:");
			const earliest = userMessages.slice(0, 5);
			earliest.forEach((msg: any, i: number) => {
				console.log(
					`${i + 1}. [${new Date(msg.timestamp).toLocaleString()}] "${msg.content || "(No content)"}"`,
				);
			});
		}
	} catch (error) {
		console.error("❌ Error:", error);
	} finally {
		await db.close();
		console.log("🔹 Done!");
	}
}

quickTest().catch(console.error);
