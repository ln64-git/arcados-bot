# Relationship Network Scripts

This directory contains scripts for generating, analyzing, and exporting relationship network data.

## Scripts Overview

### Core Scripts

- **`generate-relationship-networks.ts`** - Generate relationship networks for all members in a guild
- **`analyze-user-relationships.ts`** - Analyze individual user relationship networks and compare users
- **`export-relationship-networks.ts`** - Export relationship data in JSON and CSV formats
- **`comprehensive-demo.ts`** - Comprehensive demonstration of all relationship network features
- **`test-relationship-networks.ts`** - Test script to verify relationship network functionality

### Legacy Scripts

- **`demonstrate-relationship-network.ts`** - Basic demonstration script (moved from main scripts)

## Usage

### Generate Relationship Networks

Generate relationship networks for all members in a guild:

```bash
# Generate for a single guild
npm run generate-networks <guild-id>

# Generate for multiple guilds
npm run generate-networks <guild-id1> <guild-id2> ...
```

### Analyze User Relationships

Analyze individual user relationship networks:

```bash
# Analyze a single user
npm run analyze-user <user-id> <guild-id> [limit]

# Compare two users
npm run compare-users <user1-id> <user2-id> <guild-id>

# Get guild statistics
npm run guild-stats <guild-id>
```

### Export Data

Export relationship network data:

```bash
# Export guild networks
npm run export-networks <guild-id> [format] [options]

# Export user network
npm run export-user <user-id> <guild-id> [format] [options]

# Export network statistics
npm run export-stats <guild-id>
```

### Run Tests

Test the relationship network functionality:

```bash
# Test with real database
npm run test-networks

# Test with mock data (no database required)
npm run test-networks mock
```

### Run Comprehensive Demo

Run a full demonstration:

```bash
# Quick demo (mock data)
npm run demo-quick

# Full demo (real data)
npm run demo-full <guild-id> <user-id1> [user-id2] ...
```

## Export Options

### Formats

- `json` - JSON format (default)
- `csv` - CSV format for spreadsheet analysis

### Options

- `--min-score=<number>` - Filter relationships by minimum affinity score
- `--limit=<number>` - Limit number of relationships exported

## Examples

```bash
# Generate networks for guild 123456789012345678
npm run generate-networks 123456789012345678

# Analyze user 987654321098765432 in guild 123456789012345678
npm run analyze-user 987654321098765432 123456789012345678 15

# Compare two users
npm run compare-users 987654321098765432 111111111111111111 123456789012345678

# Export guild networks to CSV with minimum score of 10
npm run export-networks 123456789012345678 csv --min-score=10

# Export user network to JSON with limit of 50
npm run export-user 987654321098765432 123456789012345678 json --limit=50

# Get guild statistics
npm run guild-stats 123456789012345678

# Test the system
npm run test-networks

# Run comprehensive demo
npm run demo-full 123456789012345678 987654321098765432 111111111111111111
```

## Output Files

Exported files are saved to the `exports/` directory in the project root:

- `relationship-networks-<guild-id>-<timestamp>.json` - Guild networks (JSON)
- `relationship-networks-<guild-id>-<timestamp>.csv` - Guild networks (CSV)
- `user-network-<user-id>-<timestamp>.json` - User network (JSON)
- `user-network-<user-id>-<timestamp>.csv` - User network (CSV)
- `network-stats-<guild-id>-<timestamp>.json` - Network statistics

## Configuration

The relationship network system uses configurable weights and options:

### Default Weights

- Same channel messages: 1 point
- Mentions: 2 points
- Replies: 3 points

### Default Options

- Time window: 5 minutes
- Cache TTL: 60 minutes
- Minimum affinity score: 1
- Maximum relationships: 50

## Error Handling

All scripts include comprehensive error handling and will:

- Log detailed error messages
- Continue processing other items when individual items fail
- Provide helpful usage information
- Exit with appropriate status codes

## Performance Notes

- Network generation can be time-intensive for large guilds
- Scripts include progress reporting and timing information
- Database connections are properly managed and cleaned up
- Small delays are added between operations to prevent overwhelming the database
