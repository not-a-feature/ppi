CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
  sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE queue_control (
  name text PRIMARY KEY CHECK(name IN ('file_check','notification','periodic_grant')),
  paused boolean NOT NULL DEFAULT false
);
INSERT INTO queue_control(name) VALUES ('file_check'),('notification'),('periodic_grant');
CREATE TABLE worker_heartbeat (
  id text PRIMARY KEY, last_seen timestamptz NOT NULL DEFAULT now()
);
