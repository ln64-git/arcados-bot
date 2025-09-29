# 🚀 Package.json Scripts Guide

This document explains all the optimized scripts available in your Discord bot's package.json.

## 📋 **Available Scripts**

### **🚀 Core Development Scripts**

#### `npm start`

- **Description**: Production-ready start with garbage collection enabled
- **Features**:
  - `--expose-gc`: Enables manual garbage collection
  - `--max-old-space-size=512`: Limits heap to 512MB for better memory management
- **Use**: `npm start`

#### `npm run start:dev`

- **Description**: Development start using tsx (TypeScript execution)
- **Features**: Direct TypeScript execution without compilation
- **Use**: `npm run start:dev`

#### `npm run dev`

- **Description**: Development mode with file watching
- **Features**: Auto-restart on file changes
- **Use**: `npm run dev`

#### `npm run dev:gc`

- **Description**: Development mode with garbage collection enabled
- **Features**: File watching + memory management
- **Use**: `npm run dev:gc`

### **🔧 Build & Clean Scripts**

#### `npm run build`

- **Description**: Compile TypeScript to JavaScript
- **Output**: `dist/` directory
- **Use**: `npm run build`

#### `npm run build:prod`

- **Description**: Production build with cleanup
- **Features**: Builds and cleans build artifacts
- **Use**: `npm run build:prod`

#### `npm run clean`

- **Description**: Remove build directory
- **Use**: `npm run clean`

#### `npm run clean:build`

- **Description**: Deep clean (dist + node_modules cache)
- **Use**: `npm run clean:build`

### **📊 Performance & Monitoring Scripts**

#### `npm run test:perf`

- **Description**: Run performance tests
- **Features**: Tests all optimization systems
- **Use**: `npm run test:perf`

#### `npm run health`

- **Description**: Check bot health status
- **Features**: Database, Redis, memory, and performance checks
- **Use**: `npm run health`

#### `npm run memory`

- **Description**: Display current memory usage
- **Features**: Heap, RSS, and external memory stats
- **Use**: `npm run memory`

#### `npm run monitor`

- **Description**: Run performance monitoring
- **Features**: Continuous performance testing
- **Use**: `npm run monitor`

#### `npm run benchmark`

- **Description**: Run performance benchmarks
- **Features**: Comprehensive performance testing with exit
- **Use**: `npm run benchmark`

#### `npm run stats`

- **Description**: Display command loading statistics
- **Features**: Cache stats, load times, performance metrics
- **Use**: `npm run stats`

#### `npm run gc`

- **Description**: Manually trigger garbage collection
- **Features**: Force memory cleanup
- **Use**: `npm run gc`

### **🔄 Development Workflow Scripts**

#### `npm run dev:monitor`

- **Description**: Development with monitoring
- **Features**: Runs bot + performance monitoring simultaneously
- **Use**: `npm run dev:monitor`

#### `npm run dev:full`

- **Description**: Full development mode
- **Features**: GC-enabled dev + monitoring
- **Use**: `npm run dev:full`

### **🐛 Debug Scripts**

#### `npm run start:debug`

- **Description**: Debug mode with inspector
- **Features**:
  - `--inspect`: Enables Node.js debugger
  - `--expose-gc`: Garbage collection access
- **Use**: `npm run start:debug`

#### `npm run start:prod`

- **Description**: Production mode with optimizations
- **Features**:
  - `NODE_ENV=production`: Production environment
  - `--expose-gc`: Garbage collection
  - `--max-old-space-size=1024`: 1GB heap limit
- **Use**: `npm run start:prod`

### **🎨 Code Quality Scripts**

#### `npm run format`

- **Description**: Format code using Biome
- **Use**: `npm run format`

#### `npm run lint`

- **Description**: Check code quality
- **Use**: `npm run lint`

#### `npm run lint:fix`

- **Description**: Fix linting issues automatically
- **Use**: `npm run lint:fix`

## 🎯 **Recommended Workflows**

### **Development Workflow**

```bash
# Start development with monitoring
npm run dev:monitor

# Or full development mode with GC
npm run dev:full
```

### **Performance Testing Workflow**

```bash
# Run performance tests
npm run test:perf

# Check health status
npm run health

# Monitor memory usage
npm run memory

# Run benchmarks
npm run benchmark
```

### **Production Deployment Workflow**

```bash
# Build for production
npm run build:prod

# Start production server
npm run start:prod
```

### **Debug Workflow**

```bash
# Start with debugger
npm run start:debug

# Check performance stats
npm run stats

# Manual garbage collection
npm run gc
```

## 🔧 **Environment Variables**

Make sure to set these environment variables:

```bash
# Required
BOT_TOKEN=your_discord_bot_token

# Optional
NODE_ENV=development|production|test
MONGO_URI=mongodb://localhost:27017
REDIS_URL=redis://localhost:6379
GUILD_ID=your_guild_id
```

## 📈 **Performance Monitoring**

The scripts provide comprehensive monitoring:

- **Memory Usage**: Real-time heap and RSS monitoring
- **Database Performance**: Query execution times
- **Redis Performance**: Operation timing
- **Command Performance**: Execution times
- **Event Processing**: Queue performance
- **Health Status**: Overall system health

## 🚀 **Optimization Features**

All scripts include:

- **Garbage Collection**: Automatic and manual GC triggers
- **Memory Limits**: Configurable heap size limits
- **Performance Tracking**: Built-in timing for all operations
- **Health Monitoring**: Continuous system health checks
- **Error Recovery**: Automatic retry mechanisms
- **Resource Cleanup**: Proper cleanup on shutdown

## 💡 **Tips**

1. **Development**: Use `npm run dev:monitor` for the best development experience
2. **Testing**: Run `npm run test:perf` before deploying
3. **Production**: Always use `npm run start:prod` for production
4. **Debugging**: Use `npm run start:debug` for debugging issues
5. **Memory Issues**: Use `npm run gc` to manually trigger cleanup
6. **Performance**: Monitor with `npm run health` regularly

## 🎉 **Result**

Your bot now has:

- ✅ Optimized startup and runtime performance
- ✅ Comprehensive monitoring and debugging tools
- ✅ Production-ready deployment scripts
- ✅ Development-friendly workflow tools
- ✅ Memory management and garbage collection
- ✅ Performance testing and benchmarking
- ✅ Health monitoring and status checks
