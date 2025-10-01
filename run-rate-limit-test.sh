#!/bin/bash

# Discord Rate Limiting Test Runner
# This script runs the quick rate limiting test

echo "🚀 Starting Discord Rate Limiting Test"
echo "======================================"

# Check if DISCORD_BOT_TOKEN is set
if [ -z "$DISCORD_BOT_TOKEN" ]; then
    echo "❌ Error: DISCORD_BOT_TOKEN environment variable is not set"
    echo "💡 Please set it with: export DISCORD_BOT_TOKEN='your_bot_token_here'"
    exit 1
fi

# Check if the test file exists
if [ ! -f "quick-rate-limit-test.js" ]; then
    echo "❌ Error: quick-rate-limit-test.js not found"
    exit 1
fi

echo "🔹 Running quick rate limiting test..."
echo "🔹 This will attempt 5 channel renames with 2-second delays"
echo "🔹 Press Ctrl+C to stop early if needed"
echo ""

# Run the test
node quick-rate-limit-test.js

echo ""
echo "🏁 Test completed!"
