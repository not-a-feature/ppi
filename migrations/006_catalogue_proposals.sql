ALTER TABLE lecture ADD COLUMN approval_status text NOT NULL DEFAULT 'approved'
  CHECK(approval_status IN ('approved','pending','rejected'));
ALTER TABLE lecture ADD COLUMN proposed_by text REFERENCES "user"(id);
CREATE TABLE lecture_proposer (
  lecture_id uuid NOT NULL REFERENCES lecture(id), user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(lecture_id,user_id)
);
CREATE INDEX lecture_proposer_user ON lecture_proposer(user_id,lecture_id);
ALTER TABLE submission ADD COLUMN files_deleted_at timestamptz;
ALTER TABLE stored_file ADD COLUMN deleted_at timestamptz;
ALTER TABLE core_job DROP CONSTRAINT core_job_type_check;
ALTER TABLE core_job ADD CONSTRAINT core_job_type_check CHECK(type IN ('file_check','notification','prepare_archive','delete_files'));
ALTER TABLE queue_control DROP CONSTRAINT queue_control_name_check;
ALTER TABLE queue_control ADD CONSTRAINT queue_control_name_check CHECK(name IN ('file_check','notification','periodic_grant','prepare_archive','delete_files'));
INSERT INTO queue_control(name,paused) VALUES('delete_files',false);
