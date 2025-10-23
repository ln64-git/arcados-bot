import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL || "postgresql://localhost:5432/arcados",
});

async function generateAllRelationshipNetworks() {
    console.log('🔹 Generating relationship networks for ALL users');
    console.log("=".repeat(60));

    const client = await pool.connect();
    
    try {
        console.log('🔹 Connected to PostgreSQL database');
        
        const guildId = process.env.GUILD_ID || '1254694808228986912';
        
        // Get all unique users from messages
        console.log('\n🔹 Getting all users from messages...');
        const usersQuery = await client.query(`
            SELECT DISTINCT author_id, COUNT(*) as message_count
            FROM messages 
            WHERE guild_id = $1
            GROUP BY author_id
            ORDER BY message_count DESC
        `, [guildId]);
        
        console.log(`✅ Found ${usersQuery.rows.length} users with messages`);
        
        let processedCount = 0;
        let successCount = 0;
        let errorCount = 0;
        
        console.log('\n🔹 Processing users...');
        
        for (const user of usersQuery.rows) {
            const userId = user.author_id;
            processedCount++;
            
            try {
                console.log(`\n🔹 [${processedCount}/${usersQuery.rows.length}] Processing user ${userId} (${user.message_count} messages)...`);
                
                // Get all unique authors in this guild
                const allUsersQuery = await client.query(`
                    SELECT DISTINCT author_id, COUNT(*) as message_count
                    FROM messages 
                    WHERE guild_id = $1
                    GROUP BY author_id
                    ORDER BY message_count DESC
                `, [guildId]);
                
                // Calculate total interaction points for this user across all other users
                let totalInteractionPoints = 0;
                const rawInteractions = [];
                
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
                }));
                
                // Sort by percentage descending and keep top 50
                relationships.sort((a, b) => b.affinity_percentage - a.affinity_percentage);
                const topRelationships = relationships.slice(0, 50);
                
                // Update the database with the relationship network
                const updateResult = await client.query(`
                    UPDATE members 
                    SET relationship_network = $1, updated_at = NOW()
                    WHERE user_id = $2 AND guild_id = $3
                `, [JSON.stringify(topRelationships), userId, guildId]);
                
                if (updateResult.rowCount === 0) {
                    // User doesn't exist in members table, insert them
                    await client.query(`
                        INSERT INTO members (
                            id, guild_id, user_id, username, display_name, 
                            discriminator, relationship_network, active, created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW()
                        )
                    `, [
                        `${guildId}-${userId}`,
                        guildId,
                        userId,
                        `user_${userId}`,
                        `User ${userId}`,
                        '0000',
                        JSON.stringify(topRelationships)
                    ]);
                }
                
                successCount++;
                console.log(`✅ User ${userId}: ${topRelationships.length} relationships (${totalInteractionPoints} total points)`);
                
                // Show top 3 relationships
                if (topRelationships.length > 0) {
                    console.log(`   Top relationships:`);
                    topRelationships.slice(0, 3).forEach((rel, index) => {
                        console.log(`     ${index + 1}. ${rel.user_id}: ${rel.affinity_percentage.toFixed(2)}%`);
                    });
                }
                
            } catch (error) {
                console.error(`🔸 Error processing user ${userId}: ${error.message}`);
                errorCount++;
            }
        }
        
        console.log('\n🔹 Generation completed!');
        console.log(`   - Total users processed: ${processedCount}`);
        console.log(`   - Successful: ${successCount}`);
        console.log(`   - Errors: ${errorCount}`);
        
        // Final count check
        const finalCount = await client.query('SELECT COUNT(*) FROM members WHERE relationship_network IS NOT NULL AND jsonb_array_length(relationship_network) > 0');
        console.log(`   - Final members with networks: ${finalCount.rows[0].count}`);
        
        console.log("=".repeat(60));
        
    } catch (error) {
        console.error('🔸 Fatal error during relationship network generation:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('🔹 Disconnected from PostgreSQL');
    }
}

generateAllRelationshipNetworks().catch(console.error);
