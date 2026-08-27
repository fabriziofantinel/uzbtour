-- Keep impersonation result types exact and enforce the target tenant lifecycle.

CREATE OR REPLACE FUNCTION app.start_legacy_impersonation(
  p_actor_legacy_user_id TEXT,p_target_legacy_user_id TEXT,p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,p_user_agent TEXT
)
RETURNS TABLE(
  target_legacy_user_id TEXT,display_name TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops
SET row_security=off
AS $$
DECLARE v_actor UUID;v_target UUID;
BEGIN
  IF p_actor_legacy_user_id=p_target_legacy_user_id THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='cannot impersonate self';
  END IF;
  SELECT map.target_id INTO v_actor
  FROM ops.legacy_id_map map JOIN iam.users users ON users.id=map.target_id
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=p_actor_legacy_user_id
    AND users.status='active' AND users.platform_role='superadmin';
  SELECT map.target_id INTO v_target
  FROM ops.legacy_id_map map JOIN iam.users users ON users.id=map.target_id
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=p_target_legacy_user_id AND users.status='active'
    AND (
      users.platform_role='superadmin'
      OR EXISTS(SELECT 1 FROM iam.agency_memberships membership
        JOIN iam.agencies agency ON agency.id=membership.agency_id
          AND agency.status IN('trial','active')
        WHERE membership.user_id=users.id AND membership.status='active')
      OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile
        JOIN travel.party_memberships party_membership
          ON party_membership.agency_id=profile.agency_id
          AND party_membership.traveler_id=profile.id AND party_membership.status='active'
        JOIN iam.agencies agency ON agency.id=profile.agency_id
          AND agency.status IN('trial','active')
        WHERE profile.user_id=users.id)
    );
  IF v_actor IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='impersonation denied';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid impersonation session';
  END IF;

  UPDATE iam.impersonation_sessions SET ended_at=clock_timestamp()
  WHERE actor_user_id=v_actor AND ended_at IS NULL;
  INSERT INTO iam.impersonation_sessions
    (actor_user_id,target_user_id,token_hash,reason,expires_at,user_agent)
  VALUES(v_actor,v_target,p_token_hash,'Assistenza superadmin tramite funzione Login come',
    p_expires_at,left(COALESCE(p_user_agent,''),500));

  RETURN QUERY SELECT p_target_legacy_user_id::text,users.display_name::text,
    COALESCE(users.email,'')::text,users.platform_role::text,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id
        AND agency.status IN('trial','active')
      WHERE membership.user_id=users.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor'))::boolean
  FROM iam.users users WHERE users.id=v_target;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_impersonation(
  p_actor_legacy_user_id TEXT,p_token_hash TEXT
)
RETURNS TABLE(
  target_legacy_user_id TEXT,display_name TEXT,email TEXT,platform_role TEXT,
  is_agency_admin BOOLEAN,expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops
SET row_security=off
AS $$
  SELECT target_map.legacy_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id
        AND agency.status IN('trial','active')
      WHERE membership.user_id=target.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor'))::boolean,
    session.expires_at::timestamptz
  FROM ops.legacy_id_map actor_map
  JOIN iam.users actor ON actor.id=actor_map.target_id
    AND actor.status='active' AND actor.platform_role='superadmin'
  JOIN iam.impersonation_sessions session ON session.actor_user_id=actor.id
    AND session.token_hash=p_token_hash AND session.ended_at IS NULL
    AND session.expires_at>clock_timestamp()
  JOIN iam.users target ON target.id=session.target_user_id AND target.status='active'
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
    AND (
      target.platform_role='superadmin'
      OR EXISTS(SELECT 1 FROM iam.agency_memberships membership
        JOIN iam.agencies agency ON agency.id=membership.agency_id
          AND agency.status IN('trial','active')
        WHERE membership.user_id=target.id AND membership.status='active')
      OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile
        JOIN travel.party_memberships party_membership
          ON party_membership.agency_id=profile.agency_id
          AND party_membership.traveler_id=profile.id AND party_membership.status='active'
        JOIN iam.agencies agency ON agency.id=profile.agency_id
          AND agency.status IN('trial','active')
        WHERE profile.user_id=target.id)
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.start_legacy_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_legacy_impersonation(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.start_legacy_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT),
  app.resolve_legacy_impersonation(TEXT,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('058_v3_impersonation_contract_and_tenant_status') ON CONFLICT(version) DO NOTHING;
