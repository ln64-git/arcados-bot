import { MongoClient } from "mongodb";
import { getDatabase } from "../features/database-manager/DatabaseConnection";

export interface UserPreference {
	userId: string;
	guildId: string;
	preferredChannelName?: string;
	channelLimit?: number;
	isPrivate?: boolean;
	lastUpdated?: Date;
}

export class PollingPreferenceWatcher {
	private lastSeenIds = new Set<string>();
	private isWatching = false;
	private pollInterval = 2000; // Poll every 2 seconds

	async startWatching(): Promise<void> {
		if (this.isWatching) {
			console.log("⚠️  Already watching preferences!");
			return;
		}

		console.log("👀 Starting to watch user preferences (polling mode)...");
		console.log("Press Ctrl+C to stop watching\n");

		const db = await getDatabase();
		const collection = db.collection("userPreferences");

		// Show initial count and populate lastSeenIds
		const initialDocs = await collection.find({}).toArray();
		console.log(
			`📊 Currently ${initialDocs.length} user preferences in database`,
		);

		// Add all existing document IDs to lastSeenIds
		initialDocs.forEach((doc) => {
			this.lastSeenIds.add(doc._id.toString());
		});

		console.log("🔍 Monitoring for changes...\n");

		this.isWatching = true;
		this.startPolling();
	}

	private async startPolling(): Promise<void> {
		const db = await getDatabase();
		const collection = db.collection("userPreferences");

		const poll = async (): Promise<void> => {
			if (!this.isWatching) return;

			try {
				// Get all documents
				const docs = await collection.find({}).toArray();
				const currentIds = new Set(docs.map((doc) => doc._id.toString()));

				// Check for new documents
				for (const doc of docs) {
					const docId = doc._id.toString();
					if (!this.lastSeenIds.has(docId)) {
						this.handleNewDocument(doc);
						this.lastSeenIds.add(docId);
					}
				}

				// Check for updated documents
				for (const doc of docs) {
					const docId = doc._id.toString();
					if (this.lastSeenIds.has(docId)) {
						// Check if this document was recently updated
						const now = new Date();
						const docTime = new Date(doc.lastUpdated || doc._id.getTimestamp());
						const timeDiff = now.getTime() - docTime.getTime();

						// If updated within last 5 seconds, it's likely a new update
						if (timeDiff < 5000 && doc.lastUpdated) {
							this.handleUpdatedDocument(doc);
						}
					}
				}

				// Check for deleted documents
				for (const docId of this.lastSeenIds) {
					if (!currentIds.has(docId)) {
						this.handleDeletedDocument(docId);
						this.lastSeenIds.delete(docId);
					}
				}
			} catch (error) {
				console.error("❌ Polling error:", error);
			}

			// Schedule next poll
			setTimeout(poll, this.pollInterval);
		};

		// Start polling
		poll();
	}

	private handleNewDocument(doc: UserPreference & { _id: any }): void {
		const timestamp = new Date().toLocaleTimeString();
		console.log(`[${timestamp}] ➕ NEW PREFERENCE CREATED`);
		this.displayPreference(doc);
		console.log("");
	}

	private handleUpdatedDocument(doc: UserPreference & { _id: any }): void {
		const timestamp = new Date().toLocaleTimeString();
		console.log(`[${timestamp}] 🔄 PREFERENCE UPDATED`);
		this.displayPreference(doc);
		console.log("");
	}

	private handleDeletedDocument(docId: string): void {
		const timestamp = new Date().toLocaleTimeString();
		console.log(`[${timestamp}] 🗑️  PREFERENCE DELETED`);
		console.log(`   Document ID: ${docId}`);
		console.log("");
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

	stopWatching(): void {
		this.isWatching = false;
		console.log("👋 Stopped watching preferences");
	}
}

// Export a singleton instance
export const pollingPreferenceWatcher = new PollingPreferenceWatcher();
