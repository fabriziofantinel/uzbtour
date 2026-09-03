-- Runtime callers already use the UUID overloads introduced by migrations 144 and 159.
REVOKE ALL ON FUNCTION
  app.is_departure_operator_v3(TEXT,UUID),
  app.list_operational_alerts_v3(TEXT,UUID),
  app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM smf_app;

DROP FUNCTION
  app.is_departure_operator_v3(TEXT,UUID),
  app.list_operational_alerts_v3(TEXT,UUID),
  app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT);

INSERT INTO public.platform_schema_migrations(version)
VALUES('166_v3_drop_superseded_runtime_legacy_signatures') ON CONFLICT(version) DO NOTHING;
