CREATE TABLE ppi_user (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE RESTRICT,
  is_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','active','suspended','deletion_pending')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE policy (
  version integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activation integer NOT NULL CHECK (activation >= 0),
  base_reward integer NOT NULL CHECK (base_reward >= 0),
  excellent_reward integer NOT NULL CHECK (excellent_reward >= base_reward),
  sharing text NOT NULL CHECK (sharing IN ('equal_ceil','uploader_only')),
  lecture_cost integer NOT NULL CHECK (lecture_cost >= 0),
  access_weeks integer NOT NULL CHECK (access_weeks BETWEEN 1 AND 104),
  periodic_grant integer NOT NULL CHECK (periodic_grant >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO policy(activation,base_reward,excellent_reward,sharing,lecture_cost,access_weeks,periodic_grant)
VALUES (5,3,6,'equal_ceil',1,4,2);
CREATE TABLE credit_account (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE RESTRICT,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0)
);
CREATE TABLE credit_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES credit_account(user_id),
  amount integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('activation','contribution','purchase','periodic_grant','manual_adjustment','legacy_opening')),
  business_key text NOT NULL UNIQUE,
  policy_version integer NOT NULL REFERENCES policy(version),
  actor_id text REFERENCES "user"(id),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION prevent_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History records are immutable'; END $$;
CREATE TRIGGER credit_entry_immutable BEFORE UPDATE OR DELETE ON credit_entry
FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TABLE lecture (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  normalized_name text NOT NULL UNIQUE, aliases text[] NOT NULL DEFAULT '{}',
  archived boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1
);
CREATE TABLE examiner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  normalized_name text NOT NULL UNIQUE, aliases text[] NOT NULL DEFAULT '{}',
  archived boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1
);
CREATE TABLE stored_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), byte_count integer NOT NULL CHECK(byte_count BETWEEN 1 AND 4194304),
  media_type text NOT NULL CHECK(media_type IN ('application/pdf','text/plain')),
  original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255),
  safety_status text NOT NULL DEFAULT 'pending' CHECK(safety_status IN ('pending','clean','blocked','failed')),
  safety_generation integer NOT NULL DEFAULT 1,
  safety_detail text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stored_file_sha256 ON stored_file(sha256);
CREATE TABLE submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uploader_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  current_revision_id uuid, published_revision_id uuid,
  review_state text NOT NULL DEFAULT 'processing' CHECK(review_state IN ('processing','awaiting_review','accepted','rejected','changes_requested')),
  visibility text NOT NULL DEFAULT 'unpublished' CHECK(visibility IN ('unpublished','published','withdrawn')),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE submission_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES submission(id),
  revision_number integer NOT NULL CHECK(revision_number > 0), file_id uuid NOT NULL REFERENCES stored_file(id),
  examiner_id uuid REFERENCES examiner(id), exam_date date, term text CHECK(length(term) <= 100),
  remarks text NOT NULL CHECK(length(remarks) <= 2000), attested boolean NOT NULL CHECK(attested),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(submission_id,revision_number), UNIQUE(submission_id,id)
);
ALTER TABLE submission ADD CONSTRAINT current_revision_submission_fk FOREIGN KEY(id,current_revision_id) REFERENCES submission_revision(submission_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE submission ADD CONSTRAINT published_revision_submission_fk FOREIGN KEY(id,published_revision_id) REFERENCES submission_revision(submission_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON submission_revision FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TABLE revision_lecture (
  revision_id uuid NOT NULL REFERENCES submission_revision(id), lecture_id uuid NOT NULL REFERENCES lecture(id), PRIMARY KEY(revision_id,lecture_id)
);
CREATE TABLE contributor_claim (
  revision_id uuid NOT NULL REFERENCES submission_revision(id), zx text NOT NULL CHECK(zx ~ '^zx[a-z]{3}[0-9]{2}$'), PRIMARY KEY(revision_id,zx)
);
CREATE TABLE moderation_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision_id uuid NOT NULL REFERENCES submission_revision(id),
  actor_id text NOT NULL REFERENCES "user"(id), outcome text NOT NULL CHECK(outcome IN ('accepted','rejected','changes_requested','withdrawn')),
  public_feedback text NOT NULL CHECK(length(public_feedback) BETWEEN 1 AND 4000), internal_note text NOT NULL DEFAULT '' CHECK(length(internal_note) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER decision_immutable BEFORE UPDATE OR DELETE ON moderation_decision FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TABLE reward_allocation (
  submission_id uuid PRIMARY KEY REFERENCES submission(id), revision_id uuid NOT NULL REFERENCES submission_revision(id),
  policy_version integer NOT NULL REFERENCES policy(version), nominal_amount integer NOT NULL CHECK(nominal_amount >= 0),
  sharing text NOT NULL, approved_by text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reward_recipient (
  submission_id uuid NOT NULL REFERENCES reward_allocation(submission_id), user_id text NOT NULL REFERENCES "user"(id),
  amount integer NOT NULL CHECK(amount >= 0), PRIMARY KEY(submission_id,user_id)
);
CREATE TABLE lecture_access (
  user_id text NOT NULL REFERENCES "user"(id), lecture_id uuid NOT NULL REFERENCES lecture(id),
  starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, policy_version integer NOT NULL REFERENCES policy(version),
  PRIMARY KEY(user_id,lecture_id), CHECK(expires_at > starts_at)
);
CREATE TABLE mutation_receipt (
  actor_id text NOT NULL REFERENCES "user"(id), operation text NOT NULL, request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200),
  fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(actor_id,operation,request_key)
);
CREATE TABLE core_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL CHECK(type IN ('file_check','notification')),
  business_key text NOT NULL UNIQUE, dispatched_at timestamptz,
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0, error text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES "user"(id),
  event_key text NOT NULL UNIQUE, subject text NOT NULL, message text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text REFERENCES "user"(id), action text NOT NULL,
  entity_id text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE grant_run (
  period text PRIMARY KEY CHECK(length(period) BETWEEN 1 AND 100), policy_version integer NOT NULL REFERENCES policy(version),
  amount integer NOT NULL CHECK(amount >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE grant_recipient (
  period text NOT NULL REFERENCES grant_run(period), user_id text NOT NULL REFERENCES "user"(id),
  processed_at timestamptz, PRIMARY KEY(period,user_id)
);
CREATE TABLE token_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES "user"(id),
  explanation text NOT NULL CHECK(length(explanation) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','granted','denied')), amount integer CHECK(amount >= 0),
  resolved_by text REFERENCES "user"(id), reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_entry_user_created ON credit_entry(user_id,created_at DESC);
CREATE INDEX submission_uploader_created ON submission(uploader_id,created_at DESC);
CREATE INDEX submission_review_state ON submission(review_state,created_at);
CREATE INDEX submission_revision_file ON submission_revision(file_id);
CREATE INDEX revision_lecture_lecture ON revision_lecture(lecture_id,revision_id);
CREATE INDEX core_job_undispatched ON core_job(created_at) WHERE dispatched_at IS NULL;
CREATE INDEX notification_user_created ON notification(user_id,created_at DESC);
CREATE INDEX grant_recipient_pending ON grant_recipient(period,user_id) WHERE processed_at IS NULL;
