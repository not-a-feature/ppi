ALTER TABLE ppi_user ADD COLUMN last_login_at timestamptz;
ALTER TABLE ppi_user ADD COLUMN anonymized_at timestamptz;
ALTER TABLE ppi_user DROP CONSTRAINT ppi_user_status_check;
ALTER TABLE ppi_user ADD CONSTRAINT ppi_user_status_check
  CHECK(status IN ('unverified','active','suspended','deletion_pending','deleted'));

UPDATE ppi_user p SET last_login_at=activity.last_login FROM (
  SELECT user_id,max(logged_in) last_login FROM (
    SELECT actor_id user_id,created_at logged_in FROM audit_event WHERE action='auth.login'
    UNION ALL SELECT "userId","createdAt" FROM session
  ) logins GROUP BY user_id
) activity WHERE p.user_id=activity.user_id;
CREATE INDEX ppi_user_cleanup_activity ON ppi_user(last_login_at,user_id) WHERE anonymized_at IS NULL;

ALTER TABLE "user" DROP CONSTRAINT user_email_check;
ALTER TABLE "user" ADD CONSTRAINT user_email_check CHECK(
  email ~ '^zx[a-z]{3}[0-9]{2}@student[.]uni-tuebingen[.]de$' OR
  (NOT "emailVerified" AND email ~ '^deleted-[a-f0-9-]{36}@accounts[.]invalid$')
);

ALTER TABLE queue_control ADD COLUMN schedule_initialized boolean NOT NULL DEFAULT false;
ALTER TABLE queue_control DROP CONSTRAINT queue_control_name_check;
ALTER TABLE queue_control ADD CONSTRAINT queue_control_name_check CHECK(name IN
  ('file_check','notification','periodic_grant','prepare_archive','delete_files','content_check','pdf_ocr','account_cleanup'));
INSERT INTO queue_control(name) VALUES('account_cleanup');
