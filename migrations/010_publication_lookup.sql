CREATE INDEX submission_published_revision ON submission(published_revision_id)
  WHERE visibility='published' AND files_deleted_at IS NULL;
