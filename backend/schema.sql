-- SaveKidsFromBrainRot D1 schema. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token TEXT UNIQUE,
  paired_at INTEGER,
  last_seen_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,   -- sha256 of the raw key; raw key shown once
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS password_resets (
  family_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Note: paused_until and weekend_criteria were added later; existing
-- deployments migrate via
--   ALTER TABLE policies ADD COLUMN paused_until INTEGER;
--   ALTER TABLE policies ADD COLUMN weekend_criteria TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS policies (
  family_id TEXT PRIMARY KEY,
  criteria TEXT NOT NULL DEFAULT '',           -- week / default criteria
  weekend_criteria TEXT NOT NULL DEFAULT '',   -- '' = same rules all week
  settings_json TEXT NOT NULL DEFAULT '{}',
  paused_until INTEGER,        -- epoch ms: all viewing blocked until then
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS overrides (
  family_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'channel' | 'video'
  target_id TEXT NOT NULL,
  decision TEXT NOT NULL,      -- 'allow' | 'block'
  note TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, kind, target_id)
);

-- Verdict caches are scoped per criteria mode ('week' | 'weekend') so a
-- schedule flip never invalidates anything — both caches stay warm.
-- These tables are pure caches: migrating older deployments is just
-- DROP TABLE + re-running this file.
CREATE TABLE IF NOT EXISTS channel_verdicts (
  family_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'week',
  channel_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  confidence REAL NOT NULL,
  reason TEXT NOT NULL,
  evaluated_at INTEGER NOT NULL,
  meta_json TEXT,
  PRIMARY KEY (family_id, mode, channel_id)
);

CREATE TABLE IF NOT EXISTS video_verdicts (
  family_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'week',
  video_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  confidence REAL NOT NULL,
  reason TEXT NOT NULL,
  evaluated_at INTEGER NOT NULL,
  meta_json TEXT,
  PRIMARY KEY (family_id, mode, video_id)
);

CREATE TABLE IF NOT EXISTS review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'channel' | 'video'
  target_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,        -- 'ai_unsure' | 'ai_block' | 'kid_request'
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_family_status ON review_items (family_id, status);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  title TEXT,
  detail_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_family_time ON events (family_id, created_at DESC);
