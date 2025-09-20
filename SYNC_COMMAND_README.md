# Database Sync Command

The `/sync` command provides comprehensive database synchronization capabilities to keep your Discord bot's database in sync with the current server state.

## Commands

### `/sync users [force]`
**Purpose**: Synchronize all users in the server with the database

**Options**:
- `force` (boolean, optional): Force update existing users even if they haven't changed

**What it does**:
- Creates database entries for new users
- Updates existing user data (username, roles, etc.)
- Shows progress during processing
- Reports statistics (created, updated, skipped, errors)

**Use when**:
- New users joined but weren't tracked
- User data is outdated
- After bot restarts or database issues

### `/sync roles [user]`
**Purpose**: Synchronize user roles with current server state

**Options**:
- `user` (user, optional): Specific user to sync roles for (defaults to all users)

**What it does**:
- Updates role information for users
- Ensures database roles match server roles
- Can target specific users or all users

**Use when**:
- Roles were changed outside the bot
- Role data is inconsistent
- After role management changes

### `/sync cleanup [days]`
**Purpose**: Clean up inactive users and orphaned data

**Options**:
- `days` (number, optional): Mark users inactive after this many days (default: 30)

**What it does**:
- Marks users as inactive if they haven't been seen in X days
- Removes users from database who are no longer in the server
- Cleans up orphaned data

**Use when**:
- Database has old/inactive users
- Users left the server but are still marked as active
- Regular maintenance

### `/sync stats`
**Purpose**: Show database synchronization statistics

**What it shows**:
- Server vs database user counts
- Message statistics
- Data coverage percentage
- Sync health status

**Use when**:
- Checking database health
- Before/after sync operations
- Monitoring data quality

### `/sync full [confirm]`
**Purpose**: Perform complete database synchronization

**Options**:
- `confirm` (boolean, required): Confirmation that you want to perform full sync

**What it does**:
- Syncs all users
- Updates all roles
- Cleans up inactive users
- Provides comprehensive report

**Use when**:
- Major database issues
- After bot downtime
- Complete data refresh
- **⚠️ Use with caution - this is a heavy operation**

## Usage Examples

### Basic User Sync
```
/sync users
```
Syncs all users without forcing updates.

### Force Update All Users
```
/sync users force:true
```
Forces update of all users, even if they haven't changed.

### Sync Specific User's Roles
```
/sync roles user:@username
```
Updates roles for a specific user.

### Clean Up Old Users
```
/sync cleanup days:14
```
Marks users inactive if they haven't been seen in 14 days.

### Check Database Health
```
/sync stats
```
Shows current database synchronization status.

### Full Database Sync
```
/sync full confirm:true
```
Performs complete database synchronization.

## Best Practices

### Regular Maintenance
- Run `/sync stats` weekly to check database health
- Use `/sync cleanup` monthly to remove inactive users
- Run `/sync users` after major server changes

### Before Major Operations
- Check `/sync stats` before running heavy sync operations
- Use `/sync roles` after role management changes
- Run `/sync full` only when necessary

### Troubleshooting
- If users aren't showing up in stats: `/sync users`
- If roles are wrong: `/sync roles`
- If database seems outdated: `/sync stats` then appropriate sync command

## Safety Features

### Confirmation Required
- `/sync full` requires explicit confirmation
- Progress updates during long operations
- Detailed error reporting

### Non-Destructive
- Sync operations don't delete data
- Users are marked inactive, not deleted
- All operations are logged

### Performance Optimized
- Batch operations for efficiency
- Progress updates every 25 users
- Error handling to prevent crashes

## Error Handling

The sync command includes comprehensive error handling:
- Individual user errors don't stop the entire process
- Detailed error reporting
- Graceful degradation
- Progress preservation

## Monitoring

Use `/sync stats` to monitor:
- **Coverage**: Percentage of server users in database
- **Data Quality**: Message tracking health
- **Sync Status**: Whether database needs updating

## Integration

The sync command works with:
- User tracking system
- Message tracking system
- Role management system
- Statistics and ranking system

All sync operations maintain data integrity and preserve existing relationships.
