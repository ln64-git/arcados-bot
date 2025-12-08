#!/usr/bin/env bun
/**
 * Test script for Discord streaming workflow
 *
 * Usage: bun run src/features/stream-player/tests/test-discord-stream.ts
 *
 * This script tests the Discord streaming workflow:
 * 1. Login to Discord
 * 2. Navigate to server
 * 3. Navigate to voice channel
 * 4. Join voice channel
 * 5. Start Go Live
 */

import { DiscordUserAccountService } from "../services/DiscordUserAccountService.js";
import { PuppeteerService } from "../services/PuppeteerService.js";
import { config } from "../../../config/index.js";

const GUILD_ID = "1254694808228986912"; // Arcados server
const CHANNEL_ID = "1427152903260344350"; // 🌿 - Cantina

async function testDiscordStream() {
  console.log("🧪 Starting Discord streaming workflow test...");
  console.log(`Guild ID: ${GUILD_ID}`);
  console.log(`Channel ID: ${CHANNEL_ID}`);

  // Initialize Puppeteer
  const puppeteerService = new PuppeteerService();
  await puppeteerService.initialize();

  console.log("\n✓ Puppeteer initialized");

  // Create a test page (simulating video content)
  const contentPage = await puppeteerService.createPage();
  await contentPage.goto("https://www.youtube.com/watch?v=CsGYh8AacgY", {
    waitUntil: "networkidle2"
  });

  console.log("✓ Test content page loaded (YouTube video)");

  // Initialize Discord service
  const discordService = new DiscordUserAccountService();
  const browser = await puppeteerService.getBrowser();
  await discordService.initialize(browser);

  console.log("✓ Discord service initialized");

  try {
    // Test the full workflow
    console.log("\n📡 Testing Discord streaming workflow...");
    console.log("-------------------------------------------");

    await discordService.joinAndStream(
      GUILD_ID,
      CHANNEL_ID,
      contentPage
    );

    console.log("\n🔹 SUCCESS! Discord streaming workflow completed");
    console.log("The bot should now be streaming in the voice channel.");
    console.log("\nPress Ctrl+C to stop...");

    // Keep the script running to maintain the stream
    await new Promise(() => {}); // Wait forever

  } catch (error) {
    console.error("\n❌ FAILED! Discord streaming workflow error:");
    console.error(error);

    // Take a screenshot for debugging
    const discordPage = (discordService as any).discordPage;
    if (discordPage) {
      const screenshotPath = `/tmp/discord-stream-test-error-${Date.now()}.png`;
      await discordPage.screenshot({ path: screenshotPath });
      console.log(`\n📸 Screenshot saved: ${screenshotPath}`);
    }

    process.exit(1);
  }
}

// Run the test
testDiscordStream().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
