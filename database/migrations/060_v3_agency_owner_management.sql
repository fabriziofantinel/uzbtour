-- Consolidates owner contact maintenance, atomic owner replacement and username availability.

CREATE OR REPLACE FUNCTION app.is_username_available(p_actor_legacy_user_id TEXT,p_username TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
  SELECT EXISTS(
    SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id AND actor.status='active'
  ) AND NOT EXISTS(
    SELECT 1 FROM iam.users users WHERE users.username=lower(btrim(p_username))
  )
$$;

CREATE OR REPLACE FUNCTION app.update_platform_agency_owner_contact(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_email TEXT,p_phone TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public SET row_security=off AS $$
DECLARE v_owner_id UUID;v_owner_legacy_id TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id AND actor.status='active'
      AND actor.platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner contact update denied';
  END IF;
  SELECT membership.user_id INTO v_owner_id FROM iam.agency_memberships membership
  WHERE membership.agency_id=p_agency_id AND membership.role='owner' AND membership.status<>'revoked'
  ORDER BY membership.created_at DESC LIMIT 1;
  IF v_owner_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency owner not found'; END IF;
  SELECT legacy_id INTO v_owner_legacy_id FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND target_id=v_owner_id LIMIT 1;
  UPDATE iam.users SET email=lower(btrim(p_email)),phone=btrim(p_phone),updated_at=clock_timestamp() WHERE id=v_owner_id;
  UPDATE public.platform_users SET email=lower(btrim(p_email)),phone=btrim(p_phone),updated_at=clock_timestamp()
  WHERE id=v_owner_legacy_id;
  UPDATE iam.agencies SET reference_email=lower(btrim(p_email)),reference_phone=btrim(p_phone),updated_at=clock_timestamp()
  WHERE id=p_agency_id;
  UPDATE public.agencies SET reference_email=lower(btrim(p_email)),reference_phone=btrim(p_phone),updated_at=clock_timestamp()
  WHERE id=p_agency_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.replace_platform_agency_owner(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_display_name TEXT,p_initials TEXT,
  p_username TEXT,p_email TEXT,p_phone TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_owner RECORD;v_old_owner_ids UUID[];v_old_owner_legacy_ids TEXT[];
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id AND actor.status='active'
      AND actor.platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner replacement denied';
  END IF;
  SELECT COALESCE(array_agg(user_id),ARRAY[]::uuid[]) INTO v_old_owner_ids
  FROM iam.agency_memberships WHERE agency_id=p_agency_id AND role='owner' AND status<>'revoked';
  SELECT COALESCE(array_agg(legacy_id),ARRAY[]::text[]) INTO v_old_owner_legacy_ids FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND target_id=ANY(v_old_owner_ids);
  IF EXISTS(SELECT 1 FROM iam.users WHERE username=lower(btrim(p_username))) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned';
  END IF;
  UPDATE iam.agency_memberships SET status='revoked' WHERE agency_id=p_agency_id AND role='owner' AND status<>'revoked';
  DELETE FROM public.agency_memberships WHERE agency_id=p_agency_id AND role='owner';
  UPDATE iam.agencies SET reference_name=btrim(p_display_name),reference_email=lower(btrim(p_email)),
    reference_phone=btrim(p_phone),updated_at=clock_timestamp() WHERE id=p_agency_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  UPDATE public.agencies SET reference_name=btrim(p_display_name),reference_email=lower(btrim(p_email)),
    reference_phone=btrim(p_phone),updated_at=clock_timestamp() WHERE id=p_agency_id;
  SELECT * INTO v_owner FROM app.provision_platform_agency_agent(p_actor_legacy_user_id,p_agency_id,
    p_display_name,p_initials,p_username,p_email,p_phone,'owner',p_token_hash,p_expires_at);

  DELETE FROM iam.impersonation_sessions WHERE target_user_id=ANY(v_old_owner_ids);
  DELETE FROM iam.agency_memberships WHERE user_id=ANY(v_old_owner_ids) AND agency_id=p_agency_id;
  DELETE FROM public.platform_users legacy_user WHERE legacy_user.id=ANY(v_old_owner_legacy_ids)
    AND NOT EXISTS(SELECT 1 FROM public.agency_memberships membership WHERE membership.user_id=legacy_user.id)
    AND NOT EXISTS(SELECT 1 FROM public.traveler_profiles traveler WHERE traveler.user_id=legacy_user.id);
  DELETE FROM iam.users old_user WHERE old_user.id=ANY(v_old_owner_ids)
    AND old_user.platform_role<>'superadmin'
    AND NOT EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.user_id=old_user.id)
    AND NOT EXISTS(SELECT 1 FROM travel.traveler_profiles traveler WHERE traveler.user_id=old_user.id);
  RETURN QUERY SELECT v_owner.legacy_user_id,v_owner.activation_required;
END $$;

REVOKE ALL ON FUNCTION app.is_username_available(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_platform_agency_owner_contact(TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.replace_platform_agency_owner(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_username_available(TEXT,TEXT),
  app.update_platform_agency_owner_contact(TEXT,UUID,TEXT,TEXT),
  app.replace_platform_agency_owner(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('060_v3_agency_owner_management') ON CONFLICT(version) DO NOTHING;
