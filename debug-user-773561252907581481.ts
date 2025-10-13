import { getCacheManager } from "./src/features/cache-management/DiscordDataCache";
import { DatabaseCore } from "./src/features/database-manager/PostgresCore";

const userId = "773561252907581481";
const dojoChannelId = "1287323426465513512";

async function debugUser() {
	console.log(`🔍 Debugging user ${userId} in Dojo channel ${dojoChannelId}`);

	const dbCore = new DatabaseCore();
	await dbCore.initialize();

	const cache = getCacheManager();

	// Check if user exists in database
	console.log("\n📊 Database checks:");
	const user = await dbCore.getUser(userId, "1254694808228986912"); // Guild ID from logs
	if (user) {
		console.log(`✅ User exists in DB: ${user.username} (${user.displayName})`);
		console.log(`   Voice interactions: ${user.voiceInteractions.length}`);
		const activeInteractions = user.voiceInteractions.filter((i) => !i.leftAt);
		console.log(`   Active interactions: ${activeInteractions.length}`);
		activeInteractions.forEach((i) => {
			console.log(
				`     - Channel ${i.channelId} (${i.channelName}) since ${i.joinedAt}`,
			);
		});
	} else {
		console.log("❌ User not found in database");
	}

	// Check voice channel sessions
	console.log("\n🎤 Voice channel sessions:");
	const currentSession = await dbCore.getCurrentVoiceChannelSession(userId);
	if (currentSession) {
		console.log(
			`✅ Active session: Channel ${currentSession.channelId} (${currentSession.channelName})`,
		);
		console.log(`   Joined: ${currentSession.joinedAt}`);
		console.log(`   Is active: ${currentSession.isActive}`);
	} else {
		console.log("❌ No active voice channel session found");
	}

	// Check Redis cache
	console.log("\n💾 Redis cache:");
	try {
		const activeSession = await cache.getActiveVoiceSession(userId);
		if (activeSession) {
			console.log(
				`✅ Redis session: Channel ${activeSession.channelId} (${activeSession.channelName})`,
			);
			console.log(`   Joined: ${activeSession.joinedAt}`);
		} else {
			console.log("❌ No Redis session found");
		}
	} catch (error) {
		console.log(`❌ Redis error: ${error}`);
	}

	// Check channel members cache
	console.log("\n👥 Channel members cache:");
	try {
		const members = await cache.getChannelMembers(dojoChannelId);
		console.log(
			`Channel ${dojoChannelId} has ${members.length} cached members:`,
		);
		members.forEach((member) => {
			console.log(`   - ${member.userId} (joined: ${member.joinedAt})`);
		});
		const userInChannel = members.find((m) => m.userId === userId);
		if (userInChannel) {
			console.log(
				`✅ User found in channel cache (joined: ${userInChannel.joinedAt})`,
			);
		} else {
			console.log("❌ User not found in channel cache");
		}
	} catch (error) {
		console.log(`❌ Channel cache error: ${error}`);
	}

	process.exit(0);
}

debugUser().catch(console.error);
