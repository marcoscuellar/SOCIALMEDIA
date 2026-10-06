-- Launch Room multi-brand schema. Statements are separated by lines containing only "-- @@".
-- Idempotent and non-destructive: it never touches the legacy launch_workspace table.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at text NOT NULL
);
-- @@
CREATE TABLE IF NOT EXISTS voice_profiles (
  id text PRIMARY KEY,
  kind text NOT NULL DEFAULT 'founder',
  name text NOT NULL,
  guidelines text NOT NULL DEFAULT '',
  preferred text NOT NULL DEFAULT '',
  avoid text NOT NULL DEFAULT '',
  examples text NOT NULL DEFAULT '',
  voice_hash text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  revision integer NOT NULL DEFAULT 1,
  updated_at text NOT NULL
);
-- @@
CREATE TABLE IF NOT EXISTS brands (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  profile jsonb NOT NULL,
  voice_hash text NOT NULL DEFAULT '',
  style_hash text NOT NULL DEFAULT '',
  voice_version integer NOT NULL DEFAULT 1,
  style_version integer NOT NULL DEFAULT 1,
  revision integer NOT NULL DEFAULT 1,
  note text NOT NULL DEFAULT '',
  last_post_id text,
  last_step integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
-- @@
CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id),
  legacy_id text,
  title text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT '',
  scheduled_date text CHECK (scheduled_date IS NULL OR scheduled_date ~ '^\d{4}-\d{2}-\d{2}$'),
  voice_mode text NOT NULL DEFAULT 'brand' CHECK (voice_mode IN ('brand','founder','both')),
  linkedin text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT '',
  graphic jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved boolean NOT NULL DEFAULT false,
  approved_at text,
  approved_voice_key text,
  image_ready boolean NOT NULL DEFAULT false,
  image_ready_at text,
  image_style_version integer,
  posted_linkedin_at text,
  posted_instagram_at text,
  paused boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  ai_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_questions jsonb NOT NULL DEFAULT '{}'::jsonb,
  caption_history jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK (NOT image_ready OR approved)
);
-- @@
CREATE UNIQUE INDEX IF NOT EXISTS posts_brand_legacy ON posts (brand_id, legacy_id) WHERE legacy_id IS NOT NULL;
-- @@
CREATE INDEX IF NOT EXISTS posts_brand_date ON posts (brand_id, scheduled_date);
-- @@
CREATE TABLE IF NOT EXISTS post_reviews (
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin','instagram')),
  brand_id text NOT NULL REFERENCES brands(id),
  caption text NOT NULL,
  voice_mode text NOT NULL,
  brand_voice_version integer,
  founder_voice_version integer,
  run_id text,
  result jsonb NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (post_id, platform)
);
-- @@
CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id),
  post_id text REFERENCES posts(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'attachment' CHECK (role IN ('attachment','reference','logo','logo_dark','font')),
  name text NOT NULL,
  size integer NOT NULL,
  type text NOT NULL,
  sha256 text NOT NULL,
  blob_key text NOT NULL,
  legacy_id text,
  created_at text NOT NULL
);
-- @@
CREATE INDEX IF NOT EXISTS files_brand ON files (brand_id, post_id);
-- @@
CREATE TABLE IF NOT EXISTS excerpts (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id),
  post_id text REFERENCES posts(id) ON DELETE CASCADE,
  label text NOT NULL,
  body text NOT NULL,
  body_hash text NOT NULL,
  source_file_id text,
  created_at text NOT NULL
);
-- @@
CREATE TABLE IF NOT EXISTS post_events (
  id bigserial PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id),
  post_id text NOT NULL,
  type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at text NOT NULL
);
-- @@
CREATE INDEX IF NOT EXISTS post_events_brand ON post_events (brand_id, at);
-- @@
CREATE TABLE IF NOT EXISTS ai_budget (
  id integer PRIMARY KEY CHECK (id = 1),
  day text NOT NULL DEFAULT '',
  day_count integer NOT NULL DEFAULT 0,
  month text NOT NULL DEFAULT '',
  month_micros integer NOT NULL DEFAULT 0
);
-- @@
INSERT INTO ai_budget (id) VALUES (1) ON CONFLICT DO NOTHING;
-- @@
CREATE TABLE IF NOT EXISTS ai_runs (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id),
  post_id text,
  platform text,
  cache_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','reserved','done','failed','uncertain','rejected','imported')),
  reserved_micros integer NOT NULL DEFAULT 0,
  cost_micros integer NOT NULL DEFAULT 0,
  day text NOT NULL,
  month text NOT NULL,
  model text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  error text,
  started_at text NOT NULL,
  finished_at text
);
-- @@
CREATE UNIQUE INDEX IF NOT EXISTS ai_runs_live_key ON ai_runs (cache_key) WHERE status IN ('pending','reserved','done');
-- @@
CREATE INDEX IF NOT EXISTS ai_runs_brand_month ON ai_runs (brand_id, month);
-- @@
INSERT INTO schema_migrations (version, applied_at) VALUES ('001_init', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')) ON CONFLICT DO NOTHING;
