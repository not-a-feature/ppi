CREATE TABLE lecture_examiner (
  lecture_id uuid NOT NULL REFERENCES lecture(id),
  examiner_id uuid NOT NULL REFERENCES examiner(id),
  linked_by text REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(lecture_id,examiner_id)
);
CREATE INDEX lecture_examiner_examiner ON lecture_examiner(examiner_id,lecture_id);
INSERT INTO lecture_examiner(lecture_id,examiner_id)
SELECT DISTINCT rl.lecture_id,r.examiner_id FROM revision_lecture rl
JOIN submission_revision r ON r.id=rl.revision_id WHERE r.examiner_id IS NOT NULL;
