import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import { healthChecker } from "../features/performance-monitoring/HealthChecker";
import { memoryManager } from "../features/performance-monitoring/MemoryManager";
import type { Command } from "../types";
import { getCommandStats } from "../utils/loadCommands";

export const healthCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("health")
		.setDescription("Check bot health and performance metrics")
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription("Type of health check to perform")
				.setRequired(false)
				.addChoices(
					{ name: "Quick", value: "quick" },
					{ name: "Detailed", value: "detailed" },
					{ name: "Memory", value: "memory" },
					{ name: "Performance", value: "performance" },
				),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const type = interaction.options.getString("type") || "quick";

		await interaction.deferReply({ ephemeral: true });

		try {
			switch (type) {
				case "quick": {
					const isHealthy = await healthChecker.isHealthy();
					const embed = new EmbedBuilder()
						.setTitle("🔹 Bot Health Check")
						.setDescription(
							isHealthy ? "✅ Bot is healthy" : "❌ Bot has issues",
						)
						.setColor(isHealthy ? 0x00ff00 : 0xff0000)
						.setTimestamp();

					await interaction.editReply({ embeds: [embed] });
					break;
				}

				case "detailed": {
					const health = await healthChecker.checkHealth();
					const report = await healthChecker.getDetailedReport();

					const embed = new EmbedBuilder()
						.setTitle("🔹 Detailed Health Report")
						.setDescription(`\`\`\`\n${report}\`\`\``)
						.setColor(
							health.status === "healthy"
								? 0x00ff00
								: health.status === "degraded"
									? 0xffaa00
									: 0xff0000,
						)
						.addFields(
							{
								name: "Status",
								value: health.status.toUpperCase(),
								inline: true,
							},
							{
								name: "Uptime",
								value: `${(health.uptime / 1000 / 60 / 60).toFixed(2)}h`,
								inline: true,
							},
							{
								name: "Memory",
								value: `${(health.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
								inline: true,
							},
						)
						.setTimestamp();

					await interaction.editReply({ embeds: [embed] });
					break;
				}

				case "memory": {
					const memStats = memoryManager.getCurrentMemoryUsage();
					if (!memStats) {
						await interaction.editReply("🔸 Memory stats not available");
						return;
					}

					const heapUsedMB = (memStats.heapUsed / 1024 / 1024).toFixed(2);
					const heapTotalMB = (memStats.heapTotal / 1024 / 1024).toFixed(2);
					const rssMB = (memStats.rss / 1024 / 1024).toFixed(2);
					const externalMB = (memStats.external / 1024 / 1024).toFixed(2);

					const embed = new EmbedBuilder()
						.setTitle("🔹 Memory Usage")
						.setDescription("Current memory statistics")
						.setColor(0x0099ff)
						.addFields(
							{ name: "Heap Used", value: `${heapUsedMB}MB`, inline: true },
							{ name: "Heap Total", value: `${heapTotalMB}MB`, inline: true },
							{ name: "RSS", value: `${rssMB}MB`, inline: true },
							{ name: "External", value: `${externalMB}MB`, inline: true },
							{
								name: "Healthy",
								value: memoryManager.isHealthy() ? "✅ Yes" : "❌ No",
								inline: true,
							},
						)
						.setTimestamp();

					await interaction.editReply({ embeds: [embed] });
					break;
				}

				case "performance": {
					const perfStats = memoryManager.getAveragePerformanceMetrics();
					const commandStats = getCommandStats();

					const embed = new EmbedBuilder()
						.setTitle("🔹 Performance Metrics")
						.setDescription("Average performance statistics")
						.setColor(0x0099ff)
						.addFields(
							{
								name: "Event Processing",
								value: `${(perfStats.eventProcessingTime || 0).toFixed(2)}ms`,
								inline: true,
							},
							{
								name: "Database Queries",
								value: `${(perfStats.databaseQueryTime || 0).toFixed(2)}ms`,
								inline: true,
							},
							{
								name: "Redis Operations",
								value: `${(perfStats.redisOperationTime || 0).toFixed(2)}ms`,
								inline: true,
							},
							{
								name: "Command Execution",
								value: `${(perfStats.commandExecutionTime || 0).toFixed(2)}ms`,
								inline: true,
							},
							{
								name: "Cached Commands",
								value: commandStats.cachedCommands.toString(),
								inline: true,
							},
							{
								name: "Avg Load Time",
								value: `${commandStats.averageLoadTime.toFixed(2)}ms`,
								inline: true,
							},
						)
						.setTimestamp();

					await interaction.editReply({ embeds: [embed] });
					break;
				}

				default:
					await interaction.editReply("🔸 Invalid health check type");
			}
		} catch (error) {
			console.error("🔸 Error in health command:", error);
			await interaction.editReply("🔸 Error retrieving health information");
		}
	},
};
