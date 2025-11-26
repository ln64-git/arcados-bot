-- Migration: Add Psychological Profiling to Arcados Bot
-- Description: Adds comprehensive user psychological profiling capabilities
-- Date: 2025-01-26

-- ============================================================================
-- 1. Add psychological profile columns to members table
-- ============================================================================

-- Add three JSONB columns for flexible psychological profiling
ALTER TABLE members ADD COLUMN IF NOT EXISTS
  psych_profile JSONB DEFAULT '{}';

ALTER TABLE members ADD COLUMN IF NOT EXISTS
  behavior_patterns JSONB DEFAULT '{}';

ALTER TABLE members ADD COLUMN IF NOT EXISTS
  temporal_profile JSONB DEFAULT '{}';

-- Create GIN index for efficient JSONB queries on profile metadata
CREATE INDEX IF NOT EXISTS idx_members_psych_profile_metadata
  ON members USING GIN ((psych_profile->'profile_metadata'));

-- Create index for staleness queries (last_updated timestamp)
CREATE INDEX IF NOT EXISTS idx_members_psych_profile_last_updated
  ON members ((psych_profile->'profile_metadata'->>'last_updated'));

-- ============================================================================
-- 2. Extend relationship_edges table with directional metrics
-- ============================================================================

-- Add response hierarchy tracking
ALTER TABLE relationship_edges ADD COLUMN IF NOT EXISTS
  responded_to_count INTEGER DEFAULT 0;

ALTER TABLE relationship_edges ADD COLUMN IF NOT EXISTS
  was_responded_to_count INTEGER DEFAULT 0;

-- Add response timing metrics
ALTER TABLE relationship_edges ADD COLUMN IF NOT EXISTS
  avg_response_time_minutes FLOAT DEFAULT NULL;

-- Add attention asymmetry score (0-1, measures one-way attention seeking)
ALTER TABLE relationship_edges ADD COLUMN IF NOT EXISTS
  attention_asymmetry FLOAT DEFAULT 0;

-- Create index for response metrics queries
CREATE INDEX IF NOT EXISTS idx_relationship_edges_response_metrics
  ON relationship_edges (guild_id, responded_to_count DESC, was_responded_to_count DESC);

-- ============================================================================
-- 3. Create guild_metadata table for community structure
-- ============================================================================

CREATE TABLE IF NOT EXISTS guild_metadata (
  guild_id VARCHAR(20) PRIMARY KEY,
  community_clusters JSONB DEFAULT '[]',
  influence_rankings JSONB DEFAULT '{}',
  last_analysis TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for last_analysis lookups
CREATE INDEX IF NOT EXISTS idx_guild_metadata_last_analysis
  ON guild_metadata (last_analysis DESC);

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Schema changes summary:
-- - members: +3 JSONB columns (psych_profile, behavior_patterns, temporal_profile)
-- - members: +2 indexes (GIN on profile_metadata, btree on last_updated)
-- - relationship_edges: +4 columns (response metrics and attention asymmetry)
-- - relationship_edges: +1 index (response metrics)
-- - guild_metadata: new table with 5 columns + 1 index
