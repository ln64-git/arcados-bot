import { Pool } from "pg";

/**
 * Test script to build relationship network for a specific user using message data
 */

async function testUserRelationshipNetwork(userId) {
	console.log(`🔹 Building relationship network for user ${userId}`);
	console.log("=".repeat(60));

	// Direct database connection
	const pool = new Pool({
		connectionString: process.env.POSTGRES_URL || "postgresql://localhost:5432/arcados",
	});

	try {
		const client = await pool.connect();
		console.log("🔹 Connected to PostgreSQL database");

		// Check if user has messages
		console.log(`\n🔹 Checking if user ${userId} has messages...`);
		const userMessagesQuery = await client.query(`
			SELECT COUNT(*) as count, guild_id 
			FROM messages 
			WHERE author_id = $1
			GROUP BY guild_id
		`, [userId]);

		if (userMessagesQuery.rows.length === 0) {
			console.log(`🔸 User ${userId} has no messages`);
			return;
		}

		console.log(`✅ Found user messages:`);
		userMessagesQuery.rows.forEach((row) => {
			console.log(`   - Guild: ${row.guild_id} (${row.count} messages)`);
		});

		// Use the first guild
		const guildId = userMessagesQuery.rows[0].guild_id;
		console.log(`\n🔹 Testing with guild ${guildId}...`);

		// Get all unique authors in this guild
		console.log(`\n🔹 Getting all users in guild...`);
		const allUsersQuery = await client.query(`
			SELECT DISTINCT author_id, COUNT(*) as message_count
			FROM messages 
			WHERE guild_id = $1
			GROUP BY author_id
			ORDER BY message_count DESC
		`, [guildId]);
		
		console.log(`🔹 Found ${allUsersQuery.rows.length} users in guild`);

		// Build relationship network using relative percentages
		console.log(`\n🔹 Building relationship network...`);
		const startTime = Date.now();
		
		const rawInteractions = [];
		let totalInteractionPoints = 0;
		
		for (const otherUser of allUsersQuery.rows) {
			if (otherUser.author_id === userId) continue; // Skip self
			
			// Calculate interactions between this user and the other user
			const interactionsQuery = await client.query(`
				WITH user_messages AS (
					SELECT 
						m1.channel_id,
						m1.created_at as time1,
						m2.created_at as time2,
						m2.author_id as other_user,
						CASE 
							WHEN m1.content LIKE $3 THEN 2  -- Mention
							ELSE 1  -- Same channel interaction
						END as points
					FROM messages m1
					JOIN messages m2 ON m1.channel_id = m2.channel_id 
						AND m1.author_id != m2.author_id
						AND m2.created_at > m1.created_at
						AND m2.created_at <= m1.created_at + INTERVAL '5 minutes'
					WHERE m1.guild_id = $1 
						AND m1.author_id = $2
						AND m2.author_id = $4
				)
				SELECT 
					COUNT(*) as interaction_count,
					SUM(points) as total_points,
					MAX(time2) as last_interaction
				FROM user_messages
			`, [guildId, userId, `%<@${otherUser.author_id}>%`, otherUser.author_id]);
			
			const interaction = interactionsQuery.rows[0];
			if (interaction.interaction_count > 0) {
				const points = parseInt(interaction.total_points);
				totalInteractionPoints += points;
				
				rawInteractions.push({
					user_id: otherUser.author_id,
					points: points,
					interaction_count: parseInt(interaction.interaction_count),
					last_interaction: interaction.last_interaction,
				});
			}
		}
		
		// Calculate percentages
		const relationships = rawInteractions.map(raw => ({
			user_id: raw.user_id,
			affinity_percentage: totalInteractionPoints > 0 ? (raw.points / totalInteractionPoints) * 100 : 0,
			interaction_count: raw.interaction_count,
			last_interaction: raw.last_interaction,
			total_points: raw.points
		}));
		
		const duration = Date.now() - startTime;
		console.log(`✅ Relationship network built in ${duration}ms`);

		// Sort by percentage descending
		relationships.sort((a, b) => b.affinity_percentage - a.affinity_percentage);

		// Display results
		console.log(`\n🔹 Relationship Network Results:`);
		console.log(`   - Total relationships: ${relationships.length}`);
		
		if (relationships.length > 0) {
			console.log(`\n🔹 Top 10 Relationships:`);
			relationships.slice(0, 10).forEach((rel, index) => {
				const interactionInfo = rel.interaction_count ? ` (${rel.interaction_count} interactions, ${rel.total_points} points)` : "";
				const lastInteraction = rel.last_interaction 
					? ` - Last: ${rel.last_interaction.toISOString().split('T')[0]}` 
					: "";
				
				console.log(`   ${index + 1}. ${rel.user_id}: ${rel.affinity_percentage.toFixed(2)}%${interactionInfo}${lastInteraction}`);
			});
			
			// Show total percentage
			const totalPercentage = relationships.reduce((sum, rel) => sum + rel.affinity_percentage, 0);
			console.log(`\n🔹 Total percentage: ${totalPercentage.toFixed(2)}%`);
		} else {
			console.log(`   - No relationships found (user may not have interacted with others)`);
		}

		console.log(`\n🔹 Test completed successfully!`);
		console.log("=".repeat(60));

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
