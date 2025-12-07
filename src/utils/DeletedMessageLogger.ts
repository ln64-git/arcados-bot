/**
 * Deleted Message Logger
 *
 * Tracks deleted messages in a plain JSON file for archival purposes.
 * Captures essential information: content, sender, time, and attachments.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface DeletedMessage {
	messageId: string;
	content: string;
	sender: {
		id: string;
		username: string;
		displayName: string;
	};
	channel: {
		id: string;
		name: string;
	};
	timestamp: string; // ISO timestamp when message was created
	deletedAt: string; // ISO timestamp when message was deleted
	attachments: Array<{
		url: string;
		filename: string;
		size: number;
		contentType?: string;
	}>;
}

export class DeletedMessageLogger {
	private static instance: DeletedMessageLogger;
	private logPath: string;

	private constructor() {
		const logDir = path.join(process.cwd(), "log", "archive");
		this.logPath = path.join(logDir, "deleted-messages.jsonl");

		// Ensure directory exists
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}

		// Create file if it doesn't exist
		if (!fs.existsSync(this.logPath)) {
			fs.writeFileSync(
				this.logPath,
				"# Deleted Messages Archive\n# Each line is a JSON object representing a deleted message\n\n",
			);
		}
	}

	static getInstance(): DeletedMessageLogger {
		if (!DeletedMessageLogger.instance) {
			DeletedMessageLogger.instance = new DeletedMessageLogger();
		}
		return DeletedMessageLogger.instance;
	}

	/**
	 * Log a deleted message
	 */
	logDeletedMessage(messageData: DeletedMessage): void {
		try {
			// Append as JSON line
			const jsonLine = JSON.stringify(messageData) + "\n";
			fs.appendFileSync(this.logPath, jsonLine);

			// Also log to console with compact format
			const time = new Date(messageData.deletedAt).toLocaleTimeString();
			console.log(
				`🗑️  [${time}] ${messageData.sender.displayName}: "${messageData.content.substring(0, 50)}${messageData.content.length > 50 ? "..." : ""}"`,
			);
		} catch (error) {
			console.error("🔸 Failed to log deleted message:", error);
		}
	}

	/**
	 * Get path to deleted messages file
	 */
	getLogPath(): string {
		return this.logPath;
	}

	/**
	 * Read all deleted messages (for analysis)
	 */
	readDeletedMessages(limit?: number): DeletedMessage[] {
		try {
			const content = fs.readFileSync(this.logPath, "utf-8");
			const lines = content
				.split("\n")
				.filter((line) => line.trim() && !line.startsWith("#"));

			const messages = lines
				.map((line) => {
					try {
						return JSON.parse(line) as DeletedMessage;
					} catch {
						return null;
					}
				})
				.filter((msg): msg is DeletedMessage => msg !== null);

			if (limit) {
				return messages.slice(-limit); // Return most recent N messages
			}

			return messages;
		} catch (error) {
			console.error("🔸 Failed to read deleted messages:", error);
			return [];
		}
	}

	/**
	 * Get statistics about deleted messages
	 */
	getStats(): {
		total: number;
		withAttachments: number;
		uniqueSenders: number;
	} {
		const messages = this.readDeletedMessages();
		const uniqueSenders = new Set(messages.map((msg) => msg.sender.id));

		return {
			total: messages.length,
			withAttachments: messages.filter((msg) => msg.attachments.length > 0)
				.length,
			uniqueSenders: uniqueSenders.size,
		};
	}
}
