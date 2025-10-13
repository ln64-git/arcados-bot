import { getRedisClient } from "../cache-management/RedisManager";
import { DatabaseCore } from "../database-manager/PostgresCore";
import { getEventQueue } from "../event-system/EventQueue";
import { memoryManager } from "./MemoryManager";

export interface HealthStatus {
	status: "healthy" | "degraded" | "unhealthy";
	timestamp: Date;
	uptime: number;
	memory: {
		heapUsed: number;
		heapTotal: number;
		rss: number;
		healthy: boolean;
	};
	services: {
		database: boolean;
		redis: boolean;
		eventQueue: boolean;
	};
	performance: {
		eventProcessingTime: number;
		databaseQueryTime: number;
		redisOperationTime: number;
		commandExecutionTime: number;
	};
	errors: string[];
}

export class HealthChecker {
	private static instance: HealthChecker;
	private startTime: Date;
	private errorCount = 0;

	private constructor() {
		this.startTime = new Date();
	}

	static getInstance(): HealthChecker {
		if (!HealthChecker.instance) {
			HealthChecker.instance = new HealthChecker();
		}
		return HealthChecker.instance;
	}

	async checkHealth(): Promise<HealthStatus> {
		const errors: string[] = [];
		const uptime = Date.now() - this.startTime.getTime();

		// Check memory health
		const memStats = memoryManager.getCurrentMemoryUsage();
		const memoryHealthy = memoryManager.isHealthy();

		// Check database connection
		let databaseHealthy = false;
		try {
			// TODO: Update to use PostgreSQL - temporarily disabled
			const db = null as any;
			await db.admin().ping();
			databaseHealthy = true;
		} catch (error) {
			errors.push(`Database: ${error}`);
		}

		// Check Redis connection
		let redisHealthy = false;
		try {
			const redis = await getRedisClient();
			await redis.ping();
			redisHealthy = true;
		} catch (error) {
			errors.push(`Redis: ${error}`);
		}

		// Check event queue
		const eventQueue = getEventQueue();
		const queueStats = eventQueue.getStats();
		const eventQueueHealthy = queueStats.queueLength < 100; // Consider unhealthy if queue is too long

		if (!eventQueueHealthy) {
			errors.push(`Event queue overloaded: ${queueStats.queueLength} events`);
		}

		// Get performance metrics
		const performance = memoryManager.getAveragePerformanceMetrics();

		// Determine overall status
		let status: "healthy" | "degraded" | "unhealthy" = "healthy";

		if (errors.length > 0) {
			status = errors.length > 3 ? "unhealthy" : "degraded";
		}

		if (!memoryHealthy) {
			status = "unhealthy";
		}

		// Track errors
		if (errors.length > 0) {
			this.errorCount++;
		} else {
			this.errorCount = Math.max(0, this.errorCount - 1);
		}

		return {
			status,
			timestamp: new Date(),
			uptime,
			memory: {
				heapUsed: memStats?.heapUsed || 0,
				heapTotal: memStats?.heapTotal || 0,
				rss: memStats?.rss || 0,
				healthy: memoryHealthy,
			},
			services: {
				database: databaseHealthy,
				redis: redisHealthy,
				eventQueue: eventQueueHealthy,
			},
			performance: {
				eventProcessingTime: performance.eventProcessingTime || 0,
				databaseQueryTime: performance.databaseQueryTime || 0,
				redisOperationTime: performance.redisOperationTime || 0,
				commandExecutionTime: performance.commandExecutionTime || 0,
			},
			errors,
		};
	}

	// Get a simple health status for quick checks
	async isHealthy(): Promise<boolean> {
		const health = await this.checkHealth();
		return health.status === "healthy";
	}

	// Get detailed health report
	async getDetailedReport(): Promise<string> {
		const health = await this.checkHealth();

		const memUsedMB = (health.memory.heapUsed / 1024 / 1024).toFixed(2);
		const memTotalMB = (health.memory.heapTotal / 1024 / 1024).toFixed(2);
		const rssMB = (health.memory.rss / 1024 / 1024).toFixed(2);
		const uptimeHours = (health.uptime / 1000 / 60 / 60).toFixed(2);

		let report = `🔹 Health Status: ${health.status.toUpperCase()}\n`;
		report += `🔹 Uptime: ${uptimeHours}h\n`;
		report += `🔹 Memory: ${memUsedMB}MB/${memTotalMB}MB (RSS: ${rssMB}MB)\n`;
		report += `🔹 Services: DB=${health.services.database ? "✅" : "❌"} Redis=${health.services.redis ? "✅" : "❌"} Queue=${health.services.eventQueue ? "✅" : "❌"}\n`;

		if (health.performance.eventProcessingTime > 0) {
			report += `🔹 Performance: Event=${health.performance.eventProcessingTime.toFixed(2)}ms DB=${health.performance.databaseQueryTime.toFixed(2)}ms Redis=${health.performance.redisOperationTime.toFixed(2)}ms Cmd=${health.performance.commandExecutionTime.toFixed(2)}ms\n`;
		}

		if (health.errors.length > 0) {
			report += `🔸 Errors: ${health.errors.join(", ")}\n`;
		}

		return report;
	}

	// Reset error count
	resetErrorCount(): void {
		this.errorCount = 0;
	}

	// Get error count
	getErrorCount(): number {
		return this.errorCount;
	}
}

// Export singleton instance
export const healthChecker = HealthChecker.getInstance();
