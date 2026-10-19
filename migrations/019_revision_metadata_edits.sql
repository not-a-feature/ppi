CREATE OR REPLACE FUNCTION prevent_revision_metadata_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'History records are immutable';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['examiner_id','exam_date','term','remarks'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['examiner_id','exam_date','term','remarks']) THEN
    RAISE EXCEPTION 'Revision identity and file fields are immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER revision_immutable ON submission_revision;
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON submission_revision
FOR EACH ROW EXECUTE FUNCTION prevent_revision_metadata_mutation();
