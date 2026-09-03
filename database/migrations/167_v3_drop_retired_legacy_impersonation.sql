-- Native impersonation contracts were introduced in migrations 147 and 150.
REVOKE ALL ON FUNCTION
  app.start_legacy_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT),
  app.resolve_legacy_impersonation(TEXT,TEXT),
  app.end_legacy_impersonation(TEXT,TEXT)
FROM smf_app;

DROP FUNCTION
  app.start_legacy_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT),
  app.resolve_legacy_impersonation(TEXT,TEXT),
  app.end_legacy_impersonation(TEXT,TEXT);

INSERT INTO public.platform_schema_migrations(version)
VALUES('167_v3_drop_retired_legacy_impersonation') ON CONFLICT(version) DO NOTHING;
