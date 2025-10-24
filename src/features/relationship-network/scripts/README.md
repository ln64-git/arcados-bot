# Relationship Network Scripts

This folder contains scripts for building and managing user relationship networks based on message interactions.

## Scripts

### Network Generation
- `generate-all-relationship-networks.mjs` - Generates relationship networks for all users
- `generate-all-networks-fixed.mjs` - Fixed version of network generation
- `regenerate-relationship-network.ts` - Regenerates relationship networks

### Analysis & Debugging
- `test-relationship-analysis.ts` - Tests relationship analysis algorithms
- `test-relationship-network.ts` - Tests relationship network functionality
- `debug-relationship-query.ts` - Debugs relationship queries
- `demonstrate-relationship-network.ts` - Demonstrates relationship network features

### User-Specific Testing
- `test-user-relationship-network.ts` - Tests relationship network for specific user
- `test-user-relationship-network.js` - JavaScript version
- `test-user-relationship-network.cjs` - CommonJS version
- `test-user-relationship-simple.mjs` - Simplified user relationship test
- `test-user-relationship-messages.mjs` - Tests user relationship messages

### Management
- `check-stored-relationships.ts` - Checks stored relationship data
- `clear-all-relationships.ts` - Clears all relationship data
- `clear-relationship-metadata.ts` - Clears relationship metadata

## Features

- **Interaction Analysis**: Analyzes message patterns between users
- **Network Building**: Creates relationship networks based on interactions
- **Affinity Scoring**: Calculates relationship strength scores
- **Visualization**: Provides relationship network visualization

## Usage

### Generate All Networks
```bash
npx tsx src/scripts/relationship-network/generate-all-relationship-networks.mjs
```

### Test Specific User
```bash
npx tsx src/scripts/relationship-network/test-user-relationship-network.ts
```

### Clear Relationships
```bash
npx tsx src/scripts/relationship-network/clear-all-relationships.ts
```
