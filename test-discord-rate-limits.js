#!/usr/bin/env node

/**
 * Discord Rate Limiting Test Script
 *
 * This script tests Discord's rate limiting behavior for channel renames
 * to help understand the exact limits and timing requirements.
 */

import { ChannelType, Client, GatewayIntentBits } from "discord.js";

// Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = "1254694808228986912"; // Arcados guild ID
const TEST_CHANNEL_ID = "1422731899511636069"; // The channel we've been testing with

if (!BOT_TOKEN) {
	console.error("❌ DISCORD_BOT_TOKEN environment variable is required");
	process.exit(1);
}

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const testResults = [];
let currentTestIndex = 0;

const tests = [
	{
		name: "Single rename test",
		description: "Test a single channel rename",
		delay: 0,
		count: 1,
	},
	{
		name: "Rapid rename test (2 renames)",
		description: "Test 2 renames in quick succession",
		delay: 1000, // 1 second between renames
		count: 2,
	},
	{
		name: "Rapid rename test (3 renames)",
		description: "Test 3 renames in quick succession",
		delay: 1000, // 1 second between renames
		count: 3,
	},
	{
		name: "Rate limit test (5 renames)",
		description: "Test 5 renames to trigger rate limiting",
		delay: 1000, // 1 second between renames
		count: 5,
	},
	{
		name: "Slow rename test (2 renames)",
		description: "Test 2 renames with 30 second delay",
		delay: 30000, // 30 seconds between renames
		count: 2,
	},
	{
		name: "Very slow rename test (3 renames)",
		description: "Test 3 renames with 60 second delay",
		delay: 60000, // 60 seconds between renames
		count: 3,
	},
];

async function runTest(test) {
	console.log(`\n🔍 Running test: ${test.name}`);
	console.log(`📝 Description: ${test.description}`);
	console.log(`⏱️  Delay between renames: ${test.delay}ms`);
	console.log(`🔢 Number of renames: ${test.count}`);

	const testResult = {
		testName: test.name,
		startTime: new Date(),
		attempts: [],
		successCount: 0,
		failureCount: 0,
		totalDuration: 0,
	};

	for (let i = 0; i < test.count; i++) {
		const attemptNumber = i + 1;
		console.log(`\n  🔄 Attempt ${attemptNumber}/${test.count}`);

		const attemptStart = Date.now();
		const attemptResult = {
			attemptNumber,
			startTime: new Date(),
			success: false,
			duration: 0,
			error: null,
			method: null,
		};

		try {
			// Try REST API first
			console.log(`    🔍 Attempting REST API rename...`);
			const restStart = Date.now();
			const restPromise = client.rest.patch(`/channels/${TEST_CHANNEL_ID}`, {
				body: { name: `Test Rename ${attemptNumber} - ${Date.now()}` },
			});
			const restTimeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error("REST API timeout")), 10000),
			);

			await Promise.race([restPromise, restTimeoutPromise]);
			const restDuration = Date.now() - restStart;

			attemptResult.success = true;
			attemptResult.duration = restDuration;
			attemptResult.method = "REST API";
			testResult.successCount++;

			console.log(`    ✅ REST API rename succeeded in ${restDuration}ms`);
		} catch (error) {
			console.log(`    ❌ REST API rename failed: ${error.message}`);

			// Try discord.js fallback
			try {
				console.log(`    🔍 Attempting discord.js fallback...`);
				const discordjsStart = Date.now();
				const channel = await client.channels.fetch(TEST_CHANNEL_ID);

				if (
					channel &&
					channel.isVoiceBased() &&
					channel.type === ChannelType.GuildVoice
				) {
					const renamePromise = channel.setName(
						`Test Rename ${attemptNumber} - ${Date.now()}`,
					);
					const timeoutPromise = new Promise((_, reject) =>
						setTimeout(() => reject(new Error("discord.js timeout")), 8000),
					);

					await Promise.race([renamePromise, timeoutPromise]);
					const discordjsDuration = Date.now() - discordjsStart;

					attemptResult.success = true;
					attemptResult.duration = discordjsDuration;
					attemptResult.method = "discord.js";
					testResult.successCount++;

					console.log(
						`    ✅ discord.js rename succeeded in ${discordjsDuration}ms`,
					);
				} else {
					throw new Error("Channel not found or not a voice channel");
				}
			} catch (fallbackError) {
				attemptResult.success = false;
				attemptResult.duration = Date.now() - attemptStart;
				attemptResult.error = fallbackError.message;
				attemptResult.method = "discord.js fallback";
				testResult.failureCount++;

				console.log(
					`    ❌ discord.js fallback failed: ${fallbackError.message}`,
				);
			}
		}

		attemptResult.duration = Date.now() - attemptStart;
		testResult.attempts.push(attemptResult);

		// Add delay between attempts (except for the last one)
		if (i < test.count - 1 && test.delay > 0) {
			console.log(`    ⏳ Waiting ${test.delay}ms before next attempt...`);
			await new Promise((resolve) => setTimeout(resolve, test.delay));
		}
	}

	testResult.totalDuration = Date.now() - testResult.startTime.getTime();
	testResult.endTime = new Date();

	console.log(`\n📊 Test Results:`);
	console.log(`  ✅ Successful renames: ${testResult.successCount}`);
	console.log(`  ❌ Failed renames: ${testResult.failureCount}`);
	console.log(`  ⏱️  Total duration: ${testResult.totalDuration}ms`);
	console.log(
		`  📈 Success rate: ${((testResult.successCount / test.count) * 100).toFixed(1)}%`,
	);

	testResults.push(testResult);

	// Wait 5 seconds between tests to avoid interference
	if (currentTestIndex < tests.length - 1) {
		console.log(`\n⏳ Waiting 5 seconds before next test...`);
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}
}

