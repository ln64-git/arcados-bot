# User Object Watcher Scripts

This directory contains scripts to watch and monitor user objects in the database. These scripts use polling to detect changes in real-time.

## Available Scripts

### 1. Basic User Watcher (`watch-user-objects.ts`)

A simple script that watches all user objects for changes.

**Usage:**

```bash
# Watch all users
./watch-user.sh all

# Or run directly
cd src && tsx scripts/watch-user-objects.ts
```

**Features:**

- Monitors all users in the database
- Shows new users, updates, and deletions
- Displays basic user information
- Configurable polling interval (default: 2 seconds)

### 2. Advanced User Watcher (`watch-user-objects-advanced.ts`)

A comprehensive script with advanced filtering and monitoring options.

**Usage:**

```bash
# Basic usage
./watch-user.sh advanced

# Watch specific user
./watch-user.sh advanced --user 123456789012345678

# Watch users from specific guild
./watch-user.sh advanced --guild 987654321098765432

# Watch only updates with verbose output
./watch-user.sh advanced --mode updates --verbose

# Filter specific fields
./watch-user.sh advanced --filter username,displayName,status

# Exclude certain fields from change detection
./watch-user.sh advanced --exclude roles,avatarHistory

# Custom polling interval
./watch-user.sh advanced --interval 1000
```

**Options:**

- `--user <id>` / `-u <id>`: Watch specific user by Discord ID
- `--guild <id>` / `-g <id>`: Watch users from specific guild
- `--interval <ms>` / `-i <ms>`: Polling interval in milliseconds (default: 2000)
- `--verbose` / `-v`: Show detailed information
- `--history` / `-h`: Show avatar/username history changes
- `--mode <mode>` / `-m <mode>`: Watch mode (all, new, updates, deletes)
- `--filter <fields>` / `-f <fields>`: Only show changes to these fields (comma-separated)
- `--exclude <fields>` / `-e <fields>`: Exclude these fields from change detection (comma-separated)

### 3. Specific User Watcher (`watch-specific-user.ts`)

A focused script to watch a single user by Discord ID.

**Usage:**

```bash
# Watch specific user
./watch-user.sh user 123456789012345678

# Or run directly
cd src && tsx scripts/watch-specific-user.ts 123456789012345678
```

**Features:**

- Monitors only the specified user
- Shows detailed change information
- Lightweight and focused

## Shell Script Helper

The `watch-user.sh` script provides a convenient way to run all watchers:

```bash
# Make executable (if not already)
chmod +x watch-user.sh

# Show help
./watch-user.sh help

# Examples
./watch-user.sh all                    # Watch all users
./watch-user.sh user 123456789         # Watch specific user
./watch-user.sh advanced --verbose     # Advanced mode with verbose output
```

## What Gets Monitored

The scripts monitor changes to:

### Basic User Fields

- `username` - Discord username
- `displayName` - Display name
- `discriminator` - User discriminator
- `status` - Text status
- `avatar` - Avatar URL
- `roles` - Array of role IDs
- `joinedAt` - When user joined
- `lastSeen` - Last seen timestamp

### Metadata Fields

- `emoji` - User emoji
- `title` - User title
- `summary` - User summary
- `keywords` - User keywords
- `notes` - User notes

### Moderation Preferences

- `preferredChannelName` - Preferred channel name
- `preferredUserLimit` - Preferred user limit
- `preferredLocked` - Preferred lock state
- `preferredHidden` - Preferred hidden state
- `bannedUsers` - List of banned users
- `mutedUsers` - List of muted users
- `kickedUsers` - List of kicked users
- `deafenedUsers` - List of deafened users
- `renamedUsers` - List of renamed users

### History Fields (when `--history` is used)

- `avatarHistory` - Previous avatars
- `usernameHistory` - Previous usernames
- `displayNameHistory` - Previous display names
- `statusHistory` - Previous statuses

## Output Format

The scripts provide real-time output showing:

```
[14:30:25] 🔄 USER UPDATED
   Changes: username: "oldname" → "newname", status: "old status" → "new status"
   Discord ID: 123456789012345678
   Username: newname
   Display Name: New Display Name
   Discriminator: #1234
   Bot: No
   Joined: 1/15/2024, 10:30:00 AM
   Last Seen: 1/20/2024, 2:30:25 PM
   Status: "new status"
   Roles: 3 roles
   Avatar: https://cdn.discordapp.com/avatars/...
   Mod Preferences:
     Preferred Channel: "My Channel"
     Preferred Limit: 10
     Preferred Locked: No
     Preferred Hidden: No
     Banned Users: 2
     Muted Users: 1
   Created: 1/15/2024, 10:30:00 AM
   Updated: 1/20/2024, 2:30:25 PM
```

## Stopping the Watchers

Press `Ctrl+C` to gracefully stop any watcher. The scripts will clean up and exit properly.

## Requirements

- Node.js with TypeScript support
- MongoDB connection configured
- Access to the database with user collection

## Troubleshooting

### Common Issues

1. **"User not found"**: The Discord ID might be incorrect or the user doesn't exist in the database
2. **"Database connection failed"**: Check your MongoDB connection string and ensure the database is accessible
3. **"No changes detected"**: The user might not be changing, or the polling interval might be too long

### Performance Considerations

- Lower polling intervals (e.g., 1000ms) provide faster change detection but use more resources
- Higher polling intervals (e.g., 5000ms) are more resource-efficient but slower to detect changes
- Filtering specific fields can improve performance by reducing unnecessary comparisons
- Watching specific users or guilds reduces the amount of data being monitored

## Examples

### Watch for username changes only

```bash
./watch-user.sh advanced --filter username --interval 1000
```

### Monitor moderation actions

```bash
./watch-user.sh advanced --filter modPreferences.bannedUsers,modPreferences.mutedUsers --verbose
```

### Watch new users only

```bash
./watch-user.sh advanced --mode new --verbose
```

### Monitor a specific user's status changes

```bash
./watch-user.sh advanced --user 123456789 --filter status --history
```
