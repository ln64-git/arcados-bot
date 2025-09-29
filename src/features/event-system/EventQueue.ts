import type {
	GuildMember,
	Message,
	MessageReaction,
	PartialMessage,
	PartialMessageReaction,
	PartialUser,
	User,
	VoiceState,
} from "discord.js";
import { EventEmitter } from "events";

export interface QueuedEvent {
	id: string;
	type: string;
	data: unknown;
	timestamp: Date;
	retries: number;
}

export class EventQueue extends EventEmitter {
	private queue: QueuedEvent[] = [];
	private processing = false;
	private maxRetries = 3;
	private processingInterval = 100; // Process every 100ms
	private maxQueueSize = 1000;
	private intervalId: NodeJS.Timeout | null = null;

	constructor() {
		super();
		this.startProcessing();
	}

	private startProcessing(): void {
		if (this.intervalId) return;

		this.intervalId = setInterval(() => {
			this.processQueue();
		}, this.processingInterval);
	}

	private stopProcessing(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private generateEventId(): string {
		return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	enqueue(type: string, data: unknown): void {
		// Prevent queue overflow
		if (this.queue.length >= this.maxQueueSize) {
			console.warn("🔸 Event queue full, dropping oldest events");
			this.queue.shift(); // Remove oldest event
		}

		const event: QueuedEvent = {
			id: this.generateEventId(),
			type,
			data,
			timestamp: new Date(),
			retries: 0,
		};

		this.queue.push(event);
		this.emit("queued", event);
	}

	private async processQueue(): Promise<void> {
		if (this.processing || this.queue.length === 0) return;

		this.processing = true;

		try {
			// Process up to 10 events per batch
			const batchSize = Math.min(10, this.queue.length);
			const eventsToProcess = this.queue.splice(0, batchSize);

			await Promise.allSettled(
				eventsToProcess.map((event) => this.processEvent(event)),
			);
		} catch (error) {
			console.error("🔸 Error processing event queue:", error);
		} finally {
			this.processing = false;
		}
	}

	private async processEvent(event: QueuedEvent): Promise<void> {
		try {
			this.emit(event.type, event.data);
			this.emit("processed", event);
		} catch (error) {
			console.error(`🔸 Error processing event ${event.type}:`, error);

			event.retries++;

			if (event.retries < this.maxRetries) {
				// Re-queue with exponential backoff
				const delay = 2 ** event.retries * 1000;
				setTimeout(() => {
					this.queue.push(event);
				}, delay);
			} else {
				console.error(
					`🔸 Event ${event.id} failed after ${this.maxRetries} retries`,
				);
				this.emit("failed", event, error);
			}
		}
	}

	// Convenience methods for common Discord events
	enqueueMessage(message: Message): void {
		this.enqueue("messageCreate", message);
	}

	enqueueMessageUpdate(
		oldMessage: Message | PartialMessage,
		newMessage: Message | PartialMessage,
	): void {
		this.enqueue("messageUpdate", { oldMessage, newMessage });
	}

	enqueueMessageDelete(message: Message | PartialMessage): void {
		this.enqueue("messageDelete", message);
	}

	enqueueReactionAdd(
		reaction: MessageReaction | PartialMessageReaction,
		user: User | PartialUser,
	): void {
		this.enqueue("messageReactionAdd", { reaction, user });
	}

	enqueueReactionRemove(
		reaction: MessageReaction | PartialMessageReaction,
		user: User | PartialUser,
	): void {
		this.enqueue("messageReactionRemove", { reaction, user });
	}

	enqueueVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
		this.enqueue("voiceStateUpdate", { oldState, newState });
	}

	enqueueGuildMemberUpdate(
		oldMember: GuildMember | Partial<GuildMember>,
		newMember: GuildMember,
	): void {
		this.enqueue("guildMemberUpdate", { oldMember, newMember });
	}

	// Queue statistics
	getStats(): {
		queueLength: number;
		processing: boolean;
		processedCount: number;
		failedCount: number;
	} {
		return {
			queueLength: this.queue.length,
			processing: this.processing,
			processedCount: 0, // Would need to track this
			failedCount: 0, // Would need to track this
		};
	}

	// Cleanup
	destroy(): void {
		this.stopProcessing();
		this.queue = [];
		this.removeAllListeners();
	}
}

// Singleton instance
let eventQueue: EventQueue | null = null;

export function getEventQueue(): EventQueue {
	if (!eventQueue) {
		eventQueue = new EventQueue();
	}
	return eventQueue;
}

// Graceful shutdown
process.on("SIGINT", () => {
	if (eventQueue) {
		eventQueue.destroy();
	}
});

process.on("SIGTERM", () => {
	if (eventQueue) {
		eventQueue.destroy();
	}
});
