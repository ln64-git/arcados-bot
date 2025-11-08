import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { EmbeddingService } from "../features/embeddings/EmbeddingService.js";

async function generateEmbeddings() {
	const guildId = process.argv[2];

	if (!guildId) {
		console.error("🔸 Usage: npx tsx src/scripts/generate-embeddings.ts <guild_id>");
		process.exit(1);
	}

	console.log(`🔹 Generating embeddings for guild: ${guildId}`);

	const db = new PostgreSQLManager();
	const embeddingService = EmbeddingService.getInstance();

	try {
		await db.connect();

		let totalProcessed = 0;
		let offset = 0;
		const batchSize = 100;

		while (true) {
			console.log(
				`🔹 Fetching batch of ${batchSize} messages (offset: ${offset})...`
			);

			const result = await db.getMessagesForEmbedding(
				guildId,
				batchSize,
				offset
			);

			if (!result.success || !result.data) {
				console.error("🔸 Failed to fetch messages:", result.error);
				break;
			}

			const messages = result.data;

			if (messages.length === 0) {
				console.log("🔹 No more messages to process");
				break;
			}

			console.log(
				`🔹 Generating embeddings for ${messages.length} messages...`
			);

			try {
				const texts = messages.map((m) => m.content);
				const embeddings = await embeddingService.generateBatch(texts);

				if (embeddings.length !== messages.length) {
					console.error(
						`🔸 Mismatch: ${messages.length} messages but ${embeddings.length} embeddings`
					);
					break;
				}

				const updates = messages.map((msg, idx) => ({
					messageId: msg.id,
					embedding: embeddings[idx]!,
				})).filter(u => u.embedding !== undefined);

				console.log(`🔹 Updating database with ${updates.length} embeddings...`);

				const updateResult = await db.updateMessageEmbeddingsBatch(updates as { messageId: string; embedding: number[]; }[]);

				if (!updateResult.success) {
					console.error(
						"🔸 Failed to update embeddings:",
						updateResult.error
					);
					break;
				}

				totalProcessed += messages.length;
				console.log(
					`🔹 Processed ${totalProcessed} messages (${messages.length} in this batch)`
				);

				if (messages.length < batchSize) {
					// Last batch
					break;
				}

				offset += batchSize;

				// Small delay to avoid overwhelming the system
				await new Promise((resolve) => setTimeout(resolve, 100));
			} catch (error) {
				console.error("🔸 Error processing batch:", error);
				console.log("🔹 Continuing with next batch...");
				offset += batchSize;
				continue;
			}
		}

		console.log(`🔹 Finished! Total messages processed: ${totalProcessed}`);
	} catch (error) {
		console.error("🔸 Fatal error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

generateEmbeddings().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});
