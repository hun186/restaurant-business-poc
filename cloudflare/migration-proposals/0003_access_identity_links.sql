-- PROPOSAL ONLY. This is NOT an active D1 migration. Do not move into
-- cloudflare/migrations/ or run against remote Staging/Production until a
-- separate reviewed, main-only, explicitly approved migration gate exists.
-- No automatic enrollment, Owner creation, credential or policy changes.
-- Requires existing v3 users; cloud_schema_contract remains unchanged.
CREATE TABLE access_identity_links (
  issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 1 AND 255),
  audience TEXT NOT NULL CHECK(length(audience) = 64 AND audience NOT GLOB '*[^0-9A-Fa-f]*'),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 256),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  PRIMARY KEY(issuer,audience,subject),
  UNIQUE(issuer,audience,user_id)
);
