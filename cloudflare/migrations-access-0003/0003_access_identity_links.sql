-- Staging-only, isolated migration candidate for an explicitly approved
-- future manual action using wrangler.staging-access-0003.jsonc.
-- Not in cloudflare/migrations: existing 0002 apply must never discover it.
-- There is no workflow to apply this migration; merging code does NOT run it.
-- No users, sessions, credentials or identity links are inserted.
CREATE TABLE access_identity_links (
  issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 1 AND 255),
  audience TEXT NOT NULL CHECK(length(audience) = 64 AND audience NOT GLOB '*[^0-9A-Fa-f]*'),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 256),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  PRIMARY KEY(issuer,audience,subject),
  UNIQUE(issuer,audience,user_id)
);
