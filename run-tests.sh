#!/bin/bash

# Discord API Performance Test Runner
# This script runs various tests to investigate Discord API performance issues

echo "🚀 Discord API Performance Test Suite"
echo "====================================="
echo ""

# Check if we have the required environment variables
if [ -z "$TEST_GUILD_ID" ] || [ -z "$TEST_CHANNEL_ID" ]; then
    echo "❌ Missing required environment variables!"
    echo ""
    echo "Please set the following environment variables:"
    echo "  export TEST_GUILD_ID='your-guild-id'"
    echo "  export TEST_CHANNEL_ID='your-channel-id'"
    echo ""
    echo "You can find these IDs by:"
    echo "  1. Right-clicking on your server → Copy Server ID"
    echo "  2. Right-clicking on a voice channel → Copy Channel ID"
    echo ""
    echo "Then run:"
    echo "  TEST_GUILD_ID='your-guild-id' TEST_CHANNEL_ID='your-channel-id' ./run-tests.sh"
    exit 1
fi

echo "📋 Test Configuration:"
echo "  Guild ID: $TEST_GUILD_ID"
echo "  Channel ID: $TEST_CHANNEL_ID"
echo ""

# Test 1: Basic Discord API Performance
echo "🔍 Test 1: Basic Discord API Performance"
echo "----------------------------------------"
node test-discord-api.js
echo ""

# Test 2: Channel Rename Specific Tests
echo "🔍 Test 2: Channel Rename Specific Tests"
echo "---------------------------------------"
node test-channel-rename.js
echo ""

echo "✅ All tests completed!"
echo ""
echo "📊 Analysis:"
echo "  - If channel.setName() consistently takes >10 seconds, there's a Discord API issue"
echo "  - If it's fast in tests but slow in the bot, there's a bot-specific issue"
echo "  - If REST API is faster than discord.js, we should use REST API directly"
echo ""
