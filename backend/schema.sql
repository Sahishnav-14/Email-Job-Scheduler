CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled campaign',
  recipient_email TEXT,
  from_email TEXT NOT NULL DEFAULT 'no-reply@reachinbox.test',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  job_id TEXT,
  preview_url TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaigns'
      AND column_name = 'id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE campaigns ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE campaigns
      ALTER COLUMN id TYPE TEXT USING id::text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'queued',
  job_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Untitled campaign';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recipient_email TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS from_email TEXT NOT NULL DEFAULT 'no-reply@reachinbox.test';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recipient_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS preview_url TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS job_id TEXT;

CREATE INDEX IF NOT EXISTS schedules_campaign_id_idx
  ON schedules(campaign_id);

CREATE INDEX IF NOT EXISTS schedules_due_idx
  ON schedules(scheduled_for)
  WHERE status IN ('queued', 'scheduled');
CREATE TABLE IF NOT EXISTS slack_connections (
  id TEXT PRIMARY KEY,
  google_id TEXT NOT NULL UNIQUE,
  slack_user_id TEXT,
  access_token TEXT NOT NULL,
  team_id TEXT,
  team_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);