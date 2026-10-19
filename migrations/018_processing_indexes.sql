DROP INDEX file_content_check_shingles;
CREATE INDEX email_outbox_admin_pending ON email_outbox(recipient)
  WHERE sent_at IS NULL AND admin_alert_type IS NOT NULL;
