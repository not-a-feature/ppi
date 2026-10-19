CREATE TABLE file_content_check (
  file_id uuid PRIMARY KEY REFERENCES stored_file(id),
  generation integer NOT NULL,
  status text NOT NULL CHECK(status IN ('ready','unavailable','failed')),
  reason text NOT NULL DEFAULT '',
  word_count integer NOT NULL DEFAULT 0,
  page_count integer,
  textless_pages integer NOT NULL DEFAULT 0,
  repeated_fraction double precision NOT NULL DEFAULT 0,
  text_hash text NOT NULL DEFAULT '',
  shingles text[] NOT NULL DEFAULT '{}',
  similar_matches jsonb NOT NULL DEFAULT '[]',
  compared_files integer NOT NULL DEFAULT 0,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_content_check_shingles ON file_content_check USING gin(shingles);
CREATE INDEX file_content_check_text_hash ON file_content_check(text_hash) WHERE text_hash<>'';
ALTER TABLE core_job DROP CONSTRAINT core_job_type_check;
ALTER TABLE core_job ADD CONSTRAINT core_job_type_check CHECK(type IN ('file_check','notification','prepare_archive','delete_files','content_check'));
ALTER TABLE queue_control DROP CONSTRAINT queue_control_name_check;
ALTER TABLE queue_control ADD CONSTRAINT queue_control_name_check CHECK(name IN ('file_check','notification','periodic_grant','prepare_archive','delete_files','content_check'));
INSERT INTO queue_control(name) VALUES('content_check');
INSERT INTO core_job(type,business_key,payload)
  SELECT 'content_check','content_check:'||f.id||':'||f.safety_generation,
    jsonb_build_object('fileId',f.id,'generation',f.safety_generation)
  FROM stored_file f WHERE f.safety_status='clean' AND f.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM submission_revision r JOIN submission s ON s.id=r.submission_id
      WHERE r.file_id=f.id AND s.files_deleted_at IS NULL);
