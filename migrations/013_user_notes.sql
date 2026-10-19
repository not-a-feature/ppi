ALTER TABLE ppi_user ADD COLUMN admin_note text NOT NULL DEFAULT '' CHECK(length(admin_note)<=4000);
ALTER TABLE ppi_user ADD COLUMN note_version integer NOT NULL DEFAULT 1;
ALTER TABLE ppi_user ADD COLUMN note_updated_at timestamptz;
ALTER TABLE ppi_user ADD COLUMN note_updated_by text REFERENCES "user"(id);
