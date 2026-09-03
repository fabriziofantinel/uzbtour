CREATE OR REPLACE FUNCTION app.provision_platform_agency_agent(
  p_actor_user_id UUID,p_agency_id UUID,p_display_name TEXT,p_initials TEXT,
  p_username TEXT,p_email TEXT,p_phone TEXT,p_role TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public SET row_security=off AS $$
DECLARE v_actor_legacy TEXT;v_user_id UUID;v_legacy_user_id TEXT;v_status TEXT;v_invitation_id UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin')
    OR NOT EXISTS(SELECT 1 FROM iam.agencies WHERE id=p_agency_id AND status IN('trial','active','suspended'))
    OR p_role NOT IN('owner','admin','editor','viewer')
    OR btrim(p_username) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
    OR NULLIF(btrim(p_email),'') IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid agency agent provisioning request';
  END IF;
  SELECT legacy_id INTO v_actor_legacy FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND target_id=p_actor_user_id ORDER BY created_at LIMIT 1;
  IF v_actor_legacy IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='superadmin compatibility identity missing'; END IF;
  SELECT id,status INTO v_user_id,v_status FROM iam.users WHERE normalized_username=lower(btrim(p_username)) FOR UPDATE;
  IF v_user_id IS NULL THEN
    INSERT INTO iam.users(username,display_name,email,phone,platform_role,status)
    VALUES(btrim(p_username),btrim(p_display_name),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'user','invited')
    RETURNING id,status INTO v_user_id,v_status;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=v_user_id AND normalized_email=lower(btrim(p_email))) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned';
    END IF;
    UPDATE iam.users SET display_name=btrim(p_display_name),phone=COALESCE(NULLIF(btrim(p_phone),''),phone),
      updated_at=clock_timestamp() WHERE id=v_user_id;
  END IF;
  SELECT legacy_id INTO v_legacy_user_id FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND target_id=v_user_id;
  IF v_legacy_user_id IS NULL THEN
    v_legacy_user_id:='agent:'||gen_random_uuid()::text;
    INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,target_id,agency_id)
    VALUES('public-v2','user',v_legacy_user_id,v_user_id,p_agency_id);
  END IF;
  INSERT INTO public.platform_users(id,username,display_name,initials,email,phone,auth_provider,platform_role,status)
  VALUES(v_legacy_user_id,btrim(p_username),btrim(p_display_name),left(p_initials,8),lower(btrim(p_email)),
    NULLIF(btrim(p_phone),''),'cognito','user',v_status)
  ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,
    initials=EXCLUDED.initials,email=EXCLUDED.email,phone=COALESCE(EXCLUDED.phone,public.platform_users.phone),
    updated_at=clock_timestamp();
  INSERT INTO iam.agency_memberships(agency_id,user_id,role,status)
  VALUES(p_agency_id,v_user_id,p_role,CASE WHEN v_status='active' THEN 'active' ELSE 'invited' END)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status;
  INSERT INTO public.agency_memberships(agency_id,user_id,role) VALUES(p_agency_id,v_legacy_user_id,p_role)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET role=EXCLUDED.role;
  IF v_status<>'active' THEN
    UPDATE iam.invitations SET used_at=clock_timestamp() WHERE invited_user_id=v_user_id AND used_at IS NULL;
    UPDATE public.user_invitations SET used_at=clock_timestamp() WHERE user_id=v_legacy_user_id AND used_at IS NULL;
    INSERT INTO iam.invitations(agency_id,invited_user_id,created_by_user_id,token_hash,expires_at)
    VALUES(p_agency_id,v_user_id,p_actor_user_id,p_token_hash,p_expires_at) RETURNING id INTO v_invitation_id;
    INSERT INTO public.user_invitations(id,user_id,created_by_user_id,token_hash,expires_at)
    VALUES(v_invitation_id,v_legacy_user_id,v_actor_legacy,p_token_hash,p_expires_at);
  END IF;
  RETURN QUERY SELECT v_legacy_user_id,v_status<>'active';
END $$;

