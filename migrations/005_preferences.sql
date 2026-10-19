CREATE TABLE user_preference (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de', 'en')),
  theme TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('light', 'dark', 'auto'))
);
