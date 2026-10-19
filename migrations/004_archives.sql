ALTER TABLE core_job DROP CONSTRAINT core_job_type_check;
ALTER TABLE core_job ADD CONSTRAINT core_job_type_check CHECK(type IN ('file_check','notification','prepare_archive'));
ALTER TABLE queue_control DROP CONSTRAINT queue_control_name_check;
ALTER TABLE queue_control ADD CONSTRAINT queue_control_name_check CHECK(name IN ('file_check','notification','periodic_grant','prepare_archive'));
CREATE TABLE lecture_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id text NOT NULL REFERENCES "user"(id),
  lecture_id uuid NOT NULL REFERENCES lecture(id), revision_ids uuid[] NOT NULL CHECK(cardinality(revision_ids) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','ready','failed','invalidated')),
  expires_at timestamptz NOT NULL, storage_key text UNIQUE, byte_count bigint CHECK(byte_count BETWEEN 1 AND 220200960),
  error text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
  CHECK(status<>'ready' OR (storage_key IS NOT NULL AND byte_count IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX lecture_archive_requester_created ON lecture_archive(requester_id,created_at DESC);
INSERT INTO queue_control(name,paused) VALUES('prepare_archive',false);
