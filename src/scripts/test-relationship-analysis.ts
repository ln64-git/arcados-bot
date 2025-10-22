import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";
import { RelationshipNetworkManager } from "../features/relationship-network/RelationshipNetworkManager";

dotenv.config();

async function analyzeUserRelationships(userId: string) {
	const db = new SurrealDBManager();
	const relationshipManager = new RelationshipNetworkManager(db);

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		console.log(`🔹 Analyzing relationships for user ${userId}...`);
		const memberResult = await db.getMember(userId, process.env.GUILD_ID || "");

		if (!memberResult.success || !memberResult.data) {
			console.log("🔸 User not found in database");
			console.log("🔸 This suggests the Discord sync may not have completed properly");
			return;
		}

		const guildId = memberResult.data.guild_id;
		console.log(`🔹 Found user: ${memberResult.data.display_name}`);

		console.log(`🔹 Computing fresh relationship network for ${userId}`);
		const computeResult = await relationshipManager.updateMemberRelationships(
			userId,
			guildId,
		);

		if (computeResult.success) {
			console.log(
				`🔹 Updated relationship network for ${userId}`,
			);
		} else {
			console.error(
				`🔸 Failed to compute relationships for ${userId}:`,
				computeResult.error,
			);
		}

		const relationshipsResult = await relationshipManager.getTopRelationships(
			userId,
			guildId,
			10,
		);

		if (relationshipsResult.success && relationshipsResult.data) {
			console.log(`🔹 Top relationships for ${memberResult.data.display_name}:`);
			for (const rel of relationshipsResult.data) {
				const otherMember = await db.getMember(rel.user_id, guildId);
				const otherDisplayName = otherMember.success
					? otherMember.data?.display_name || rel.user_id
					: rel.user_id;
				console.log(
					`   - ${otherDisplayName} (${rel.user_id}): ${rel.affinity_score} points (${rel.interaction_count} interactions)`,
				);
			}
		} else {
			console.log(
				`🔸 Failed to get relationships: ${relationshipsResult.error}`,
			);
		}
	} catch (error) {
		console.error("🔸 Error during analysis:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

const targetUserId = "99195129516007424";
analyzeUserRelationships(targetUserId).catch(console.error);
