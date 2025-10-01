#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Set default values if not provided
export MONGO_URI=${MONGO_URI:-"mongodb://localhost:27017"}
export DB_NAME=${DB_NAME:-"discord-bot"}

echo "🔍 Starting User Preferences Watcher"
echo "📊 Database: $DB_NAME"
echo "🔗 MongoDB URI: $MONGO_URI"
echo ""

# Run the watcher (polling version for standalone MongoDB)
node watch-preferences-polling.js
