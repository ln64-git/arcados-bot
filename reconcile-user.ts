import { DatabaseCore } from "./src/features/database-manager/PostgresCore";

const userId = "773561252907581481";
const dojoChannelId = "1287323426465513512";
const guildId = "1254694808228986912";

async function reconcileUser() {
	console.log(`🔧 Reconciling user ${userId} voice session`);

	const dbCore = new DatabaseCore();
	await dbCore.initialize();

	// Get user's active voice interactions
	const user = await dbCore.getUser(userId, guildId);
	if (!user) {
		console.log("❌ User not found");
		return;
	}

	const activeInteractions = user.voiceInteractions.filter((i) => !i.leftAt);
	console.log(`Found ${activeInteractions.length} active voice interactions`);

	for (const interaction of activeInteractions) {
		console.log(
			`\n📝 Processing interaction in channel ${interaction.channelId} (${interaction.channelName})`,
		);

		// Check if voice channel session already exists
		const existingSession = await dbCore.getCurrentVoiceChannelSession(userId);
		if (
			existingSession &&
			existingSession.channelId === interaction.channelId
		) {
			console.log(`✅ Voice channel session already exists`);
			continue;
		}

		// Create missing voice channel session
		try {
			await dbCore.createVoiceChannelSession({
				userId: userId,
				guildId: guildId,
				channelId: interaction.channelId,
				channelName: interaction.channelName,
				joinedAt: interaction.joinedAt,
				leftAt: undefined,
				duration: undefined,
				isActive: true,
			});
			console.log(
				`✅ Created voice channel session for channel ${interaction.channelId}`,
			);
		} catch (error) {
			console.log(`❌ Failed to create session: ${error}`);
		}
	}

	// Verify the session was created
	const currentSession = await dbCore.getCurrentVoiceChannelSession(userId);
	if (currentSession) {
		console.log(
			`\n✅ Verification: User now has active session in channel ${currentSession.channelId} (${currentSession.channelName})`,
		);
	} else {
		console.log(`\n❌ Verification failed: No active session found`);
	}

	process.exit(0);
}

reconcileUser().catch(console.error);
