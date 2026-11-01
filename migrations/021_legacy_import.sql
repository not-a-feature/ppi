-- Source mappings survive retries and later additive imports. Older local rehearsals
-- created the same table directly; keep those mappings when upgrading.
CREATE TABLE IF NOT EXISTS legacy_import_map (
  kind text NOT NULL CHECK(kind IN ('user','lecture','protocol')),
  source_id text NOT NULL,
  target_id text NOT NULL,
  fingerprint text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind,source_id),
  UNIQUE(kind,target_id)
);
