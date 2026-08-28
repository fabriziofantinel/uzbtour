-- Espone esclusivamente il branding delle agenzie accessibili all'utente agenzia.
CREATE OR REPLACE FUNCTION app.read_agency_branding_v3(p_actor_legacy_user_id TEXT)
RETURNS TABLE(agency_id UUID,branding JSONB)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
  WITH actor AS (
    SELECT map.target_id user_id
    FROM ops.legacy_id_map map
    JOIN iam.users actor_user ON actor_user.id=map.target_id AND actor_user.status='active'
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id
    LIMIT 1
  )
  SELECT agency.id,agency.branding
  FROM iam.agencies agency
  JOIN iam.agency_memberships membership ON membership.agency_id=agency.id
  JOIN actor ON actor.user_id=membership.user_id
  WHERE membership.status='active' AND membership.role IN('owner','admin','editor')
    AND agency.status<>'deleted'
$$;

REVOKE ALL ON FUNCTION app.read_agency_branding_v3(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_branding_v3(TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('077_v3_agency_branding_read')
ON CONFLICT(version) DO NOTHING;
