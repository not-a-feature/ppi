CREATE TABLE content_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id text NOT NULL REFERENCES "user"(id),
  lecture_id uuid REFERENCES lecture(id), submission_id uuid REFERENCES submission(id),
  category text NOT NULL CHECK(category IN ('metadata','inappropriate','unavailable','other')),
  explanation text NOT NULL CHECK(length(explanation) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolved_by text REFERENCES "user"(id), resolution text CHECK(length(resolution) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,
  CHECK((lecture_id IS NOT NULL)::integer+(submission_id IS NOT NULL)::integer=1),
  CHECK((status='open' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL) OR
    (status='resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX content_report_status_created ON content_report(status,created_at);
CREATE TABLE reconsideration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES submission(id),
  revision_id uuid NOT NULL REFERENCES submission_revision(id), decision_id uuid NOT NULL UNIQUE REFERENCES moderation_decision(id),
  requester_id text NOT NULL REFERENCES "user"(id), explanation text NOT NULL CHECK(length(explanation) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), resolved_by text REFERENCES "user"(id),
  resolution text, created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
CREATE INDEX reconsideration_revision_open ON reconsideration(revision_id) WHERE status='open';
