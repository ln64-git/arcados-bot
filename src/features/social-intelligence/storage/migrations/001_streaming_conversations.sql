-- Migration: Add streaming_conversations table for real-time conversation tracking
-- Purpose: Allow AI tools to query active (not yet finalized) conversations immediately
-- Created: 2025-11-15

-- Create streaming_conversations table
CREATE TABLE IF NOT EXISTS streaming_conversations (
  id VARCHAR(50) PRIMARY KEY,
  guild_id VARCHAR(50) NOT NULL,
  channel_id VARCHAR(50) NOT NULL,
  participants TEXT[] NOT NULL DEFAULT '{}',
  message_ids TEXT[] NOT NULL DEFAULT '{}',
  message_count INTEGER NOT NULL DEFAULT 0,
  start_time TIMESTAMP NOT NULL,
  last_activity TIMESTAMP NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',

  -- Preliminary analysis (updated incrementally)
  preliminary_keywords JSONB DEFAULT '[]',
  preliminary_embedding FLOAT[] DEFAULT NULL,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Foreign keys
  FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_streaming_conversations_guild
  ON streaming_conversations(guild_id);

CREATE INDEX IF NOT EXISTS idx_streaming_conversations_channel
  ON streaming_conversations(channel_id);

CREATE INDEX IF NOT EXISTS idx_streaming_conversations_participants
  ON streaming_conversations USING GIN(participants);

CREATE INDEX IF NOT EXISTS idx_streaming_conversations_status
  ON streaming_conversations(status);

CREATE INDEX IF NOT EXISTS idx_streaming_conversations_last_activity
  ON streaming_conversations(last_activity);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_streaming_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER streaming_conversations_updated_at
  BEFORE UPDATE ON streaming_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_streaming_conversations_updated_at();

-- Create live relationship view that prioritizes fresh data
CREATE OR REPLACE VIEW relationship_network_live AS
SELECT
  m.id,
  m.guild_id,
  m.user_id,
  m.username,
  m.display_name,
  -- Use fresh raw edges if modified in last 30 seconds, else use cached JSONB
  CASE
    WHEN EXISTS (
      SELECT 1 FROM relationship_edges e
      WHERE e.guild_id = m.guild_id
        AND (e.user_a = m.user_id OR e.user_b = m.user_id)
        AND e.last_interaction > NOW() - INTERVAL '30 seconds'
    ) THEN
      -- Fresh data: rebuild relationship network from raw edges
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'user_id', CASE WHEN e.user_a = m.user_id THEN e.user_b ELSE e.user_a END,
            'raw_points',
              CASE WHEN e.user_a = m.user_id THEN
                e.msg_a_to_b + (e.mentions * 2) + (e.replies * 3) + e.reactions
              ELSE
                e.msg_b_to_a + (e.mentions * 2) + (e.replies * 3) + e.reactions
              END,
            'last_interaction', e.last_interaction,
            'is_live', true
          )
        )
        FROM relationship_edges e
        WHERE e.guild_id = m.guild_id
          AND (e.user_a = m.user_id OR e.user_b = m.user_id)
          AND e.last_interaction > NOW() - INTERVAL '7 days'
      )
    ELSE
      -- Cached data: use pre-computed JSONB
      m.relationship_network
  END as relationship_network,
  -- Flag to indicate if data is live (for debugging)
  EXISTS (
    SELECT 1 FROM relationship_edges e
    WHERE e.guild_id = m.guild_id
      AND (e.user_a = m.user_id OR e.user_b = m.user_id)
      AND e.last_interaction > NOW() - INTERVAL '30 seconds'
  ) as is_live_data
FROM members m
WHERE m.active = true;

-- Create combined conversations view (streaming + finalized)
CREATE OR REPLACE VIEW conversations_unified AS
SELECT
  id,
  guild_id,
  channel_id,
  participants,
  message_ids,
  message_count,
  start_time,
  last_activity as end_time,
  'active' as status,
  preliminary_keywords as keywords,
  preliminary_embedding as embedding,
  NULL::TEXT as topic_label,
  NULL::FLOAT as topic_confidence,
  NULL::JSONB as features,
  NULL::TEXT as summary,
  true as is_streaming
FROM streaming_conversations
WHERE status = 'active'

UNION ALL

SELECT
  id,
  guild_id,
  channel_id,
  participants,
  message_ids,
  message_count,
  start_time,
  end_time,
  status,
  (features->>'keywords')::JSONB as keywords,
  NULL::FLOAT[] as embedding,
  topic_label,
  topic_confidence,
  features,
  summary,
  false as is_streaming
FROM conversation_segments
WHERE status = 'finalized';

-- Comments for documentation
COMMENT ON TABLE streaming_conversations IS 'Real-time active conversations (not yet finalized). Allows AI tools to query conversations immediately without waiting for 10-min finalization timeout.';
COMMENT ON VIEW relationship_network_live IS 'Live relationship view that prioritizes fresh raw edges over cached JSONB. Eliminates 30-second lag for AI tools.';
COMMENT ON VIEW conversations_unified IS 'Unified view of both streaming (active) and finalized conversations. AI tools should query this view instead of conversation_segments directly.';
