CREATE OR REPLACE FUNCTION app.register_legacy_memory_upload(
  p_legacy_user_id TEXT,p_departure_id UUID,p_party_id UUID,p_template_day_id UUID,
  p_media_id UUID,p_memory_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,
  p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT
)
RETURNS TABLE(memory_id UUID,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey,ops
SET row_security=off
AS $$
DECLARE v_context RECORD;v_day_id UUID;v_actor UUID;v_prefix TEXT;
BEGIN
  SELECT * INTO v_context FROM app.resolve_legacy_traveler_context(
    p_legacy_user_id,p_departure_id,p_party_id,p_template_day_id);
  IF v_context.agency_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler media scope denied';
  END IF;
  SELECT id INTO v_day_id FROM travel.departure_days
   WHERE agency_id=v_context.agency_id AND departure_id=p_departure_id
     AND template_day_id=p_template_day_id;
  SELECT user_id INTO v_actor FROM travel.traveler_profiles
   WHERE agency_id=v_context.agency_id AND id=v_context.traveler_id;
  IF v_day_id IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid memory day or actor';
  END IF;
  v_prefix:='agencies/'||v_context.agency_id||'/departures/'||p_departure_id||
    '/parties/'||p_party_id||'/days/'||p_template_day_id||'/memories/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN ('r2','s3')
     OR p_size_bytes<=0 OR btrim(p_bucket)='' OR btrim(p_original_name)=''
     OR btrim(p_content_type)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid memory metadata';
  END IF;
  INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,
    provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_media_id,v_context.agency_id,p_departure_id,p_party_id,v_actor,
    p_provider,p_bucket,p_object_key,p_original_name,p_content_type,p_size_bytes,'memory','party','ready');
  RETURN QUERY INSERT INTO journey.memories(id,agency_id,departure_id,party_id,departure_day_id,
    media_asset_id,created_by_traveler_id,client_operation_id)
  VALUES(p_memory_id,v_context.agency_id,p_departure_id,p_party_id,v_day_id,p_media_id,
    v_context.traveler_id,p_memory_id)
  RETURNING journey.memories.id,journey.memories.created_at;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_context.agency_id,v_actor,'media_asset',p_media_id::text,'privacy_attestation',
    jsonb_build_object('departureId',p_departure_id,'partyId',p_party_id,'minorConsentRequired',true));
END $$;

REVOKE ALL ON FUNCTION app.register_legacy_memory_upload(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_legacy_memory_upload(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('121_v3_memory_privacy_audit') ON CONFLICT(version) DO NOTHING;
