CREATE OR REPLACE FUNCTION app.read_superadmin_impersonation_users_v3(p_actor_user_id UUID)
RETURNS TABLE(
  user_id UUID,legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT,phone TEXT,
  user_status TEXT,platform_role TEXT,agency_names TEXT[],agency_roles TEXT[],is_traveler BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT users.id,user_map.legacy_id,users.display_name,COALESCE(users.username,''),
    COALESCE(users.email,''),COALESCE(users.phone,''),users.status,users.platform_role,
    COALESCE(array_agg(DISTINCT agency.name) FILTER(WHERE agency.id IS NOT NULL),ARRAY[]::text[]),
    COALESCE(array_agg(DISTINCT membership.role) FILTER(WHERE membership.role IS NOT NULL),ARRAY[]::text[]),
    EXISTS(SELECT 1 FROM travel.traveler_profiles traveler WHERE traveler.user_id=users.id)
  FROM iam.users actor
  CROSS JOIN iam.users users
  JOIN ops.legacy_id_map user_map ON user_map.target_id=users.id
    AND user_map.source_system='public-v2' AND user_map.entity_type='user'
  LEFT JOIN iam.agency_memberships membership ON membership.user_id=users.id
    AND membership.status<>'revoked'
  LEFT JOIN iam.agencies agency ON agency.id=membership.agency_id
  WHERE actor.id=p_actor_user_id AND actor.status='active' AND actor.platform_role='superadmin'
    AND users.id<>actor.id AND users.status NOT IN('disabled','anonymized')
  GROUP BY user_map.legacy_id,users.id
  ORDER BY users.display_name,users.email
$$;

CREATE OR REPLACE FUNCTION app.start_impersonation_v3(
  p_actor_user_id UUID,p_target_user_id UUID,p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,p_user_agent TEXT
)
RETURNS TABLE(
  target_user_id UUID,target_legacy_user_id TEXT,display_name TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
BEGIN
  IF p_actor_user_id=p_target_user_id THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='cannot impersonate self';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM iam.users actor WHERE actor.id=p_actor_user_id
    AND actor.status='active' AND actor.platform_role='superadmin')
    OR NOT EXISTS(SELECT 1 FROM iam.users target WHERE target.id=p_target_user_id
      AND target.status='active' AND (
        target.platform_role='superadmin'
        OR EXISTS(SELECT 1 FROM iam.agency_memberships membership
          JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
          WHERE membership.user_id=target.id AND membership.status='active')
        OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile
          JOIN travel.party_memberships party_membership ON party_membership.agency_id=profile.agency_id
            AND party_membership.traveler_id=profile.id AND party_membership.status='active'
          JOIN iam.agencies agency ON agency.id=profile.agency_id AND agency.status IN('trial','active')
          WHERE profile.user_id=target.id))) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='impersonation denied';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid impersonation session';
  END IF;

  UPDATE iam.impersonation_sessions SET ended_at=clock_timestamp()
  WHERE actor_user_id=p_actor_user_id AND ended_at IS NULL;
  INSERT INTO iam.impersonation_sessions
    (actor_user_id,target_user_id,token_hash,reason,expires_at,user_agent)
  VALUES(p_actor_user_id,p_target_user_id,p_token_hash,
    'Assistenza superadmin tramite funzione Login come',p_expires_at,left(COALESCE(p_user_agent,''),500));

  RETURN QUERY SELECT target.id,target_map.legacy_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
      WHERE membership.user_id=target.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor'))::boolean
  FROM iam.users target
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE target.id=p_target_user_id;
END $$;

CREATE OR REPLACE FUNCTION app.end_impersonation_v3(p_actor_user_id UUID,p_token_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam SET row_security=off AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE iam.impersonation_sessions SET ended_at=clock_timestamp()
  WHERE actor_user_id=p_actor_user_id AND token_hash=p_token_hash AND ended_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count>0;
END $$;

REVOKE ALL ON FUNCTION app.read_superadmin_impersonation_users_v3(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.start_impersonation_v3(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.end_impersonation_v3(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_superadmin_impersonation_users_v3(UUID),
  app.start_impersonation_v3(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT),
  app.end_impersonation_v3(UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('150_v3_native_superadmin_impersonation') ON CONFLICT(version) DO NOTHING;
