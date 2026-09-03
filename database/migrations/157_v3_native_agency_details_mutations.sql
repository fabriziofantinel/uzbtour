CREATE OR REPLACE FUNCTION app.update_platform_agency_branding(
  p_actor_user_id UUID,p_agency_id UUID,p_primary_color TEXT,p_logo_url TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,public SET row_security=off AS $$
DECLARE v_count INTEGER;v_branding JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency branding update denied';
  END IF;
  IF p_primary_color !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid primary color'; END IF;
  v_branding:=jsonb_build_object('primaryColor',p_primary_color,'logoUrl',COALESCE(p_logo_url,''));
  UPDATE iam.agencies SET branding=branding||v_branding,updated_at=clock_timestamp() WHERE id=p_agency_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count=0 THEN RETURN false; END IF;
  UPDATE public.agencies SET branding=branding||v_branding,updated_at=clock_timestamp() WHERE id=p_agency_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.update_platform_agency_status(p_actor_user_id UUID,p_agency_id UUID,p_status TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,public SET row_security=off AS $$
BEGIN
  IF p_status NOT IN('trial','active','suspended') OR NOT EXISTS(
    SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency status update denied';
  END IF;
  UPDATE iam.agencies SET status=p_status,updated_at=clock_timestamp()
  WHERE id=p_agency_id AND status NOT IN('deleting','closed');
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.agencies SET status=p_status,updated_at=clock_timestamp() WHERE id=p_agency_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.update_platform_agency_owner_contact(
  p_actor_user_id UUID,p_agency_id UUID,p_email TEXT,p_phone TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public SET row_security=off AS $$
DECLARE v_owner_id UUID;v_owner_legacy_id TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner contact update denied';
  END IF;
  UPDATE iam.agencies SET reference_email=lower(btrim(p_email)),reference_phone=btrim(p_phone),updated_at=clock_timestamp()
  WHERE id=p_agency_id AND status NOT IN('closed','deleting');
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  UPDATE public.agencies SET reference_email=lower(btrim(p_email)),reference_phone=btrim(p_phone),updated_at=clock_timestamp()
  WHERE id=p_agency_id;
  SELECT membership.user_id INTO v_owner_id FROM iam.agency_memberships AS membership
  WHERE membership.agency_id=p_agency_id AND membership.role='owner' AND membership.status<>'revoked'
  ORDER BY membership.created_at DESC LIMIT 1;
  IF v_owner_id IS NOT NULL THEN
    SELECT legacy_id INTO v_owner_legacy_id FROM ops.legacy_id_map
    WHERE source_system='public-v2' AND entity_type='user' AND target_id=v_owner_id LIMIT 1;
    UPDATE iam.users SET email=lower(btrim(p_email)),phone=btrim(p_phone),updated_at=clock_timestamp() WHERE id=v_owner_id;
    UPDATE public.platform_users SET email=lower(btrim(p_email)),phone=btrim(p_phone),updated_at=clock_timestamp()
    WHERE id=v_owner_legacy_id;
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.update_platform_agency_details(p_actor_user_id UUID,p_agency_id UUID,p_data JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,public SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency details update denied';
  END IF;
  UPDATE iam.agencies SET name=btrim(p_data->>'name'),legal_name=NULLIF(btrim(p_data->>'legalName'),''),
    vat_number=NULLIF(btrim(p_data->>'vatNumber'),''),tax_code=NULLIF(btrim(p_data->>'taxCode'),''),
    registered_address=NULLIF(btrim(p_data->>'registeredAddress'),''),registered_city=NULLIF(btrim(p_data->>'registeredCity'),''),
    registered_postal_code=NULLIF(btrim(p_data->>'registeredPostalCode'),''),registered_province=NULLIF(btrim(p_data->>'registeredProvince'),''),
    registered_country_code=NULLIF(upper(left(btrim(p_data->>'registeredCountry'),2)),''),pec=NULLIF(lower(btrim(p_data->>'pec')),''),
    sdi_code=NULLIF(btrim(p_data->>'sdiCode'),''),phone=NULLIF(btrim(p_data->>'phone'),''),
    email=NULLIF(lower(btrim(p_data->>'email')),''),website=NULLIF(btrim(p_data->>'website'),''),updated_at=clock_timestamp()
  WHERE id=p_agency_id AND status NOT IN('closed','deleting');
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  UPDATE public.agencies SET name=btrim(p_data->>'name'),legal_name=NULLIF(btrim(p_data->>'legalName'),''),
    vat_number=NULLIF(btrim(p_data->>'vatNumber'),''),tax_code=NULLIF(btrim(p_data->>'taxCode'),''),
    registered_address=NULLIF(btrim(p_data->>'registeredAddress'),''),registered_city=NULLIF(btrim(p_data->>'registeredCity'),''),
    registered_postal_code=NULLIF(btrim(p_data->>'registeredPostalCode'),''),registered_province=NULLIF(btrim(p_data->>'registeredProvince'),''),
    registered_country=NULLIF(upper(left(btrim(p_data->>'registeredCountry'),2)),''),pec=NULLIF(lower(btrim(p_data->>'pec')),''),
    sdi_code=NULLIF(btrim(p_data->>'sdiCode'),''),phone=NULLIF(btrim(p_data->>'phone'),''),
    email=NULLIF(lower(btrim(p_data->>'email')),''),website=NULLIF(btrim(p_data->>'website'),''),updated_at=clock_timestamp()
  WHERE id=p_agency_id;
  PERFORM app.update_platform_agency_owner_contact(p_actor_user_id,p_agency_id,p_data->>'referenceEmail',p_data->>'referencePhone');
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.update_platform_agency_branding(TEXT,UUID,TEXT,TEXT),
  app.update_platform_agency_status(TEXT,UUID,TEXT),
  app.update_platform_agency_owner_contact(TEXT,UUID,TEXT,TEXT),
  app.update_platform_agency_details(TEXT,UUID,JSONB) FROM smf_app;
REVOKE ALL ON FUNCTION app.update_platform_agency_branding(UUID,UUID,TEXT,TEXT),
  app.update_platform_agency_status(UUID,UUID,TEXT),
  app.update_platform_agency_owner_contact(UUID,UUID,TEXT,TEXT),
  app.update_platform_agency_details(UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_platform_agency_branding(UUID,UUID,TEXT,TEXT),
  app.update_platform_agency_status(UUID,UUID,TEXT),
  app.update_platform_agency_owner_contact(UUID,UUID,TEXT,TEXT),
  app.update_platform_agency_details(UUID,UUID,JSONB) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('157_v3_native_agency_details_mutations') ON CONFLICT(version) DO NOTHING;
