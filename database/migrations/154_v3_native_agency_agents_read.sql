CREATE OR REPLACE FUNCTION app.read_agency_agents_v3(p_actor_user_id UUID,p_agency_id UUID)
RETURNS TABLE(id TEXT,name TEXT,username TEXT,email TEXT,phone TEXT,status TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.agency_id=p_agency_id AND membership.role='owner' AND membership.status='active'
    JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
    WHERE actor.id=p_actor_user_id AND actor.status='active'
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner access denied'; END IF;

  RETURN QUERY SELECT map.legacy_id,users.display_name::text,users.username::text,
    users.email::text,COALESCE(users.phone,'')::text,membership.status::text,membership.created_at
  FROM iam.agency_memberships membership
  JOIN iam.users users ON users.id=membership.user_id
  JOIN ops.legacy_id_map map ON map.target_id=users.id
    AND map.source_system='public-v2' AND map.entity_type='user'
  WHERE membership.agency_id=p_agency_id AND membership.role='editor' AND membership.status<>'revoked'
  ORDER BY users.display_name,users.username;
END $$;

REVOKE ALL ON FUNCTION app.read_agency_agents_v3(TEXT,UUID) FROM smf_app;
REVOKE ALL ON FUNCTION app.read_agency_agents_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_agents_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('154_v3_native_agency_agents_read') ON CONFLICT(version) DO NOTHING;