CREATE OR REPLACE FUNCTION app.create_platform_agency_with_owner(
  p_actor_user_id UUID,p_payload JSONB,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(agency_id UUID,legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,public SET row_security=off AS $$
DECLARE v_agency_id UUID;v_owner RECORD;v_branding JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency creation denied';
  END IF;
  v_branding:=COALESCE(p_payload->'branding','{}'::jsonb);
  IF COALESCE(p_payload->>'slug','') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    OR NULLIF(btrim(p_payload->>'name'),'') IS NULL OR NULLIF(btrim(p_payload->>'referenceName'),'') IS NULL
    OR jsonb_typeof(v_branding)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid agency data'; END IF;
  INSERT INTO iam.agencies(slug,name,status,legal_name,vat_number,tax_code,registered_address,registered_city,
    registered_postal_code,registered_province,registered_country_code,pec,sdi_code,phone,email,website,
    reference_name,reference_email,reference_phone,branding)
  VALUES(p_payload->>'slug',btrim(p_payload->>'name'),'trial',NULLIF(btrim(p_payload->>'legalName'),''),
    NULLIF(btrim(p_payload->>'vatNumber'),''),NULLIF(btrim(p_payload->>'taxCode'),''),
    NULLIF(btrim(p_payload->>'registeredAddress'),''),NULLIF(btrim(p_payload->>'registeredCity'),''),
    NULLIF(btrim(p_payload->>'registeredPostalCode'),''),NULLIF(btrim(p_payload->>'registeredProvince'),''),
    NULLIF(upper(left(btrim(p_payload->>'registeredCountry'),2)),''),NULLIF(btrim(p_payload->>'pec'),''),
    NULLIF(btrim(p_payload->>'sdiCode'),''),NULLIF(btrim(p_payload->>'phone'),''),NULLIF(btrim(p_payload->>'email'),''),
    NULLIF(btrim(p_payload->>'website'),''),btrim(p_payload->>'referenceName'),NULLIF(btrim(p_payload->>'referenceEmail'),''),
    NULLIF(btrim(p_payload->>'referencePhone'),''),v_branding) RETURNING id INTO v_agency_id;
  INSERT INTO public.agencies(id,slug,name,status,legal_name,vat_number,tax_code,registered_address,registered_city,
    registered_postal_code,registered_province,registered_country,pec,sdi_code,phone,email,website,reference_name,
    reference_email,reference_phone,branding)
  SELECT id,slug,name,status,legal_name,vat_number,tax_code,registered_address,registered_city,registered_postal_code,
    registered_province,registered_country_code,pec,sdi_code,phone,email,website,reference_name,reference_email,
    reference_phone,branding FROM iam.agencies WHERE id=v_agency_id;
  SELECT * INTO v_owner FROM app.provision_platform_agency_agent(p_actor_user_id,v_agency_id,
    p_payload->>'referenceName',COALESCE(p_payload->>'referenceInitials',''),p_payload->>'referenceUsername',
    p_payload->>'referenceEmail',p_payload->>'referencePhone','owner',p_token_hash,p_expires_at);
  RETURN QUERY SELECT v_agency_id,v_owner.legacy_user_id,v_owner.activation_required;
END $$;

CREATE OR REPLACE FUNCTION app.replace_platform_agency_owner(
  p_actor_user_id UUID,p_agency_id UUID,p_display_name TEXT,p_initials TEXT,p_username TEXT,p_email TEXT,
  p_phone TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_owner RECORD;v_old_owner_ids UUID[];v_old_owner_legacy_ids TEXT[];
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner replacement denied'; END IF;
  SELECT COALESCE(array_agg(user_id),ARRAY[]::uuid[]) INTO v_old_owner_ids FROM iam.agency_memberships
  WHERE agency_id=p_agency_id AND role='owner' AND status<>'revoked';
  SELECT COALESCE(array_agg(legacy_id),ARRAY[]::text[]) INTO v_old_owner_legacy_ids FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND target_id=ANY(v_old_owner_ids);
  IF EXISTS(SELECT 1 FROM iam.users WHERE normalized_username=lower(btrim(p_username))) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned'; END IF;
  UPDATE iam.agency_memberships SET status='revoked' WHERE agency_id=p_agency_id AND role='owner' AND status<>'revoked';
  DELETE FROM public.agency_memberships WHERE agency_id=p_agency_id AND role='owner';
  UPDATE iam.agencies SET reference_name=btrim(p_display_name),reference_email=lower(btrim(p_email)),
    reference_phone=btrim(p_phone),updated_at=clock_timestamp() WHERE id=p_agency_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  UPDATE public.agencies SET reference_name=btrim(p_display_name),reference_email=lower(btrim(p_email)),
    reference_phone=btrim(p_phone),updated_at=clock_timestamp() WHERE id=p_agency_id;
  SELECT * INTO v_owner FROM app.provision_platform_agency_agent(p_actor_user_id,p_agency_id,p_display_name,
    p_initials,p_username,p_email,p_phone,'owner',p_token_hash,p_expires_at);
  DELETE FROM iam.impersonation_sessions WHERE target_user_id=ANY(v_old_owner_ids);
  DELETE FROM iam.agency_memberships WHERE user_id=ANY(v_old_owner_ids) AND agency_id=p_agency_id;
  DELETE FROM public.platform_users legacy_user WHERE legacy_user.id=ANY(v_old_owner_legacy_ids)
    AND NOT EXISTS(SELECT 1 FROM public.agency_memberships membership WHERE membership.user_id=legacy_user.id)
    AND NOT EXISTS(SELECT 1 FROM public.traveler_profiles traveler WHERE traveler.user_id=legacy_user.id);
  DELETE FROM iam.users old_user WHERE old_user.id=ANY(v_old_owner_ids) AND old_user.platform_role<>'superadmin'
    AND NOT EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.user_id=old_user.id)
    AND NOT EXISTS(SELECT 1 FROM travel.traveler_profiles traveler WHERE traveler.user_id=old_user.id);
  RETURN QUERY SELECT v_owner.legacy_user_id,v_owner.activation_required;
END $$;

REVOKE ALL ON FUNCTION app.create_platform_agency(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),
  app.create_platform_agency_with_owner(TEXT,JSONB,TEXT,TIMESTAMPTZ),
  app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.replace_platform_agency_owner(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM smf_app;
REVOKE ALL ON FUNCTION app.create_platform_agency_with_owner(UUID,JSONB,TEXT,TIMESTAMPTZ),
  app.provision_platform_agency_agent(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.replace_platform_agency_owner(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_platform_agency_with_owner(UUID,JSONB,TEXT,TIMESTAMPTZ),
  app.provision_platform_agency_agent(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.replace_platform_agency_owner(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('159_v3_native_agency_owner_lifecycle') ON CONFLICT(version) DO NOTHING;
