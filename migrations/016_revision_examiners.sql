CREATE TABLE revision_examiner (
  revision_id uuid NOT NULL REFERENCES submission_revision(id),
  examiner_id uuid NOT NULL REFERENCES examiner(id),
  position smallint NOT NULL CHECK(position > 0),
  PRIMARY KEY(revision_id,examiner_id),
  UNIQUE(revision_id,position)
);
CREATE INDEX revision_examiner_examiner ON revision_examiner(examiner_id);
INSERT INTO revision_examiner(revision_id,examiner_id,position)
SELECT id,examiner_id,1 FROM submission_revision WHERE examiner_id IS NOT NULL;
