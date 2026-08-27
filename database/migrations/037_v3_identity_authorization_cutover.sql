-- Cutover di autenticazione, autorizzazione e impersonificazione verso IAM V3.
-- Gli identificativi legacy restano nel contratto applicativo durante la
-- convergenza, ma ops.legacy_id_map non viene mai esposta al ruolo runtime.

CREATE OR REPLACE FUNCTION app.resolve_neon_authenticated_user(
  p_subject TEXT,
  p_email TEXT,
  p_display_name TEXT
)
RETURNS TABLE(
  legacy_user_id TEXT,
  display_name TEXT,
  email TEXT,
  platform_role TEXT,
  is_agency_admin BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public
SET row_security=off
AS $$
DECLARE
  v_user_id UUID;
  v_legacy_user_id TEXT;
BEGIN
  SELECT candidate.id INTO v_user_id
  FROM (
    SELECT users.id,
      CASE WHEN identity.subject=p_subject THEN 0 ELSE 1 END AS priority
    FROM iam.users users
    LEFT JOIN iam.user_identities identity
      ON identity.user_id=users.id AND identity.provider='neon'
    WHERE (identity.subject=p_subject OR users.normalized_email=lower(btrim(p_email)))
      AND users.status='active'
  ) candidate
  ORDER BY candidate.priority
  LIMIT 1;
  IF v_user_id IS NULL THEN RETURN; END IF;

  DELETE FROM iam.user_identities
  WHERE user_id=v_user_id AND provider='neon' AND subject<>p_subject;
  INSERT INTO iam.user_identities(user_id,provider,subject)
  VALUES(v_user_id,'neon',p_subject)
  ON CONFLICT(provider,subject) DO UPDATE SET user_id=EXCLUDED.user_id;

  UPDATE iam.users users
  SET email=lower(btrim(p_email)),
      display_name=COALESCE(NULLIF(btrim(users.display_name),''),NULLIF(btrim(p_display_name),''),'Utente'),
      updated_at=clock_timestamp()
  WHERE users.id=v_user_id;

  SELECT map.legacy_id INTO v_legacy_user_id
  FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.target_id=v_user_id
  LIMIT 1;
  IF v_legacy_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='legacy identity mapping missing';
  END IF;

  -- Compatibilità temporanea per i moduli non ancora migrati a IAM.
  UPDATE public.platform_users legacy
  SET auth_provider='neon',auth_subject=p_subject,email=lower(btrim(p_email)),
      display_name=COALESCE(NULLIF(btrim(legacy.display_name),''),NULLIF(btrim(p_display_name),''),'Utente'),
      status='active',updated_at=clock_timestamp()
  WHERE legacy.id=v_legacy_user_id;

  RETURN QUERY
  SELECT v_legacy_user_id,users.display_name,COALESCE(users.email,''),users.platform_role,
    EXISTS(
      SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.status='active'
        AND membership.role IN ('owner','admin','editor')
    )
  FROM iam.users users WHERE users.id=v_user_id;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_user_access(
  p_legacy_user_id TEXT,
  p_agency_id UUID DEFAULT NULL
)
RETURNS TABLE(
  is_active BOOLEAN,
  is_superadmin BOOLEAN,
  is_agency_admin BOOLEAN,
  agency_role TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops
SET row_security=off
AS $$
  SELECT users.status='active',
    users.status='active' AND users.platform_role='superadmin',
    users.status='active' AND EXISTS(
      SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.status='active'
        AND membership.role IN ('owner','admin','editor')
        AND (p_agency_id IS NULL OR membership.agency_id=p_agency_id)
    ),
    (
      SELECT membership.role
      FROM iam.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.status='active'
        AND (p_agency_id IS NULL OR membership.agency_id=p_agency_id)
      ORDER BY CASE membership.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
        WHEN 'editor' THEN 2 ELSE 3 END,membership.agency_id
      LIMIT 1
    )
  FROM ops.legacy_id_map map
  JOIN iam.users users ON users.id=map.target_id
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=p_legacy_user_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.start_legacy_impersonation(
  p_actor_legacy_user_id TEXT,
  p_target_legacy_user_id TEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_user_agent TEXT
)
RETURNS TABLE(
  target_legacy_user_id TEXT,
  display_name TEXT,
  email TEXT,
  platform_role TEXT,
  is_agency_admin BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops
SET row_security=off
AS $$
DECLARE
  v_actor UUID;
  v_target UUID;
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
    AND map.legacy_id=p_target_legacy_user_id AND users.status='active';
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
    p_expires_at,left(p_user_agent,500));

  RETURN QUERY
  SELECT p_target_legacy_user_id,users.display_name,COALESCE(users.email,''),users.platform_role,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.status='active'
        AND membership.role IN ('owner','admin','editor'))
  FROM iam.users users WHERE users.id=v_target;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_impersonation(
  p_actor_legacy_user_id TEXT,
  p_token_hash TEXT
)
RETURNS TABLE(
  target_legacy_user_id TEXT,
  display_name TEXT,
  email TEXT,
  platform_role TEXT,
  is_agency_admin BOOLEAN,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops
SET row_security=off
AS $$
  SELECT target_map.legacy_id,target.display_name,COALESCE(target.email,''),target.platform_role,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=target.id AND membership.status='active'
        AND membership.role IN ('owner','admin','editor')),
    session.expires_at
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
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.end_legacy_impersonation(
  p_actor_legacy_user_id TEXT,
  p_token_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops
SET row_security=off
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE iam.impersonation_sessions session SET ended_at=clock_timestamp()
  FROM ops.legacy_id_map actor_map
  WHERE actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
    AND session.actor_user_id=actor_map.target_id
    AND session.token_hash=p_token_hash AND session.ended_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count>0;
END $$;

REVOKE ALL ON FUNCTION app.resolve_neon_authenticated_user(TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_legacy_user_access(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.start_legacy_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_legacy_impersonation(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.end_legacy_impersonation(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_neon_authenticated_user(TEXT,TEXT,TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_user_access(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.start_legacy_impersonation(TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_impersonation(TEXT,TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.end_legacy_impersonation(TEXT,TEXT) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('037_v3_identity_authorization_cutover') ON CONFLICT(version) DO NOTHING;
