-- Migration: Add Enrichment Tracking Infrastructure
-- Description: Add enrichment tracking columns to existing tables and create relationship_profiles table
-- Date: 2025-11-26

-- ============================================================================
-- Layer 1: Conversation Enrichment Tracking
-- ============================================================================

-- Add enrichment tracking columns to conversation_segments
ALTER TABLE conversation_segments
  ADD COLUMN IF NOT EXISTS enrichment_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS enrichment_confidence FLOAT,
  ADD COLUMN IF NOT EXISTS enrichment_error TEXT,
  ADD COLUMN IF NOT EXISTS significance_score FLOAT;

-- Create index for querying pending enrichments
CREATE INDEX IF NOT EXISTS idx_conversation_segments_enrichment_pending
  ON conversation_segments(guild_id, ai_processing_status)
  WHERE ai_processing_status = 'pending';

-- Create index for enrichment staleness queries
CREATE INDEX IF NOT EXISTS idx_conversation_segments_last_enriched
  ON conversation_segments(guild_id, last_enriched_at);

-- ============================================================================
-- Layer 2: User Profile Enrichment Tracking
-- ============================================================================

-- Add enrichment tracking columns to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_enriched_conversation_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_enriched_conversation_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS profile_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS enrichment_history JSONB DEFAULT '[]'::jsonb;

-- Create index for conversation-based staleness detection
CREATE INDEX IF NOT EXISTS idx_user_profiles_conversation_staleness
  ON user_profiles(guild_id, last_enriched_conversation_count);

-- Create index for profile version tracking (for cascade triggers)
CREATE INDEX IF NOT EXISTS idx_user_profiles_version
  ON user_profiles(guild_id, user_id, profile_version);

-- ============================================================================
-- Layer 3: Relationship Profile Enrichment (NEW TABLE)
-- ============================================================================

-- Create relationship_profiles table
CREATE TABLE IF NOT EXISTS relationship_profiles (
  guild_id VARCHAR(20) NOT NULL,
  user_a VARCHAR(20) NOT NULL,
  user_b VARCHAR(20) NOT NULL,

  -- Enriched fields
  summary TEXT,
  keywords TEXT[],
  emojis TEXT[],
  relationship_type VARCHAR(50),

  -- Conversation context tracking (for incremental updates)
  shared_conversations INTEGER DEFAULT 0,
  recent_conversation_ids TEXT[],
  last_enriched_conversation_count INTEGER DEFAULT 0,

  -- User profile version tracking (for cascade triggers)
  user_a_profile_version INTEGER DEFAULT 0,
  user_b_profile_version INTEGER DEFAULT 0,

  -- Incremental enrichment
  enrichment_history JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  enrichment_confidence FLOAT,
  last_enriched_at TIMESTAMP,
  enrichment_version INTEGER DEFAULT 1,
  enrichment_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  PRIMARY KEY (guild_id, user_a, user_b),

  -- Foreign key constraints (commented out - guilds table may not exist or have different structure)
  -- CONSTRAINT fk_relationship_profiles_guild
  --   FOREIGN KEY (guild_id)
  --   REFERENCES guilds(guild_id)
  --   ON DELETE CASCADE,

  -- Ensure user_a < user_b to prevent duplicate relationships
  CONSTRAINT check_user_order CHECK (user_a < user_b)
);

-- Create indexes for relationship_profiles
CREATE INDEX IF NOT EXISTS idx_relationship_profiles_last_enriched
  ON relationship_profiles(guild_id, last_enriched_at);

CREATE INDEX IF NOT EXISTS idx_relationship_profiles_versions
  ON relationship_profiles(guild_id, user_a_profile_version, user_b_profile_version);

CREATE INDEX IF NOT EXISTS idx_relationship_profiles_keywords
  ON relationship_profiles USING GIN(keywords);

CREATE INDEX IF NOT EXISTS idx_relationship_profiles_conversation_count
  ON relationship_profiles(guild_id, last_enriched_conversation_count);

-- ============================================================================
-- Layer 4: Server Summary Enrichment Tracking
-- ============================================================================

-- Add enrichment tracking columns to guild_metadata
ALTER TABLE guild_metadata
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS top_topics JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS community_health_score FLOAT,
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_enriched_relationship_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrichment_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS enrichment_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_error TEXT;

-- Create index for guild enrichment staleness
CREATE INDEX IF NOT EXISTS idx_guild_metadata_last_enriched
  ON guild_metadata(guild_id, last_enriched_at);

-- ============================================================================
-- Utility Functions
-- ============================================================================

-- Function to normalize user pairs (ensure user_a < user_b)
CREATE OR REPLACE FUNCTION normalize_user_pair(
  p_user_a VARCHAR(20),
  p_user_b VARCHAR(20)
) RETURNS TABLE(user_a VARCHAR(20), user_b VARCHAR(20)) AS $$
BEGIN
  IF p_user_a < p_user_b THEN
    RETURN QUERY SELECT p_user_a, p_user_b;
  ELSE
    RETURN QUERY SELECT p_user_b, p_user_a;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update updated_at timestamp on relationship_profiles
CREATE OR REPLACE FUNCTION update_relationship_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_relationship_profiles_updated_at
BEFORE UPDATE ON relationship_profiles
FOR EACH ROW
EXECUTE FUNCTION update_relationship_profiles_updated_at();

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Add comment to track migration version
COMMENT ON TABLE relationship_profiles IS 'Enrichment tracking migration v1.0 - 2025-11-26';
