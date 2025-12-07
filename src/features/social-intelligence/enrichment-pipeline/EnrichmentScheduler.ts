/**
 * EnrichmentScheduler
 *
 * Schedules periodic enrichment jobs using node-cron.
 * Runs enrichment pipeline at regular intervals:
 * - Conversations: daily
 * - User profiles: weekly
 * - Guild summaries: monthly
 */

import cron from "node-cron";
import { EnrichmentPipelineOrchestrator } from "./EnrichmentPipelineOrchestrator";

export class EnrichmentScheduler {
	private static instance: EnrichmentScheduler;
	private orchestrator: EnrichmentPipelineOrchestrator;
	private jobs: cron.ScheduledTask[] = [];

	private constructor() {
		this.orchestrator = EnrichmentPipelineOrchestrator.getInstance();
	}

	public static getInstance(): EnrichmentScheduler {
		if (!EnrichmentScheduler.instance) {
			EnrichmentScheduler.instance = new EnrichmentScheduler();
		}
		return EnrichmentScheduler.instance;
	}

	/**
	 * Start the enrichment scheduler
	 */
	public async start() {
		// Daily at 2 AM: Process conversation enrichments
		this.jobs.push(
			cron.schedule("0 2 * * *", async () => {
				console.log("⏰ Running scheduled conversation enrichments");
				try {
					await this.orchestrator.processPendingEnrichments(10);
				} catch (error) {
					console.error("❌ Error in scheduled conversation enrichment:", error);
				}
			}),
		);

		// Every Monday at 3 AM: Process user profile enrichments (weekly)
		this.jobs.push(
			cron.schedule("0 3 * * 1", async () => {
				console.log("⏰ Running scheduled user profile enrichments");
				try {
					await this.orchestrator.processPendingEnrichments(10);
				} catch (error) {
					console.error("❌ Error in scheduled user profile enrichment:", error);
				}
			}),
		);

		// First day of each month at 4 AM: Process guild summaries
		this.jobs.push(
			cron.schedule("0 4 1 * *", async () => {
				console.log("⏰ Running scheduled guild summary enrichments");
				try {
					await this.orchestrator.processPendingEnrichments(5);
				} catch (error) {
					console.error("❌ Error in scheduled guild enrichment:", error);
				}
			}),
		);
	}

	/**
	 * Stop the enrichment scheduler
	 */
	public stop() {
		for (const job of this.jobs) {
			job.stop();
		}
		this.jobs = [];
		console.log("⏸️  Enrichment scheduler stopped");
	}
}

