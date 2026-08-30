CREATE OR REPLACE FUNCTION app.has_active_activity_access_grant_v3(
  p_agency UUID,p_departure UUID,p_party UUID,p_traveler UUID,p_activity UUID
) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,journey SET row_security=off AS $$
  SELECT EXISTS(
    SELECT 1 FROM journey.activity_access_grants access_grant
    WHERE access_grant.agency_id=p_agency
      AND access_grant.departure_id=p_departure
      AND access_grant.party_id=p_party
      AND access_grant.traveler_id=p_traveler
      AND access_grant.activity_id=p_activity
      AND access_grant.revoked_at IS NULL
      AND access_grant.granted_at<=clock_timestamp()
      AND access_grant.available_at<=clock_timestamp()
      AND (access_grant.expires_at IS NULL OR access_grant.expires_at>clock_timestamp())
  );
$$;
REVOKE ALL ON FUNCTION app.has_active_activity_access_grant_v3(UUID,UUID,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_active_activity_access_grant_v3(UUID,UUID,UUID,UUID,UUID) TO smf_app;
REVOKE SELECT ON TABLE journey.activity_access_grants FROM smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('105_v3_activity_access_read_contract') ON CONFLICT(version) DO NOTHING;
