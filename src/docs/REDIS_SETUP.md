# Redis Integration for Arcados Bot

This bot now includes Redis caching for improved performance and scalability.

## Setup

### 1. Install Redis

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

**macOS (with Homebrew):**

```bash
brew install redis
brew services start redis
```

**Docker:**

```bash
docker run -d --name redis -p 6379:6379 redis:alpine
```

### 2. Environment Configuration

Add to your `.env` file:

```env
# Redis Configuration
REDIS_URL=redis://localhost:6379

# For Redis with authentication:
# REDIS_URL=redis://username:password@localhost:6379

# For Redis Cloud or external Redis:
# REDIS_URL=redis://your-redis-cloud-url:port
```

### 3. Install Dependencies

```bash
npm install
# or
bun install
```

## Features

### Hybrid Caching System

- **Redis Primary**: Fast in-memory caching for frequently accessed data
- **MongoDB Fallback**: Persistent storage when Redis is unavailable
- **Automatic Failover**: Graceful degradation if Redis connection fails

### Cached Data Types

- **Channel Ownership**: Voice channel ownership information
- **User Preferences**: User moderation preferences and settings
- **Guild Configurations**: Server-specific voice channel settings
- **Call States**: Current voice call state (muted, deafened users)
- **Coup Sessions**: Active ownership transfer votes
- **Rate Limits**: User action rate limiting

### Performance Benefits

- **Sub-millisecond Access**: Redis provides ultra-fast data retrieval
- **Reduced Database Load**: Fewer MongoDB queries
- **Scalability**: Redis can handle high concurrent access
- **Memory Efficiency**: Automatic TTL expiration for temporary data

### TTL (Time To Live) Settings

- **Channel Ownership**: 1 hour (persistent)
- **User Preferences**: 1 hour (persistent)
- **Guild Configs**: 1 hour (persistent)
- **Call States**: 30 minutes (temporary)
- **Coup Sessions**: 5 minutes (temporary)
- **Rate Limits**: 1 minute (temporary)

## Monitoring

The bot will log Redis connection status:

- `🔹 Redis client connected` - Successful connection
- `🔸 Redis client error: ...` - Connection issues
- `🔹 Redis connection established` - Bot startup confirmation
- `🔸 Redis connection failed, using MongoDB fallback` - Fallback mode

## Troubleshooting

### Redis Connection Issues

1. Check if Redis is running: `redis-cli ping`
2. Verify Redis URL in `.env` file
3. Check firewall settings for port 6379
4. Ensure Redis server has enough memory

### Performance Issues

1. Monitor Redis memory usage: `redis-cli info memory`
2. Check Redis logs: `redis-cli monitor`
3. Verify TTL settings are appropriate
4. Consider Redis clustering for high load

### Fallback Mode

If Redis is unavailable, the bot automatically falls back to MongoDB-only mode. This ensures the bot continues to function but with reduced performance.

## Development

### Testing Redis Connection

```bash
redis-cli ping
# Should return: PONG
```

### Flushing Cache (Development)

```bash
redis-cli flushall
```

### Monitoring Commands

```bash
# Monitor all Redis commands
redis-cli monitor

# Check memory usage
redis-cli info memory

# List all keys
redis-cli keys "*"
```
