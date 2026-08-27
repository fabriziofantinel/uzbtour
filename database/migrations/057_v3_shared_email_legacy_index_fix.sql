-- Remove the last V2-only uniqueness rule on contact email.
-- Username is the sole login identity; one family mailbox may serve many users.

DROP INDEX IF EXISTS public.platform_users_normalized_email_unique;

CREATE INDEX IF NOT EXISTS platform_users_normalized_email_idx
  ON public.platform_users (lower(btrim(email)))
  WHERE email IS NOT NULL;

INSERT INTO public.platform_schema_migrations(version)
VALUES('057_v3_shared_email_legacy_index_fix') ON CONFLICT(version) DO NOTHING;
