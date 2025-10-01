import { type ChangeStream, MongoClient } from "mongodb";
import { getDatabase } from "../features/database-manager/DatabaseConnection";

export interface UserPreference {
	userId: string;
	guildId: string;
	preferredChannelName?: string;
	channelLimit?: number;
	isPrivate?: boolean;
	lastUpdated?: Date;
}

export class PreferenceWatcher {
	private changeStream: ChangeStream | null = null;
	private isWatching = false;

	async startWatching(): Promise<void> {
		if (this.isWatching) {
			console.log("⚠️  Already watching preferences!");
			return;
		}

		try {
			console.log("👀 Starting to watch user preferences...");
			console.log("Press Ctrl+C to stop watching\n");

			const db = await getDatabase();
			const collection = db.collection("userPreferences");

			// Show initial count
			const count = await collection.countDocuments();
			console.log(`📊 Currently ${count} user preferences in database\n`);

			// Create change stream
			this.changeStream = collection.watch([], {
				fullDocument: "updateLookup",
			});

			this.isWatching = true;

			// Handle changes
			this.changeStream.on("change", (change) => {
				this.handleChange(change);
			});

			// Handle errors
			this.changeStream.on("error", (error) => {
				console.error("❌ Change stream error:", error);
			});
		} catch (error) {
			console.error("❌ Failed to start watching:", error);
		}
	}

	private handleChange(change: any): void {
		const timestamp = new Date().toLocaleTimeString();

		switch (change.operationType) {
			case "insert":
				console.log(`[${timestamp}] ➕ NEW PREFERENCE CREATED`);
				this.displayPreference(change.fullDocument);
				break;

			case "update":
				console.log(`[${timestamp}] 🔄 PREFERENCE UPDATED`);
				this.displayPreference(change.fullDocument);
				break;

			case "delete":
				console.log(`[${timestamp}] 🗑️  PREFERENCE DELETED`);
				console.log(`   Document ID: ${change.documentKey._id}`);
				break;

			default:
				console.log(`[${timestamp}] ${change.operationType.toUpperCase()}`);
		}

		console.log(""); // Empty line for readability
	}

	private displayPreference(doc: UserPreference): void {
		console.log(`   User ID: ${doc.userId}`);
		console.log(`   Guild ID: ${doc.guildId}`);

		if (doc.preferredChannelName) {
			console.log(`   Preferred Name: "${doc.preferredChannelName}"`);
		}

		if (doc.lastUpdated) {
			const updateTime = new Date(doc.lastUpdated).toLocaleString();
			console.log(`   Last Updated: ${updateTime}`);
		}

		if (doc.channelLimit) {
			console.log(`   Channel Limit: ${doc.channelLimit}`);
		}

		if (doc.isPrivate !== undefined) {
			console.log(`   Private Channel: ${doc.isPrivate ? "Yes" : "No"}`);
		}
	}

	async stopWatching(): Promise<void> {
		if (this.changeStream) {
			await this.changeStream.close();
			this.changeStream = null;
		}
		this.isWatching = false;
		console.log("👋 Stopped watching preferences");
	}
}

// Export a singleton instance
export const preferenceWatcher = new PreferenceWatcher();
