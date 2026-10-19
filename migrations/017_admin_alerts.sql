CREATE TABLE admin_alert_recipient (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK(length(email) BETWEEN 3 AND 254 AND email=lower(trim(email))),
  job_failed boolean NOT NULL DEFAULT true,
  content_reported boolean NOT NULL DEFAULT true,
  system_error boolean NOT NULL DEFAULT true,
  protocol_uploaded boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_alert_event (
  event_key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_alert_event_created ON admin_alert_event(created_at);
ALTER TABLE email_outbox ADD COLUMN admin_alert_type text
  CHECK(admin_alert_type IN ('job_failed','content_reported','system_error','protocol_uploaded'));
