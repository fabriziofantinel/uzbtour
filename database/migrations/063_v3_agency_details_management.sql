CREATE OR REPLACE FUNCTION app.update_platform_agency_details(p_actor_legacy_user_id TEXT,p_agency_id UUID,p_data JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy_user_id
      AND actor.status='active' AND actor.platform_role='superadmin') THEN
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
  PERFORM app.update_platform_agency_owner_contact(p_actor_legacy_user_id,p_agency_id,p_data->>'referenceEmail',p_data->>'referencePhone');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.update_platform_agency_details(TEXT,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_platform_agency_details(TEXT,UUID,JSONB) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('063_v3_agency_details_management') ON CONFLICT(version) DO NOTHING;
