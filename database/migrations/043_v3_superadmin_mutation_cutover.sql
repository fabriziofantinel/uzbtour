-- Mutazioni superadmin V3-first per agenzie, branding e agenti.

CREATE OR REPLACE FUNCTION app.create_platform_agency(
  p_actor_legacy_user_id TEXT,p_slug TEXT,p_name TEXT,p_legal_name TEXT,
  p_vat_number TEXT,p_tax_code TEXT,p_registered_address TEXT,p_registered_city TEXT,
  p_registered_postal_code TEXT,p_registered_province TEXT,p_registered_country TEXT,
  p_pec TEXT,p_sdi_code TEXT,p_phone TEXT,p_email TEXT,p_website TEXT,
  p_reference_name TEXT,p_reference_email TEXT,p_reference_phone TEXT,p_branding JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public SET row_security=off AS $$
DECLARE v_agency_id UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy_user_id
      AND actor.status='active' AND actor.platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency creation denied';
  END IF;
  IF p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR NULLIF(btrim(p_name),'') IS NULL
    OR NULLIF(btrim(p_reference_name),'') IS NULL OR jsonb_typeof(p_branding)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid agency data';
  END IF;
  INSERT INTO iam.agencies(slug,name,status,legal_name,vat_number,tax_code,
    registered_address,registered_city,registered_postal_code,registered_province,
    registered_country_code,pec,sdi_code,phone,email,website,reference_name,
    reference_email,reference_phone,branding)
  VALUES(p_slug,btrim(p_name),'trial',NULLIF(btrim(p_legal_name),''),NULLIF(btrim(p_vat_number),''),
    NULLIF(btrim(p_tax_code),''),NULLIF(btrim(p_registered_address),''),NULLIF(btrim(p_registered_city),''),
    NULLIF(btrim(p_registered_postal_code),''),NULLIF(btrim(p_registered_province),''),
    NULLIF(upper(left(btrim(p_registered_country),2)),''),NULLIF(btrim(p_pec),''),
    NULLIF(btrim(p_sdi_code),''),NULLIF(btrim(p_phone),''),NULLIF(btrim(p_email),''),
    NULLIF(btrim(p_website),''),btrim(p_reference_name),NULLIF(btrim(p_reference_email),''),
    NULLIF(btrim(p_reference_phone),''),p_branding)
  RETURNING id INTO v_agency_id;
  INSERT INTO public.agencies(id,slug,name,status,legal_name,vat_number,tax_code,
    registered_address,registered_city,registered_postal_code,registered_province,
    registered_country,pec,sdi_code,phone,email,website,reference_name,reference_email,
    reference_phone,branding)
  VALUES(v_agency_id,p_slug,btrim(p_name),'trial',NULLIF(btrim(p_legal_name),''),
    NULLIF(btrim(p_vat_number),''),NULLIF(btrim(p_tax_code),''),NULLIF(btrim(p_registered_address),''),
    NULLIF(btrim(p_registered_city),''),NULLIF(btrim(p_registered_postal_code),''),
    NULLIF(btrim(p_registered_province),''),NULLIF(upper(left(btrim(p_registered_country),2)),''),
    NULLIF(btrim(p_pec),''),NULLIF(btrim(p_sdi_code),''),NULLIF(btrim(p_phone),''),
    NULLIF(btrim(p_email),''),NULLIF(btrim(p_website),''),btrim(p_reference_name),
    NULLIF(btrim(p_reference_email),''),NULLIF(btrim(p_reference_phone),''),p_branding);
  RETURN v_agency_id;
END $$;

CREATE OR REPLACE FUNCTION app.update_platform_agency_branding(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_primary_color TEXT,p_logo_url TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public SET row_security=off AS $$
DECLARE v_count INTEGER;v_branding JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy_user_id
      AND actor.status='active' AND actor.platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency branding update denied';
  END IF;
  IF p_primary_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid primary color';
  END IF;
  v_branding:=jsonb_build_object('primaryColor',p_primary_color,'logoUrl',COALESCE(p_logo_url,''));
  UPDATE iam.agencies SET branding=branding||v_branding,updated_at=clock_timestamp() WHERE id=p_agency_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count=0 THEN RETURN false; END IF;
  UPDATE public.agencies SET branding=branding||v_branding,updated_at=clock_timestamp() WHERE id=p_agency_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.provision_platform_agency_agent(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_display_name TEXT,p_initials TEXT,
  p_email TEXT,p_phone TEXT,p_role TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public SET row_security=off AS $$
DECLARE v_user_id UUID;v_legacy_user_id TEXT;v_status TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy_user_id
      AND actor.status='active' AND actor.platform_role='superadmin')
    OR NOT EXISTS(SELECT 1 FROM iam.agencies WHERE id=p_agency_id)
    OR p_role NOT IN('admin','editor','viewer') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency agent provisioning denied';
  END IF;
  SELECT id,status INTO v_user_id,v_status FROM iam.users
  WHERE normalized_email=lower(btrim(p_email)) FOR UPDATE;
  IF v_user_id IS NULL THEN
    INSERT INTO iam.users(display_name,email,phone,platform_role,status)
    VALUES(btrim(p_display_name),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'user','invited')
    RETURNING id,status INTO v_user_id,v_status;
  ELSE
    UPDATE iam.users SET display_name=btrim(p_display_name),
      phone=COALESCE(NULLIF(btrim(p_phone),''),phone),updated_at=clock_timestamp()
    WHERE id=v_user_id;
  END IF;
  SELECT legacy_id INTO v_legacy_user_id FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND target_id=v_user_id;
  IF v_legacy_user_id IS NULL THEN
    v_legacy_user_id:='agent:'||gen_random_uuid()::text;
    INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,target_id,agency_id)
    VALUES('public-v2','user',v_legacy_user_id,v_user_id,p_agency_id);
  END IF;
  INSERT INTO public.platform_users(id,display_name,initials,email,phone,auth_provider,platform_role,status)
  VALUES(v_legacy_user_id,btrim(p_display_name),left(p_initials,8),lower(btrim(p_email)),
    NULLIF(btrim(p_phone),''),'neon','user',v_status)
  ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,initials=EXCLUDED.initials,
    email=EXCLUDED.email,phone=COALESCE(EXCLUDED.phone,public.platform_users.phone),updated_at=clock_timestamp();
  INSERT INTO iam.agency_memberships(agency_id,user_id,role,status)
  VALUES(p_agency_id,v_user_id,p_role,CASE WHEN v_status='active' THEN 'active' ELSE 'invited' END)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status;
  INSERT INTO public.agency_memberships(agency_id,user_id,role)
  VALUES(p_agency_id,v_legacy_user_id,p_role)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET role=EXCLUDED.role;
  UPDATE iam.agency_memberships SET status=CASE WHEN v_status='active' THEN 'active' ELSE 'invited' END
  WHERE agency_id=p_agency_id AND user_id=v_user_id;
  RETURN v_legacy_user_id;
END $$;

REVOKE ALL ON FUNCTION app.create_platform_agency(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_platform_agency_branding(TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_platform_agency(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO smf_app;
GRANT EXECUTE ON FUNCTION app.update_platform_agency_branding(TEXT,UUID,TEXT,TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('043_v3_superadmin_mutation_cutover') ON CONFLICT(version) DO NOTHING;
