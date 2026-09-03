CREATE OR REPLACE FUNCTION app.read_agency_impersonation_travelers(p_actor_user_id UUID)
RETURNS TABLE(
  user_id UUID,legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT,user_status TEXT,
  agency_id UUID,agency_name TEXT,departure_titles TEXT[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT target.id,target_map.legacy_id::text,target.display_name::text,COALESCE(target.username,'')::text,
    COALESCE(target.email,'')::text,target.status::text,agency.id,agency.name::text,
    array_agg(DISTINCT departure.title::text ORDER BY departure.title::text)
  FROM iam.users actor
  JOIN iam.agency_memberships actor_membership ON actor_membership.user_id=actor.id
    AND actor_membership.status='active' AND actor_membership.role IN('owner','admin','editor')
  JOIN iam.agencies agency ON agency.id=actor_membership.agency_id AND agency.status IN('trial','active')
  JOIN travel.traveler_profiles profile ON profile.agency_id=agency.id
  JOIN iam.users target ON target.id=profile.user_id
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  JOIN travel.party_memberships party_membership ON party_membership.agency_id=agency.id
    AND party_membership.traveler_id=profile.id AND party_membership.status<>'removed'
  JOIN travel.departures departure ON departure.id=party_membership.departure_id
    AND departure.agency_id=agency.id AND departure.status<>'cancelled'
  WHERE actor.id=p_actor_user_id AND actor.status='active'
  GROUP BY target.id,target_map.legacy_id,target.display_name,target.username,target.email,target.status,
    agency.id,agency.name
  ORDER BY target.display_name
$$;

CREATE OR REPLACE FUNCTION app.start_agency_traveler_impersonation(
  p_actor_user_id UUID,p_target_user_id UUID,p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,p_user_agent TEXT
)
RETURNS TABLE(target_user_id UUID,target_legacy_user_id TEXT,display_name TEXT,email TEXT,platform_role TEXT,is_agency_admin BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
BEGIN
  IF p_actor_user_id=p_target_user_id THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='cannot impersonate self';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM iam.users actor
    JOIN iam.agency_memberships actor_membership ON actor_membership.user_id=actor.id
      AND actor_membership.status='active' AND actor_membership.role IN('owner','admin','editor')
    JOIN iam.agencies agency ON agency.id=actor_membership.agency_id AND agency.status IN('trial','active')
    JOIN travel.traveler_profiles profile ON profile.agency_id=agency.id AND profile.user_id=p_target_user_id
    JOIN iam.users target ON target.id=profile.user_id AND target.status='active'
    JOIN travel.party_memberships party_membership ON party_membership.agency_id=agency.id
      AND party_membership.traveler_id=profile.id AND party_membership.status<>'removed'
    JOIN travel.departures departure ON departure.id=party_membership.departure_id
      AND departure.agency_id=agency.id AND departure.status<>'cancelled'
    WHERE actor.id=p_actor_user_id AND actor.status='active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency traveler impersonation denied';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid impersonation session';
  END IF;
  UPDATE iam.impersonation_sessions SET ended_at=clock_timestamp()
  WHERE actor_user_id=p_actor_user_id AND ended_at IS NULL;
  INSERT INTO iam.impersonation_sessions(actor_user_id,target_user_id,token_hash,reason,expires_at,user_agent)
  VALUES(p_actor_user_id,p_target_user_id,p_token_hash,'Assistenza agenzia tramite Login come viaggiatore',
    p_expires_at,left(COALESCE(p_user_agent,''),500));
  RETURN QUERY SELECT target.id,target_map.legacy_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,false
  FROM iam.users target
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE target.id=p_target_user_id;
END $$;

REVOKE ALL ON FUNCTION app.read_agency_impersonation_travelers(TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.start_agency_traveler_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.read_agency_impersonation_travelers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.start_agency_traveler_impersonation(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_impersonation_travelers(UUID),
  app.start_agency_traveler_impersonation(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('151_v3_native_agency_traveler_impersonation') ON CONFLICT(version) DO NOTHING;
