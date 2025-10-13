import { DatabaseCore } from "./src/features/database-manager/PostgresCore";

const userId = "773561252907581481";
const dojoChannelId = "1287323426465513512";
const guildId = "1254694808228986912";

async function debugVoiceSessions() {
	console.log(`🔍 Debugging voice sessions for user ${userId}`);

	const dbCore = new DatabaseCore();
	await dbCore.initialize();

	// Check all voice channel sessions for this user
	console.log("\n🎤 All voice channel sessions:");
	const query = `
		SELECT * FROM voice_channel_sessions 
		WHERE user_id = $1 
		ORDER BY joined_at DESC
	`;

	try {
		const { executeQuery } = await import(
			"./src/features/database-manager/PostgresConnection"
		);
		const sessions = await executeQuery(query, [userId]);

		if (sessions.length > 0) {
			console.log(`Found ${sessions.length} sessions:`);
			sessions.forEach((session, i) => {
				console.log(
					`  ${i + 1}. Channel ${session.channel_id} (${session.channel_name})`,
				);
				console.log(`     Joined: ${session.joined_at}`);
				console.log(`     Left: ${session.left_at || "Still active"}`);
				console.log(`     Duration: ${session.duration || "N/A"} seconds`);
				console.log(`     Is Active: ${session.is_active}`);
			});
		} else {
			console.log("❌ No voice channel sessions found");
		}
	} catch (error) {
		console.log(`❌ Error querying sessions: ${error}`);
	}

	// Try to create a session manually to test
	console.log("\n🧪 Testing session creation:");
	try {
		await dbCore.createVoiceChannelSession({
			userId: userId,
			guildId: guildId,
			channelId: dojoChannelId,
			channelName: "💻 - Dojo",
			joinedAt: new Date(),
			leftAt: undefined,
			duration: undefined,
			isActive: true,
		});
		console.log("✅ Successfully created test session");

		// Check if it was created
		const currentSession = await dbCore.getCurrentVoiceChannelSession(userId);
		if (currentSession) {
			console.log(
				`✅ Current session: Channel ${currentSession.channelId} (${currentSession.channelName})`,
			);
		} else {
			console.log(
				"❌ Session creation succeeded but getCurrentVoiceChannelSession returned null",
			);
		}
	} catch (error) {
		console.log(`❌ Error creating session: ${error}`);
	}

	process.exit(0);
}

debugVoiceSessions().catch(console.error);
