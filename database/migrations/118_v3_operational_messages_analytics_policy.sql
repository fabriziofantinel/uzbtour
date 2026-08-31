DROP POLICY IF EXISTS operational_messages_tenant_read_policy ON journey.operational_messages;
CREATE POLICY operational_messages_tenant_read_policy ON journey.operational_messages
  FOR SELECT TO smf_app
  USING(agency_id=app.current_agency_id());
GRANT SELECT ON journey.operational_messages TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('118_v3_operational_messages_analytics_policy') ON CONFLICT(version) DO NOTHING;
