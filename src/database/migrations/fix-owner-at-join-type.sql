-- ============================================================================
-- Fix owner_at_join Column Type
-- ============================================================================
-- 
-- Issue: owner_at_join was defined as BOOLEAN but the code stores user IDs (strings)
-- Fix: Change column type from BOOLEAN to VARCHAR(20) to store user IDs
--
-- ============================================================================

-- Change owner_at_join from BOOLEAN to VARCHAR(20)
-- Since we can't recover user IDs from boolean values, set all existing values to NULL
ALTER TABLE voice_sessions 
  ALTER COLUMN owner_at_join TYPE VARCHAR(20) USING NULL;

-- Set default to NULL instead of false
ALTER TABLE voice_sessions 
  ALTER COLUMN owner_at_join SET DEFAULT NULL;

-- ============================================================================
-- Migration Complete
-- ============================================================================
--
-- Schema changes:
-- - owner_at_join: Changed from BOOLEAN DEFAULT false to VARCHAR(20) DEFAULT NULL
-- - Now stores the user ID of the channel owner at the time of join
-- - NULL means no owner or owner not tracked

