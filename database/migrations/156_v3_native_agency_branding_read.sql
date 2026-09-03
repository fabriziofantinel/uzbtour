CREATE OR REPLACE FUNCTION app.read_agency_branding_v3(p_actor_user_id UUID)
RETURNS TABLE(agency_id UUID,branding JSONB)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam SET row_security=off AS $$
  SELECT agency.id,agency.branding
  FROM iam.agencies AS agency
  JOIN iam.agency_memberships AS membership ON membership.agency_id=agency.id
  JOIN iam.users AS actor ON actor.id=membership.user_id AND actor.status='active'
  WHERE actor.id=p_actor_user_id
    AND membership.status='active' AND membership.role IN('owner','admin','editor')
    AND agency.status<>'deleted'
$$;

REVOKE ALL ON FUNCTION app.read_agency_branding_v3(TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.read_agency_branding_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_branding_v3(UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('156_v3_native_agency_branding_read') ON CONFLICT(version) DO NOTHING;
