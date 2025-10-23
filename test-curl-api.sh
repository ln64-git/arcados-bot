#!/bin/bash

# Test curl commands for relationship network API
echo "🔹 Testing Relationship Network API with curl"
echo "=" | head -c 50 && echo ""

# Test 1: Health check
echo "1. Health Check:"
curl -s -X GET "http://localhost:3001/api/health" | jq '.' 2>/dev/null || echo "Server not running - start with: node src/scripts/test-api-server.mjs"
echo ""

# Test 2: Database stats (direct query)
echo "2. Database Stats (Direct Query):"
cd /home/ln64/Source/arcados-bot && node src/scripts/curl-test-stats.mjs
echo ""

# Test 3: Specific user relationship network
echo "3. User Relationship Network (354823920010002432):"
cd /home/ln64/Source/arcados-bot && node src/scripts/curl-test-user.mjs
echo ""

# Test 4: Comprehensive data
echo "4. Comprehensive Relationship Data:"
cd /home/ln64/Source/arcados-bot && node src/scripts/curl-test-comprehensive.mjs
echo ""

echo "🔹 All curl tests completed!"
echo "=" | head -c 50 && echo ""
