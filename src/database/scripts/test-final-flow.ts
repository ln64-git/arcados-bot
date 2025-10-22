import { SurrealDBManager } from "../database/SurrealDBManager";

async function testCompleteFlow() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Step 1: Create a test channel
		console.log("🔹 STEP 1: Creating a test channel...");
		const createAction = {
			guild_id: "1254694808228986912",
			type: "voice_channel_create",
			payload: {
				guild_id: "1254694808228986912",
				user_id: "1425975573364080731",
				spawn_channel_id: "1428282734173880440",
				channel_name: "Final Test Channel",
				user_limit: 0,
			},
		};

		const createResult = await db.createAction(createAction);
		if (!createResult.success) {
			console.error("❌ Failed to create channel:", createResult.error);
			return;
		}

		console.log("✅ Channel creation action created");

		// Wait for channel to be created and marked as user channel
		console.log("🔹 Waiting for channel creation and marking...");
		await new Promise((resolve) => setTimeout(resolve, 4000));

		// Step 2: Check if channel exists in database
		console.log("\n🔹 STEP 2: Checking if channel exists in database...");
		const channels = await db.query(
			"SELECT * FROM channels WHERE guild_id = '1254694808228986912' AND is_user_channel = true",
		);

		console.log("🔹 Channels in database:", JSON.stringify(channels, null, 2));

		if (!channels[0] || !(channels[0] as Record<string, unknown>)[0]) {
			console.error("❌ No channels found in database");
			return;
		}

		const channelData = (channels[0] as Record<string, unknown>)[0] as Record<
			string,
			unknown
		>;
		const channelId = channelData.id as string;

		console.log(`✅ Found channel ID: ${channelId}`);

		// Step 3: Test channel deletion
		console.log("\n🔹 STEP 3: Testing channel deletion...");
		const voiceLeaveAction = {
			guild_id: "1254694808228986912",
			type: "voice_user_leave",
			payload: {
				user_id: "1425975573364080731",
				guild_id: "1254694808228986912",
				channel_id: channelId,
				was_owner: true,
			},
		};

		const leaveResult = await db.createAction(voiceLeaveAction);
		if (!leaveResult.success) {
			console.error("❌ Failed to create leave action:", leaveResult.error);
			return;
		}

		console.log("✅ Voice user leave action created");

		// Wait for deletion to process
		console.log("🔹 Waiting for channel deletion...");
		await new Promise((resolve) => setTimeout(resolve, 3000));

		// Step 4: Check if channel was deleted
		console.log("\n🔹 STEP 4: Checking if channel was deleted...");
		const channelsAfter = await db.query(
			"SELECT * FROM channels WHERE guild_id = '1254694808228986912' AND is_user_channel = true",
		);

		console.log(
			"🔹 Channels after deletion:",
			JSON.stringify(channelsAfter, null, 2),
		);

		console.log(
			"\n🎉 Test complete! Check the bot logs for detailed processing.",
		);
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

testCompleteFlow();
