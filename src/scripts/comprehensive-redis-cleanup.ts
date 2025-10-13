#!/usr/bin/env tsx

import { config } from "../config/index.js";

/**
 * Comprehensive Redis cleanup script
 * This will scan and clean all corrupted Redis entries
 */
async function comprehensiveRedisCleanup() {
	console.log(`🔧 COMPREHENSIVE REDIS CLEANUP\n`);

	try {
		// Get Redis client directly
		const { getRedisClient } = await import(
			"../features/cache-management/RedisManager.js"
		);
		const redis = await getRedisClient();

		if (!redis) {
			console.log("🔸 Redis client not available");
			return;
		}

		console.log("✅ Redis client connected");

		// Step 1: Get all Redis keys
		console.log("\n🔍 STEP 1: SCANNING ALL REDIS KEYS");
		console.log("-".repeat(50));

		const allKeys = await redis.keys("*");
		console.log(`📊 Found ${allKeys.length} total Redis keys`);

		// Filter for our specific key patterns
		const channelKeys = allKeys.filter((key) =>
			key.startsWith("channel_owner:"),
		);
		const voiceKeys = allKeys.filter((key) => key.startsWith("active_voice:"));
		const userKeys = allKeys.filter((key) => key.startsWith("user_prefs:"));
		const callStateKeys = allKeys.filter((key) =>
			key.startsWith("call_state:"),
		);
		const channelMemberKeys = allKeys.filter((key) =>
			key.startsWith("channel_members:"),
		);

		console.log(`📊 Channel ownership keys: ${channelKeys.length}`);
		console.log(`📊 Active voice keys: ${voiceKeys.length}`);
		console.log(`📊 User preference keys: ${userKeys.length}`);
		console.log(`📊 Call state keys: ${callStateKeys.length}`);
		console.log(`📊 Channel member keys: ${channelMemberKeys.length}`);

		let totalCorrupted = 0;
		const corruptedKeys: string[] = [];

		// Step 2: Check channel ownership keys
		console.log("\n🔍 STEP 2: CHECKING CHANNEL OWNERSHIP KEYS");
		console.log("-".repeat(50));

		for (const key of channelKeys) {
			try {
				const value = await redis.get(key);
				if (
					value === "[object Object]" ||
					value === "null" ||
					value === "undefined" ||
					!value ||
					value.trim() === ""
				) {
					corruptedKeys.push(key);
					totalCorrupted++;
					console.log(`🔸 Corrupted: ${key} (${value})`);
				} else {
					// Try to parse as JSON to catch other corruption
					try {
						JSON.parse(value);
					} catch (parseError) {
						corruptedKeys.push(key);
						totalCorrupted++;
						console.log(`🔸 Corrupted JSON: ${key} (${value})`);
					}
				}
			} catch (error) {
				corruptedKeys.push(key);
				totalCorrupted++;
				console.log(`🔸 Unreadable: ${key}`);
			}
		}

		// Step 3: Check other key types
		console.log("\n🔍 STEP 3: CHECKING OTHER KEY TYPES");
		console.log("-".repeat(50));

		const allOtherKeys = [
			...voiceKeys,
			...userKeys,
			...callStateKeys,
			...channelMemberKeys,
		];
		for (const key of allOtherKeys) {
			try {
				const value = await redis.get(key);
				if (
					value === "[object Object]" ||
					value === "null" ||
					value === "undefined" ||
					!value ||
					value.trim() === ""
				) {
					corruptedKeys.push(key);
					totalCorrupted++;
					console.log(`🔸 Corrupted: ${key} (${value})`);
				} else {
					// Try to parse as JSON to catch other corruption
					try {
						JSON.parse(value);
					} catch (parseError) {
						corruptedKeys.push(key);
						totalCorrupted++;
						console.log(`🔸 Corrupted JSON: ${key} (${value})`);
					}
				}
			} catch (error) {
				corruptedKeys.push(key);
				totalCorrupted++;
				console.log(`🔸 Unreadable: ${key}`);
			}
		}

		// Step 4: Clean up corrupted keys
		console.log("\n🔍 STEP 4: CLEANING UP CORRUPTED KEYS");
		console.log("-".repeat(50));

		if (corruptedKeys.length > 0) {
			console.log(`🔧 Deleting ${corruptedKeys.length} corrupted keys...`);

			for (const key of corruptedKeys) {
				try {
					const deleted = await redis.del(key);
					console.log(`🔹 Deleted: ${key} (${deleted} key(s))`);
				} catch (error) {
					console.log(`🔸 Failed to delete ${key}: ${error}`);
				}
			}
		} else {
			console.log("✅ No corrupted keys found");
		}

		// Step 5: Summary
		console.log("\n🔍 STEP 5: CLEANUP SUMMARY");
		console.log("-".repeat(50));

		console.log(`📊 Total keys scanned: ${allKeys.length}`);
		console.log(`🔸 Corrupted keys found: ${totalCorrupted}`);
		console.log(`🔹 Corrupted keys cleaned: ${corruptedKeys.length}`);
		console.log(`✅ Cleanup completed!`);

		// Step 6: Verify cleanup
		console.log("\n🔍 STEP 6: VERIFICATION");
		console.log("-".repeat(50));

		const remainingKeys = await redis.keys("*");
		console.log(`📊 Remaining keys: ${remainingKeys.length}`);

		// Check if any of the corrupted keys still exist
		let stillCorrupted = 0;
		for (const key of corruptedKeys) {
			const exists = await redis.exists(key);
			if (exists) {
				stillCorrupted++;
				console.log(`🔸 Still exists: ${key}`);
			}
		}

		if (stillCorrupted === 0) {
			console.log("✅ All corrupted keys successfully removed");
		} else {
			console.log(`🔸 ${stillCorrupted} corrupted keys still exist`);
		}
	} catch (error) {
		console.error("🔸 Error during comprehensive cleanup:", error);
	} finally {
		process.exit(0);
	}
}

// Run the cleanup
comprehensiveRedisCleanup().catch(console.error);
