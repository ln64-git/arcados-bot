import type { Message } from "discord.js";
import { getEventQueue } from "../event-system/EventQueue";
import { healthChecker } from "./HealthChecker";
import { memoryManager } from "./MemoryManager";

export class PerformanceTest {
	private static instance: PerformanceTest;
	private testResults: Array<{
		test: string;
		duration: number;
		success: boolean;
		error?: string;
	}> = [];

	private constructor() {}

	static getInstance(): PerformanceTest {
		if (!PerformanceTest.instance) {
			PerformanceTest.instance = new PerformanceTest();
		}
		return PerformanceTest.instance;
	}

	async runAllTests(): Promise<void> {
		await this.testMemoryManager();
		await this.testEventQueue();
		await this.testHealthChecker();

		this.logResults();
	}

	private async testMemoryManager(): Promise<void> {
		const testName = "Memory Manager";
		const startTime = memoryManager.startTimer();

		try {
			// Test memory collection
			memoryManager.collectMemoryStats();

			// Test performance recording
			memoryManager.recordEventProcessingTime(10);
			memoryManager.recordDatabaseQueryTime(50);
			memoryManager.recordRedisOperationTime(5);
			memoryManager.recordCommandExecutionTime(100);

			// Test health check
			memoryManager.isHealthy();

			const duration = memoryManager.endTimer(startTime);
			this.testResults.push({
				test: testName,
				duration,
				success: true,
			});

			console.log(`✅ ${testName}: ${duration.toFixed(2)}ms`);
		} catch (error) {
			const duration = memoryManager.endTimer(startTime);
			this.testResults.push({
				test: testName,
				duration,
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});

			console.log(`❌ ${testName}: ${duration.toFixed(2)}ms - ${error}`);
		}
	}

	private async testEventQueue(): Promise<void> {
		const testName = "Event Queue";
		const startTime = memoryManager.startTimer();

		try {
			const eventQueue = getEventQueue();

			// Test event enqueueing
			eventQueue.enqueue("test", { message: "test" });
			eventQueue.enqueueMessage({} as unknown as Message);
			eventQueue.enqueueMessageUpdate(
				{} as unknown as Message,
				{} as unknown as Message,
			);

			// Test stats
			const stats = eventQueue.getStats();

			const duration = memoryManager.endTimer(startTime);
			this.testResults.push({
				test: testName,
				duration,
				success: true,
			});

			console.log(
				`✅ ${testName}: ${duration.toFixed(2)}ms (Queue: ${stats.queueLength})`,
			);
		} catch (error) {
			const duration = memoryManager.endTimer(startTime);
			this.testResults.push({
				test: testName,
				duration,
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});

			console.log(`❌ ${testName}: ${duration.toFixed(2)}ms - ${error}`);
		}
	}

	private async testHealthChecker(): Promise<void> {
		const testName = "Health Checker";
		const startTime = memoryManager.startTimer();

		try {
			// Test health check
			await healthChecker.isHealthy();

			// Test detailed report
			await healthChecker.getDetailedReport();

			const duration = memoryManager.endTimer(startTime);
			this.testResults.push({
				test: testName,
				duration,
				success: true,
			});

			console.log(`✅ ${testName}: ${duration.toFixed(2)}ms`);
		} catch (error) {
			const duration = memoryManager.endTimer(startTime);
			this.testResults.push({
				test: testName,
				duration,
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});

			console.log(`❌ ${testName}: ${duration.toFixed(2)}ms - ${error}`);
		}
	}

	private logResults(): void {
		console.log("\n🔹 Performance Test Results:");
		console.log("=".repeat(50));

		const successful = this.testResults.filter((r) => r.success);
		const failed = this.testResults.filter((r) => !r.success);

		console.log(`✅ Successful: ${successful.length}`);
		console.log(`❌ Failed: ${failed.length}`);

		if (successful.length > 0) {
			const avgDuration =
				successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
			console.log(`⏱️  Average Duration: ${avgDuration.toFixed(2)}ms`);
		}

		if (failed.length > 0) {
			console.log("\n🔸 Failed Tests:");
			failed.forEach((result) => {
				console.log(`  - ${result.test}: ${result.error}`);
			});
		}

		console.log("=".repeat(50));
	}

	getResults() {
		return this.testResults;
	}
}

// Export singleton instance
export const performanceTest = PerformanceTest.getInstance();