async function runAllTests() {
	console.log("🚀 Starting Discord Rate Limiting Tests");
	console.log(`🎯 Target Channel: ${TEST_CHANNEL_ID}`);
	console.log(`🏠 Guild: ${GUILD_ID}`);
	console.log(`📅 Started at: ${new Date().toISOString()}`);

	for (
		currentTestIndex = 0;
		currentTestIndex < tests.length;
		currentTestIndex++
	) {
		await runTest(tests[currentTestIndex]);
	}

	// Generate summary report
	console.log("\n" + "=".repeat(80));
	console.log("📋 FINAL SUMMARY REPORT");
	console.log("=".repeat(80));

	testResults.forEach((result, index) => {
		console.log(`\n${index + 1}. ${result.testName}`);
		console.log(
			`   Success Rate: ${((result.successCount / result.attempts.length) * 100).toFixed(1)}%`,
		);
		console.log(`   Total Duration: ${result.totalDuration}ms`);
		console.log(
			`   Successful: ${result.successCount}/${result.attempts.length}`,
		);

		// Show detailed attempt results
		result.attempts.forEach((attempt) => {
			const status = attempt.success ? "✅" : "❌";
			const method = attempt.method || "unknown";
			console.log(
				`     ${status} Attempt ${attempt.attemptNumber}: ${method} (${attempt.duration}ms)${attempt.error ? ` - ${attempt.error}` : ""}`,
			);
		});
	});

	// Calculate overall statistics
	const totalAttempts = testResults.reduce(
		(sum, result) => sum + result.attempts.length,
		0,
	);
	const totalSuccesses = testResults.reduce(
		(sum, result) => sum + result.successCount,
		0,
	);
	const totalFailures = testResults.reduce(
		(sum, result) => sum + result.failureCount,
		0,
	);

	console.log("\n📊 OVERALL STATISTICS");
	console.log(`Total Tests: ${testResults.length}`);
	console.log(`Total Attempts: ${totalAttempts}`);
	console.log(`Total Successes: ${totalSuccesses}`);
	console.log(`Total Failures: ${totalFailures}`);
	console.log(
		`Overall Success Rate: ${((totalSuccesses / totalAttempts) * 100).toFixed(1)}%`,
	);

	// Analyze patterns
	console.log("\n🔍 PATTERN ANALYSIS");
	const rapidTests = testResults.filter((r) => r.testName.includes("Rapid"));
	const slowTests = testResults.filter(
		(r) => r.testName.includes("Slow") || r.testName.includes("slow"),
	);

	if (rapidTests.length > 0) {
		const rapidSuccessRate =
			rapidTests.reduce(
				(sum, r) => sum + r.successCount / r.attempts.length,
				0,
			) / rapidTests.length;
		console.log(
			`Rapid rename success rate: ${(rapidSuccessRate * 100).toFixed(1)}%`,
		);
	}

	if (slowTests.length > 0) {
		const slowSuccessRate =
			slowTests.reduce(
				(sum, r) => sum + r.successCount / r.attempts.length,
				0,
			) / slowTests.length;
		console.log(
			`Slow rename success rate: ${(slowSuccessRate * 100).toFixed(1)}%`,
		);
	}

	console.log("\n🎯 RECOMMENDATIONS");
	if (totalSuccesses / totalAttempts < 0.5) {
		console.log(
			"⚠️  High failure rate detected - Discord rate limiting is very strict",
		);
		console.log(
			"💡 Recommendation: Implement longer delays between renames (60+ seconds)",
		);
	} else if (totalSuccesses / totalAttempts < 0.8) {
		console.log(
			"⚠️  Moderate failure rate detected - Some rate limiting occurring",
		);
		console.log(
			"💡 Recommendation: Implement moderate delays between renames (30+ seconds)",
		);
	} else {
		console.log("✅ Good success rate - Rate limiting is manageable");
		console.log("💡 Recommendation: Current approach should work well");
	}

	console.log("\n🏁 Test completed at:", new Date().toISOString());
}

// Event handlers
client.once("ready", async () => {
	console.log(`🔹 Bot logged in as ${client.user.tag}`);
	console.log(
		`🔹 Guild: ${client.guilds.cache.get(GUILD_ID)?.name || "Unknown"}`,
	);

	try {
		await runAllTests();
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
console.log("🔹 Starting Discord bot for rate limiting tests...");
client.login(BOT_TOKEN).catch((error) => {
	console.error("❌ Failed to login:", error);
	process.exit(1);
});
