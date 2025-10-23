import { Pool } from "pg";

/**
 * Simple test to check if user exists and build relationship network manually
 */

async function testUserRelationshipNetwork(userId) {
	console.log(`🔹 Testing relationship network for user ${userId}`);
	console.log("=".repeat(60));

	// Direct database connection
	const pool = new Pool({
		connectionString: process.env.POSTGRES_URL || "postgresql://localhost:5432/arcados",
	});

	try {
		const client = await pool.connect();
		console.log("🔹 Connected to PostgreSQL database");

		// Check if user exists
		console.log(`\n🔹 Checking if user ${userId} exists...`);
		const userQuery = await client.query(`
			SELECT DISTINCT guild_id, username, display_name 
			FROM members 
			WHERE user_id = $1 AND active = true
		`, [userId]);

		if (userQuery.rows.length === 0) {
			console.log(`🔸 User ${userId} not found in any guilds`);
			return;
		}

		console.log(`✅ Found user in ${userQuery.rows.length} guild(s):`);
		userQuery.rows.forEach((member) => {
			console.log(`   - Guild: ${member.guild_id} (${member.display_name || member.username})`);
		});

		// Test with the first guild
		const guildId = userQuery.rows[0].guild_id;
		console.log(`\n🔹 Testing with guild ${guildId}...`);

		// Get guild member count
		const memberCountQuery = await client.query(`
			SELECT COUNT(*) as count FROM members 
			WHERE guild_id = $1 AND active = true
		`, [guildId]);
		
		console.log(`🔹 Guild has ${memberCountQuery.rows[0].count} members`);

		// Get messages for this user
		console.log(`\n🔹 Getting messages for user ${userId}...`);
		const messagesQuery = await client.query(`
			SELECT COUNT(*) as count FROM messages 
			WHERE author_id = $1 AND guild_id = $2 AND active = true
		`, [userId, guildId]);
		
		console.log(`🔹 User has ${messagesQuery.rows[0].count} messages in this guild`);

		// Get messages from both this user and others in the same channels
		console.log(`\n🔹 Analyzing message interactions...`);
		const interactionsQuery = await client.query(`
			SELECT 
				m1.channel_id,
				m1.author_id as user1,
				m2.author_id as user2,
				m1.created_at as time1,
				m2.created_at as time2,
				EXTRACT(EPOCH FROM (m2.created_at - m1.created_at)) as time_diff_seconds
			FROM messages m1
			JOIN messages m2 ON m1.channel_id = m2.channel_id 
				AND m1.author_id != m2.author_id
				AND m2.created_at > m1.created_at
				AND m2.created_at <= m1.created_at + INTERVAL '5 minutes'
			WHERE m1.guild_id = $1 
				AND m1.active = true 
				AND m2.active = true
				AND (m1.author_id = $2 OR m2.author_id = $2)
			ORDER BY m1.created_at
			LIMIT 20
		`, [guildId, userId]);

		console.log(`🔹 Found ${interactionsQuery.rows.length} potential interactions`);
		
		if (interactionsQuery.rows.length > 0) {
			console.log(`\n🔹 Sample interactions:`);
			interactionsQuery.rows.slice(0, 5).forEach((interaction, index) => {
				const otherUser = interaction.user1 === userId ? interaction.user2 : interaction.user1;
				console.log(`   ${index + 1}. User ${otherUser} - ${Math.round(interaction.time_diff_seconds)}s gap`);
			});
		}

		// Check for mentions
		console.log(`\n🔹 Checking for mentions...`);
		const mentionsQuery = await client.query(`
			SELECT COUNT(*) as count FROM messages 
			WHERE guild_id = $1 
				AND content LIKE $2 
				AND active = true
		`, [guildId, `%<@${userId}>%`]);
		
		console.log(`🔹 Found ${mentionsQuery.rows[0].count} messages mentioning this user`);

		// Simple relationship scoring
		console.log(`\n🔹 Calculating simple relationship scores...`);
		const relationshipQuery = await client.query(`
			WITH user_interactions AS (
				SELECT 
					CASE 
						WHEN m1.author_id = $2 THEN m2.author_id
						WHEN m2.author_id = $2 THEN m1.author_id
					END as other_user,
					COUNT(*) as interaction_count,
					MAX(m2.created_at) as last_interaction
				FROM messages m1
				JOIN messages m2 ON m1.channel_id = m2.channel_id 
					AND m1.author_id != m2.author_id
					AND m2.created_at > m1.created_at
					AND m2.created_at <= m1.created_at + INTERVAL '5 minutes'
				WHERE m1.guild_id = $1 
					AND m1.active = true 
					AND m2.active = true
					AND (m1.author_id = $2 OR m2.author_id = $2)
				GROUP BY other_user
			)
			SELECT 
				other_user,
				interaction_count,
				last_interaction,
				LEAST(100, LOG(interaction_count + 1) * 25) as affinity_score
			FROM user_interactions
			WHERE other_user IS NOT NULL
			ORDER BY affinity_score DESC
			LIMIT 10
		`, [guildId, userId]);

		console.log(`\n🔹 Top relationships:`);
		if (relationshipQuery.rows.length > 0) {
			relationshipQuery.rows.forEach((rel, index) => {
				console.log(`   ${index + 1}. User ${rel.other_user}: ${Math.round(rel.affinity_score * 100) / 100} (${rel.interaction_count} interactions)`);
			});
		} else {
			console.log(`   - No relationships found`);
		}

		console.log(`\n🔹 Test completed successfully!`);
		console.log("=".repeat(60));

		client.release();
	} catch (error) {
		console.error("🔸 Test failed:", error);
		throw error;
	} finally {
		await pool.end();
		console.log("🔹 Disconnected from PostgreSQL");
	}
}

// Run the test
const userId = process.argv[2] || "354823920010002432";
testUserRelationshipNetwork(userId).catch(console.error);
