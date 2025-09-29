import { performance } from "perf_hooks";

export interface MemoryStats {
	heapUsed: number;
	heapTotal: number;
	external: number;
	rss: number;
	arrayBuffers: number;
	timestamp: Date;
}

export interface PerformanceMetrics {
	eventProcessingTime: number;
	databaseQueryTime: number;
	redisOperationTime: number;
	commandExecutionTime: number;
}

export class MemoryManager {
	private static instance: MemoryManager;
	private memoryStats: MemoryStats[] = [];
	private performanceMetrics: PerformanceMetrics[] = [];
	private maxStatsHistory = 100;
	private cleanupInterval: NodeJS.Timeout | null = null;
	private isMonitoring = false;

	private constructor() {
		this.startMonitoring();
	}

	static getInstance(): MemoryManager {
		if (!MemoryManager.instance) {
			MemoryManager.instance = new MemoryManager();
		}
		return MemoryManager.instance;
	}

	private startMonitoring(): void {
		if (this.isMonitoring) return;

		this.isMonitoring = true;

		// Monitor memory every 30 seconds
		this.cleanupInterval = setInterval(() => {
			this.collectMemoryStats();
			this.performCleanup();
		}, 30000);

		// Log memory stats every 5 minutes
		setInterval(() => {
			this.logMemoryStats();
		}, 300000);
	}

	public collectMemoryStats(): void {
		const memUsage = process.memoryUsage();
		const stats: MemoryStats = {
			heapUsed: memUsage.heapUsed,
			heapTotal: memUsage.heapTotal,
			external: memUsage.external,
			rss: memUsage.rss,
			arrayBuffers: memUsage.arrayBuffers,
			timestamp: new Date(),
		};

		this.memoryStats.push(stats);

		// Keep only recent stats
		if (this.memoryStats.length > this.maxStatsHistory) {
			this.memoryStats.shift();
		}
	}

	private performCleanup(): void {
		const memUsage = process.memoryUsage();
		const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

		// Trigger garbage collection if heap usage is high
		if (heapUsedMB > 100) {
			// 100MB threshold
			if (global.gc) {
				global.gc();
			}
		}

		// Clean up old performance metrics
		if (this.performanceMetrics.length > this.maxStatsHistory) {
			this.performanceMetrics.shift();
		}
	}

	private logMemoryStats(): void {
		// Memory stats logging disabled for cleaner output
	}

	// Performance tracking methods
	startTimer(): number {
		return performance.now();
	}

	endTimer(startTime: number): number {
		return performance.now() - startTime;
	}

	recordEventProcessingTime(time: number): void {
		this.performanceMetrics.push({
			eventProcessingTime: time,
			databaseQueryTime: 0,
			redisOperationTime: 0,
			commandExecutionTime: 0,
		});
	}

	recordDatabaseQueryTime(time: number): void {
		this.performanceMetrics.push({
			eventProcessingTime: 0,
			databaseQueryTime: time,
			redisOperationTime: 0,
			commandExecutionTime: 0,
		});
	}

	recordRedisOperationTime(time: number): void {
		this.performanceMetrics.push({
			eventProcessingTime: 0,
			databaseQueryTime: 0,
			redisOperationTime: time,
			commandExecutionTime: 0,
		});
	}

	recordCommandExecutionTime(time: number): void {
		this.performanceMetrics.push({
			eventProcessingTime: 0,
			databaseQueryTime: 0,
			redisOperationTime: 0,
			commandExecutionTime: time,
		});
	}

	// Get current memory usage
	getCurrentMemoryUsage(): MemoryStats | null {
		return this.memoryStats[this.memoryStats.length - 1] || null;
	}

	// Get average performance metrics
	getAveragePerformanceMetrics(): Partial<PerformanceMetrics> {
		if (this.performanceMetrics.length === 0) {
			return {};
		}

		const totals = this.performanceMetrics.reduce(
			(acc, metrics) => ({
				eventProcessingTime:
					acc.eventProcessingTime + metrics.eventProcessingTime,
				databaseQueryTime: acc.databaseQueryTime + metrics.databaseQueryTime,
				redisOperationTime: acc.redisOperationTime + metrics.redisOperationTime,
				commandExecutionTime:
					acc.commandExecutionTime + metrics.commandExecutionTime,
			}),
			{
				eventProcessingTime: 0,
				databaseQueryTime: 0,
				redisOperationTime: 0,
				commandExecutionTime: 0,
			},
		);

		const count = this.performanceMetrics.length;
		return {
			eventProcessingTime: totals.eventProcessingTime / count,
			databaseQueryTime: totals.databaseQueryTime / count,
			redisOperationTime: totals.redisOperationTime / count,
			commandExecutionTime: totals.commandExecutionTime / count,
		};
	}

	// Health check
	isHealthy(): boolean {
		const current = this.getCurrentMemoryUsage();
		if (!current) return true;

		const heapUsedMB = current.heapUsed / 1024 / 1024;
		const rssMB = current.rss / 1024 / 1024;

		// Consider unhealthy if heap > 200MB or RSS > 500MB
		return heapUsedMB < 200 && rssMB < 500;
	}

	// Cleanup
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.isMonitoring = false;
		this.memoryStats = [];
		this.performanceMetrics = [];
	}
}

// Export singleton instance
export const memoryManager = MemoryManager.getInstance();

// Graceful shutdown
process.on("SIGINT", () => {
	memoryManager.destroy();
});

process.on("SIGTERM", () => {
	memoryManager.destroy();
});
