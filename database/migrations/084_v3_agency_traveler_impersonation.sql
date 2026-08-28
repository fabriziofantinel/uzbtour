-- Consente agli utenti agenzia di impersonare esclusivamente i viaggiatori dei propri viaggi.

CREATE OR REPLACE FUNCTION app.read_agency_impersonation_travelers(p_actor_legacy_user_id TEXT)
RETURNS TABLE(
  legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT,user_status TEXT,
  agency_id UUID,agency_name TEXT,departure_titles TEXT[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT target_map.legacy_id::text,target.display_name::text,COALESCE(target.username,'')::text,
    COALESCE(target.email,'')::text,target.status::text,agency.id,agency.name::text,
    array_agg(DISTINCT departure.title::text ORDER BY departure.title::text)
  FROM ops.legacy_id_map actor_map
  JOIN iam.users actor ON actor.id=actor_map.target_id AND actor.status='active'
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
  WHERE actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
  GROUP BY target_map.legacy_id,target.display_name,target.username,target.email,target.status,
    agency.id,agency.name
  ORDER BY target.display_name
$$;

CREATE OR REPLACE FUNCTION app.start_agency_traveler_impersonation(
  p_actor_legacy_user_id TEXT,p_target_legacy_user_id TEXT,p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,p_user_agent TEXT
)
RETURNS TABLE(target_legacy_user_id TEXT,display_name TEXT,email TEXT,platform_role TEXT,is_agency_admin BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_target UUID;
BEGIN
  IF p_actor_legacy_user_id=p_target_legacy_user_id THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='cannot impersonate self';
  END IF;
  SELECT actor_map.target_id,target_map.target_id INTO v_actor,v_target
  FROM ops.legacy_id_map actor_map
  JOIN iam.users actor ON actor.id=actor_map.target_id AND actor.status='active'
  JOIN iam.agency_memberships actor_membership ON actor_membership.user_id=actor.id
    AND actor_membership.status='active' AND actor_membership.role IN('owner','admin','editor')
  JOIN iam.agencies agency ON agency.id=actor_membership.agency_id AND agency.status IN('trial','active')
  JOIN travel.traveler_profiles profile ON profile.agency_id=agency.id
  JOIN iam.users target ON target.id=profile.user_id AND target.status='active'
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
    AND target_map.legacy_id=p_target_legacy_user_id
  JOIN travel.party_memberships party_membership ON party_membership.agency_id=agency.id
    AND party_membership.traveler_id=profile.id AND party_membership.status<>'removed'
  JOIN travel.departures departure ON departure.id=party_membership.departure_id
    AND departure.agency_id=agency.id AND departure.status<>'cancelled'
  WHERE actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
  LIMIT 1;
  IF v_actor IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency traveler impersonation denied';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid impersonation session';
  END IF;
  UPDATE iam.impersonation_sessions SET ended_at=clock_timestamp()
  WHERE actor_user_id=v_actor AND ended_at IS NULL;
  INSERT INTO iam.impersonation_sessions(actor_user_id,target_user_id,token_hash,reason,expires_at,user_agent)
  VALUES(v_actor,v_target,p_token_hash,'Assistenza agenzia tramite Login come viaggiatore',
    p_expires_at,left(COALESCE(p_user_agent,''),500));
  RETURN QUERY SELECT p_target_legacy_user_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,false
  FROM iam.users target WHERE target.id=v_target;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_impersonation(p_actor_legacy_user_id TEXT,p_token_hash TEXT)
RETURNS TABLE(target_legacy_user_id TEXT,display_name TEXT,email TEXT,platform_role TEXT,is_agency_admin BOOLEAN,expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT target_map.legacy_id::text,target.display_name::text,COALESCE(target.email,'')::text,
    target.platform_role::text,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=target.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor'))::boolean,
    session.expires_at::timestamptz
  FROM ops.legacy_id_map actor_map
  JOIN iam.users actor ON actor.id=actor_map.target_id AND actor.status='active'
  JOIN iam.impersonation_sessions session ON session.actor_user_id=actor.id
    AND session.token_hash=p_token_hash AND session.ended_at IS NULL
    AND session.expires_at>clock_timestamp()
  JOIN iam.users target ON target.id=session.target_user_id AND target.status='active'
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
    AND (
      actor.platform_role='superadmin'
      OR EXISTS(
        SELECT 1 FROM iam.agency_memberships actor_membership
        JOIN travel.traveler_profiles profile ON profile.agency_id=actor_membership.agency_id
          AND profile.user_id=target.id
        JOIN travel.party_memberships party_membership ON party_membership.agency_id=profile.agency_id
          AND party_membership.traveler_id=profile.id AND party_membership.status<>'removed'
        JOIN travel.departures departure ON departure.id=party_membership.departure_id
          AND departure.agency_id=actor_membership.agency_id AND departure.status<>'cancelled'
        WHERE actor_membership.user_id=actor.id AND actor_membership.status='active'
          AND actor_membership.role IN('owner','admin','editor')
      )
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.read_agency_impersonation_travelers(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.start_agency_traveler_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_legacy_impersonation(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_impersonation_travelers(TEXT),
  app.start_agency_traveler_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT),
  app.resolve_legacy_impersonation(TEXT,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('084_v3_agency_traveler_impersonation') ON CONFLICT(version) DO NOTHING;
