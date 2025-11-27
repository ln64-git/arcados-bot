-- Migration: Centralize User Profile Data
-- Description: Creates user_profiles table as centralized source of truth for AI retrieval
--              Migrates AI-focused data from members table to user_profiles
-- Date: 2025-01-27

-- ============================================================================
-- 1. Create user_profiles table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  
  -- AI profile data
  summary TEXT,
  keywords TEXT[] DEFAULT '{}',
  emojis TEXT[] DEFAULT '{}',
  notes TEXT[] DEFAULT '{}',
  aliases TEXT[] DEFAULT '{}',
  relationship_network JSONB DEFAULT '[]',
  
  -- Psychological profiling
  psych_profile JSONB DEFAULT '{}',
  behavior_patterns JSONB DEFAULT '{}',
  temporal_profile JSONB DEFAULT '{}',
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (guild_id, user_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES members(guild_id, user_id) ON DELETE CASCADE
);

-- ============================================================================
-- 2. Create indexes for efficient AI retrieval
-- ============================================================================

-- GIN index for JSONB fields (relationship_network, psych_profile, etc.)
CREATE INDEX IF NOT EXISTS idx_user_profiles_relationship_network
  ON user_profiles USING GIN (relationship_network);

CREATE INDEX IF NOT EXISTS idx_user_profiles_psych_profile
  ON user_profiles USING GIN (psych_profile);

CREATE INDEX IF NOT EXISTS idx_user_profiles_behavior_patterns
  ON user_profiles USING GIN (behavior_patterns);

CREATE INDEX IF NOT EXISTS idx_user_profiles_temporal_profile
  ON user_profiles USING GIN (temporal_profile);

-- GIN index for psych_profile metadata queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_psych_profile_metadata
  ON user_profiles USING GIN ((psych_profile->'profile_metadata'));

-- Index for staleness queries (last_updated timestamp)
CREATE INDEX IF NOT EXISTS idx_user_profiles_psych_profile_last_updated
  ON user_profiles ((psych_profile->'profile_metadata'->>'last_updated'));

-- GIN index for array fields (keywords, emojis, notes, aliases)
CREATE INDEX IF NOT EXISTS idx_user_profiles_keywords
  ON user_profiles USING GIN (keywords);

CREATE INDEX IF NOT EXISTS idx_user_profiles_emojis
  ON user_profiles USING GIN (emojis);

CREATE INDEX IF NOT EXISTS idx_user_profiles_notes
  ON user_profiles USING GIN (notes);

CREATE INDEX IF NOT EXISTS idx_user_profiles_aliases
  ON user_profiles USING GIN (aliases);

-- Index for text search on summary
CREATE INDEX IF NOT EXISTS idx_user_profiles_summary
  ON user_profiles USING gin(to_tsvector('english', COALESCE(summary, '')));

-- Index for guild_id and user_id lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_guild_id
  ON user_profiles (guild_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id
  ON user_profiles (user_id);

-- ============================================================================
-- 3. Migrate existing data from members table
-- ============================================================================

-- Insert existing profile data from members table into user_profiles
-- Only insert rows where at least one AI profile field has data
INSERT INTO user_profiles (
  guild_id,
  user_id,
  summary,
  keywords,
  emojis,
  notes,
  aliases,
  relationship_network,
  psych_profile,
  behavior_patterns,
  temporal_profile,
  created_at,
  updated_at
)
SELECT 
  guild_id,
  user_id,
  summary,
  COALESCE(keywords, '{}'),
  COALESCE(emojis, '{}'),
  COALESCE(notes, '{}'),
  '{}'::TEXT[] as aliases, -- Initialize aliases as empty array
  COALESCE(relationship_network, '[]'::JSONB),
  COALESCE(psych_profile, '{}'::JSONB),
  COALESCE(behavior_patterns, '{}'::JSONB),
  COALESCE(temporal_profile, '{}'::JSONB),
  created_at,
  updated_at
FROM members
WHERE 
  summary IS NOT NULL
  OR keywords IS NOT NULL AND array_length(keywords, 1) > 0
  OR emojis IS NOT NULL AND array_length(emojis, 1) > 0
  OR notes IS NOT NULL AND array_length(notes, 1) > 0
  OR relationship_network IS NOT NULL AND relationship_network != '[]'::JSONB
  OR psych_profile IS NOT NULL AND psych_profile != '{}'::JSONB
  OR behavior_patterns IS NOT NULL AND behavior_patterns != '{}'::JSONB
  OR temporal_profile IS NOT NULL AND temporal_profile != '{}'::JSONB
ON CONFLICT (guild_id, user_id) DO UPDATE SET
  summary = EXCLUDED.summary,
  keywords = EXCLUDED.keywords,
  emojis = EXCLUDED.emojis,
  notes = EXCLUDED.notes,
  relationship_network = EXCLUDED.relationship_network,
  psych_profile = EXCLUDED.psych_profile,
  behavior_patterns = EXCLUDED.behavior_patterns,
  temporal_profile = EXCLUDED.temporal_profile,
  updated_at = EXCLUDED.updated_at;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Schema changes summary:
-- - user_profiles: new table with AI profile data (summary, keywords, emojis, notes, aliases, relationship_network, psych_profile, behavior_patterns, temporal_profile)
-- - user_profiles: +12 indexes (GIN on JSONB fields, GIN on arrays, text search on summary, lookup indexes)
-- - Data migrated from members table to user_profiles
-- - Foreign key constraint ensures data integrity with members table

