# Database Scripts

This folder contains scripts for managing database operations, schema, and connections.

## Scripts

### Schema Management
- `recreate-postgres-schema.ts` - Recreates the PostgreSQL schema from scratch
- `rebuild-database-schema.ts` - Rebuilds SurrealDB schema
- `migrate-postgres-relationship-schema.ts` - Migrates relationship schema to PostgreSQL
- `fix-db-structure.ts` - Fixes database structure issues
- `fix-db-count-issue.ts` - Fixes count-related database issues
- `fix-surreal-cloud-schema.ts` - Fixes SurrealDB cloud schema issues

### Database Operations
- `dump-database.ts` - Exports database contents
- `wipe-database.ts` - Clears all database data
- `wipe-database-clean.ts` - Clean version of database wipe
- `drop-all-data.ts` - Drops all data from SurrealDB
- `drop-all-postgres-data.ts` - Drops all data from PostgreSQL
- `drop-guild-data.ts` - Drops data for a specific guild

### Testing
- `test-postgres-connection.ts` - Tests PostgreSQL connection
- `test-message-storage.ts` - Tests message storage functionality
- `test-message-queries.ts` - Tests message query operations
- `test-simple-message-insert.ts` - Tests simple message insertion
- `test-upsert-message.ts` - Tests message upsert operations
- `test-auto-generated-id.ts` - Tests auto-generated IDs
- `test-auto-generated-id-with-dates.ts` - Tests auto-generated IDs with dates
- `test-postgres-relationship-network.ts` - Tests PostgreSQL relationship network
- `quick-surreal-test.ts` - Quick SurrealDB connection test

## Usage

Most scripts can be run with:
```bash
npx tsx src/scripts/database/[script-name].ts
```

Make sure to have your database connection configured in your `.env` file.
