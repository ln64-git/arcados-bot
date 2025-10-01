#!/usr/bin/env node

/**
 * Quick Discord Rate Limiting Test
 *
 * A focused test to quickly identify Discord's channel rename rate limits
 */

import { ChannelType, Client, GatewayIntentBits } from "discord.js";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TEST_CHANNEL_ID = "1422731899511636069"; // The channel we've been testing with

if (!BOT_TOKEN) {
	console.error("❌ DISCORD_BOT_TOKEN environment variable is required");
	process.exit(1);
}

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

async function testChannelRename(attemptNumber) {
	const testName = `Quick Test ${attemptNumber} - ${Date.now()}`;
	console.log(`\n🔄 Attempt ${attemptNumber}: Renaming to "${testName}"`);

	const startTime = Date.now();

	try {
		// Try REST API first
		console.log("  🔍 Trying REST API...");
		const restPromise = client.rest.patch(`/channels/${TEST_CHANNEL_ID}`, {
			body: { name: testName },
		});
		const restTimeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error("REST API timeout")), 10000),
		);

		await Promise.race([restPromise, restTimeoutPromise]);
		const duration = Date.now() - startTime;

		console.log(`  ✅ REST API succeeded in ${duration}ms`);
		return { success: true, duration, method: "REST API" };
	} catch (error) {
		console.log(`  ❌ REST API failed: ${error.message}`);

		// Try discord.js fallback
		try {
			console.log("  🔍 Trying discord.js fallback...");
			const channel = await client.channels.fetch(TEST_CHANNEL_ID);

			if (
				channel &&
				channel.isVoiceBased() &&
				channel.type === ChannelType.GuildVoice
			) {
				const renamePromise = channel.setName(testName);
				const timeoutPromise = new Promise((_, reject) =>
					setTimeout(() => reject(new Error("discord.js timeout")), 8000),
				);

				await Promise.race([renamePromise, timeoutPromise]);
				const duration = Date.now() - startTime;

				console.log(`  ✅ discord.js succeeded in ${duration}ms`);
				return { success: true, duration, method: "discord.js" };
			} else {
				throw new Error("Channel not found or not a voice channel");
			}
		} catch (fallbackError) {
			const duration = Date.now() - startTime;
			console.log(`  ❌ discord.js fallback failed: ${fallbackError.message}`);
			return {
				success: false,
				duration,
				method: "discord.js",
				error: fallbackError.message,
			};
		}
	}
}

async function runQuickTest() {
	console.log("🚀 Quick Discord Rate Limiting Test");
	console.log(`🎯 Target Channel: ${TEST_CHANNEL_ID}`);
	console.log(`📅 Started at: ${new Date().toISOString()}`);

	const results = [];
	const maxAttempts = 5;

	for (let i = 1; i <= maxAttempts; i++) {
		const result = await testChannelRename(i);
		results.push({ attempt: i, ...result });

		// Add delay between attempts (except for the last one)
		if (i < maxAttempts) {
			console.log(`  ⏳ Waiting 2 seconds before next attempt...`);
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
	}

	// Generate summary
	console.log("\n" + "=".repeat(60));
	console.log("📋 QUICK TEST RESULTS");
	console.log("=".repeat(60));

	const successes = results.filter((r) => r.success);
	const failures = results.filter((r) => !r.success);

	console.log(`Total Attempts: ${results.length}`);
	console.log(`Successful: ${successes.length}`);
	console.log(`Failed: ${failures.length}`);
	console.log(
		`Success Rate: ${((successes.length / results.length) * 100).toFixed(1)}%`,
	);

	console.log("\n📊 Detailed Results:");
	results.forEach((result) => {
		const status = result.success ? "✅" : "❌";
		const error = result.error ? ` (${result.error})` : "";
		console.log(
			`  ${status} Attempt ${result.attempt}: ${result.method} - ${result.duration}ms${error}`,
		);
	});

	// Analysis
	console.log("\n🔍 Analysis:");
	if (successes.length === results.length) {
		console.log("✅ All attempts succeeded - No rate limiting detected");
		console.log(
			"💡 Recommendation: Current rate limiting (1 per minute) is too conservative",
		);
	} else if (successes.length >= results.length * 0.8) {
		console.log("⚠️  Most attempts succeeded - Light rate limiting");
		console.log(
			"💡 Recommendation: Slight delay between renames (5-10 seconds)",
		);
	} else if (successes.length >= results.length * 0.5) {
		console.log("⚠️  Moderate failures - Some rate limiting");
		console.log(
			"💡 Recommendation: Moderate delay between renames (15-30 seconds)",
		);
	} else {
		console.log("❌ Many failures - Strong rate limiting");
		console.log("💡 Recommendation: Long delay between renames (60+ seconds)");
	}

	// Check for patterns
	const firstFailure = results.findIndex((r) => !r.success);
	if (firstFailure !== -1) {
		console.log(`\n🎯 First failure at attempt ${firstFailure + 1}`);
		if (firstFailure === 0) {
			console.log("💡 Channel rename might be completely blocked");
		} else if (firstFailure === 1) {
			console.log("💡 Very strict rate limiting - only 1 rename allowed");
		} else {
			console.log(
				`💡 Rate limiting kicks in after ${firstFailure} successful renames`,
			);
		}
	}

	console.log("\n🏁 Test completed at:", new Date().toISOString());
}

// Event handlers
client.once("ready", async () => {
	console.log(`🔹 Bot logged in as ${client.user.tag}`);

	try {
		await runQuickTest();
	} catch (error) {
		console.error("❌ Test execution failed:", error);
	} finally {
		console.log("\n🔹 Shutting down...");
		client.destroy();
		process.exit(0);
	}
});

client.on("error", (error) => {
	console.error("❌ Discord client error:", error);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🔹 Received SIGINT, shutting down gracefully...");
	client.destroy();
	process.exit(0);
});

// Start the bot
console.log("🔹 Starting Discord bot for quick rate limiting test...");
client.login(BOT_TOKEN).catch((error) => {
	console.error("❌ Failed to login:", error);
	process.exit(1);
});
