CREATE TABLE pdf_derivative (
  file_id uuid NOT NULL REFERENCES stored_file(id),
  generation integer NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','ready','partial','skipped','failed')),
  pages integer[] NOT NULL DEFAULT '{}',
  storage_key text UNIQUE,
  sha256 text,
  byte_count integer,
  error text NOT NULL DEFAULT '',
  processed_at timestamptz,
  PRIMARY KEY(file_id,generation)
);
ALTER TABLE core_job DROP CONSTRAINT core_job_type_check;
ALTER TABLE core_job ADD CONSTRAINT core_job_type_check CHECK(type IN ('file_check','notification','prepare_archive','delete_files','content_check','pdf_ocr'));
ALTER TABLE queue_control DROP CONSTRAINT queue_control_name_check;
ALTER TABLE queue_control ADD CONSTRAINT queue_control_name_check CHECK(name IN ('file_check','notification','periodic_grant','prepare_archive','delete_files','content_check','pdf_ocr'));
INSERT INTO queue_control(name) VALUES('pdf_ocr');
INSERT INTO core_job(type,business_key,payload)
  SELECT 'content_check','content_check:ocr-detection:'||id||':'||safety_generation,
    jsonb_build_object('fileId',id,'generation',safety_generation)
  FROM stored_file WHERE media_type='application/pdf' AND safety_status='clean' AND deleted_at IS NULL;
ALTER TABLE lecture_archive ADD COLUMN watermark_day date;
UPDATE lecture_archive SET status='invalidated',error='Download watermark changed. Please prepare a new archive.'
  WHERE status IN ('queued','ready','failed');
