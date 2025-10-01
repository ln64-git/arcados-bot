#!/bin/bash

# User Object Watcher Scripts
# Usage: ./watch-user.sh [command] [options]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"

case "$1" in
    "all")
        echo "🔍 Watching all user objects..."
        cd "$SRC_DIR" && tsx scripts/watch-user-objects.ts
        ;;
    "advanced")
        echo "🔍 Starting advanced user watcher..."
        cd "$SRC_DIR" && tsx scripts/watch-user-objects-advanced.ts "${@:2}"
        ;;
    "user")
        if [ -z "$2" ]; then
            echo "🔸 Usage: ./watch-user.sh user <discord-user-id>"
            echo "Example: ./watch-user.sh user 123456789012345678"
            exit 1
        fi
        echo "🔍 Watching user: $2"
        cd "$SRC_DIR" && tsx scripts/watch-specific-user.ts "$2"
        ;;
    "help"|"--help"|"-h")
        echo "User Object Watcher Scripts"
        echo ""
        echo "Usage: ./watch-user.sh [command] [options]"
        echo ""
        echo "Commands:"
        echo "  all                    Watch all user objects (basic mode)"
        echo "  advanced [options]     Watch with advanced options"
        echo "  user <discord-id>      Watch specific user by Discord ID"
        echo "  help                  Show this help message"
        echo ""
        echo "Advanced Options:"
        echo "  --user <id>           Watch specific user by Discord ID"
        echo "  --guild <id>          Watch users from specific guild"
        echo "  --interval <ms>       Polling interval in milliseconds (default: 2000)"
        echo "  --verbose             Show detailed information"
        echo "  --history             Show avatar/username history changes"
        echo "  --mode <mode>         Watch mode: all, new, updates, deletes (default: all)"
        echo "  --filter <fields>     Only show changes to these fields (comma-separated)"
        echo "  --exclude <fields>    Exclude these fields from change detection (comma-separated)"
        echo ""
        echo "Examples:"
        echo "  ./watch-user.sh all"
        echo "  ./watch-user.sh user 123456789012345678"
        echo "  ./watch-user.sh advanced --user 123456789 --verbose"
        echo "  ./watch-user.sh advanced --guild 987654321 --mode updates"
        echo "  ./watch-user.sh advanced --filter username,displayName --interval 1000"
        ;;
    *)
        echo "🔸 Unknown command: $1"
        echo "Use './watch-user.sh help' for usage information"
        exit 1
        ;;
esac
