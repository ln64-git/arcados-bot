const { Surreal } = require("surrealdb");
require("dotenv").config();

async function testConnection() {
    console.log("🔹 Testing SurrealDB Cloud connection...");
    console.log(`SURREAL_URL: ${process.env.SURREAL_URL}`);
    console.log(`SURREAL_NAMESPACE: ${process.env.SURREAL_NAMESPACE}`);
    console.log(`SURREAL_DATABASE: ${process.env.SURREAL_DATABASE}`);
    
    const db = new Surreal();
    
    try {
        console.log("🔹 Connecting to SurrealDB Cloud...");
        await db.connect(process.env.SURREAL_URL);
        
        console.log("🔹 Authenticating...");
        if (process.env.SURREAL_TOKEN) {
            await db.authenticate(process.env.SURREAL_TOKEN);
        } else {
            await db.signin({
                username: process.env.SURREAL_USERNAME,
                password: process.env.SURREAL_PASSWORD,
            });
        }
        
        console.log("🔹 Setting namespace and database...");
        await db.use(process.env.SURREAL_NAMESPACE, process.env.SURREAL_DATABASE);
        
        console.log("🔹 Querying messages...");
        const messages = await db.select("messages");
        console.log(`✅ Found ${messages.length} total messages`);
        
        const userId = "99195129516007424";
        const userMessages = messages.filter(msg => msg.author_id === userId);
        console.log(`✅ Found ${userMessages.length} messages from user ${userId}`);
        
        if (userMessages.length > 0) {
            userMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            
            console.log("\n🔹 Earliest 5 messages from this user:");
            console.log("=" .repeat(80));
            
            const earliest = userMessages.slice(0, 5);
            earliest.forEach((msg, i) => {
                console.log(`${i + 1}. [${new Date(msg.timestamp).toLocaleString()}]`);
                console.log(`   Content: "${msg.content || '(No content)'}"`);
                console.log(`   Channel: ${msg.channel_id}`);
                console.log(`   Guild: ${msg.guild_id}`);
                console.log();
            });
            
            // Show summary
            const channels = [...new Set(userMessages.map(msg => msg.channel_id))];
            const guilds = [...new Set(userMessages.map(msg => msg.guild_id))];
            const oldestMessage = userMessages[0];
            const newestMessage = userMessages[userMessages.length - 1];
            
            console.log("🔹 User Activity Summary:");
            console.log(`   Total messages: ${userMessages.length}`);
            console.log(`   Channels: ${channels.length} (${channels.join(", ")})`);
            console.log(`   Guilds: ${guilds.length} (${guilds.join(", ")})`);
            console.log(`   Date range: ${new Date(oldestMessage.timestamp).toLocaleString()} to ${new Date(newestMessage.timestamp).toLocaleString()}`);
        } else {
            console.log("🔹 No messages found for this user");
        }
        
    } catch (error) {
        console.error("❌ Error:", error.message);
        console.log("\n🔹 Troubleshooting tips:");
        console.log("   1. Check your .env file has correct SurrealDB Cloud credentials");
        console.log("   2. Verify SURREAL_URL starts with wss://");
        console.log("   3. Ensure your SurrealDB Cloud instance is running");
    } finally {
        console.log("\n🔹 Closing connection...");
        await db.close();
        console.log("✅ Done!");
    }
}

testConnection().catch(console.error);
