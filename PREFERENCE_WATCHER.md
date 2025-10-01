# 🔍 User Preferences Real-Time Watcher

This tool allows you to monitor user preferences in real-time as they change in the MongoDB database. Perfect for debugging and testing the dynamic voice channel system!

## 🚀 Quick Start

### Option 1: Polling Version (Works with Standalone MongoDB)

```bash
./watch-preferences.sh
```

### Option 2: TypeScript Polling Version

```bash
tsx src/scripts/watch-preferences-polling.ts
```

### Option 3: Direct JavaScript Polling

```bash
node watch-preferences-polling.js
```

### Option 4: Change Streams (Requires MongoDB Replica Set)

```bash
tsx src/scripts/watch-preferences.ts
```

## 📊 What You'll See

The watcher displays real-time updates when:

- **➕ NEW PREFERENCE CREATED**: User joins spawn channel for first time
- **🔄 PREFERENCE UPDATED**: User manually renames their channel
- **🗑️ PREFERENCE DELETED**: User preferences are removed

### Example Output:

```
[2:34:15 PM] 🔄 PREFERENCE UPDATED
   User ID: 123456789012345678
   Guild ID: 987654321098765432
   Preferred Name: "Gaming Lounge"
   Last Updated: 1/30/2025, 2:34:15 PM
   Channel Limit: 10
   Private Channel: No
```

## 🔧 How It Works

### MongoDB Change Streams

- Uses MongoDB's native change streams for real-time monitoring
- No polling - instant updates when data changes
- Efficient and lightweight

### Integration Points

- **Channel Creation**: When users join spawn channel
- **Manual Renames**: When users rename via Discord UI
- **Preference Updates**: When bot updates user settings

## 🎯 Use Cases

### 1. Testing Dynamic VC System

```bash
# Terminal 1: Start watcher
./watch-preferences.sh

# Terminal 2: Start bot
bun start

# Now join spawn channel and rename your channel!
```

### 2. Debugging Preference Sync

- Watch for preference updates when you manually rename channels
- Verify that `lastUpdated` timestamps are correct
- Check that user IDs and guild IDs are properly stored

### 3. Monitoring System Health

- See how many users are creating channels
- Monitor preference update frequency
- Detect any database connection issues

## 🛠️ Advanced Usage

### Custom Filtering

Modify `watch-preferences-simple.js` to filter specific users or guilds:

```javascript
// Watch only specific user
const changeStream = collection.watch([
  { $match: { "fullDocument.userId": "123456789012345678" } },
]);

// Watch only specific guild
const changeStream = collection.watch([
  { $match: { "fullDocument.guildId": "987654321098765432" } },
]);
```

### Multiple Collections

Watch multiple collections simultaneously:

```javascript
const collections = ["userPreferences", "voiceChannelOwners", "moderationLogs"];
// ... watch each collection
```

## 🔍 Troubleshooting

### Replica Set Error (Change Streams)

If you see this error:

```
The $changeStream stage is only supported on replica sets
```

**Solution**: Use the polling version instead:

```bash
# Use polling version (works with standalone MongoDB)
./watch-preferences.sh
# or
tsx src/scripts/watch-preferences-polling.ts
```

**Why**: MongoDB change streams require a replica set, but most development setups use standalone MongoDB.

### Connection Issues

```bash
# Check MongoDB connection
mongosh $MONGO_URI

# Verify database exists
use discord-bot
db.userPreferences.countDocuments()
```

### Permission Issues

```bash
# Make scripts executable
chmod +x watch-preferences.sh
chmod +x src/scripts/watch-preferences.ts
```

### Environment Variables

Ensure your `.env` file has:

```env
MONGO_URI=mongodb://localhost:27017
DB_NAME=discord-bot
```

## 📈 Performance Notes

- **Change Streams**: Very efficient, no polling overhead
- **Memory Usage**: Minimal - only processes changes as they happen
- **Network**: Only sends changed documents, not full collections
- **Scalability**: Works with large databases and high update rates

## 🎉 Perfect for Testing!

This watcher is perfect for testing the complete flow:

1. **Start watcher** → See initial state
2. **Join spawn channel** → See preference created
3. **Manually rename channel** → See preference updated
4. **Leave channel** → Channel auto-deletes
5. **Rejoin spawn** → See preference restored

Enjoy real-time debugging! 🚀
