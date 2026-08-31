-- The public V2 shadow-write triggers were retired by migration 050. Keep the
-- stable runtime function signatures, but persist new memories and tickets
-- directly in the normalized V3 model.

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
DECLARE v_context RECORD;v_day_id UUID;v_prefix TEXT;
BEGIN
  SELECT * INTO v_context FROM app.resolve_legacy_traveler_context(
    p_legacy_user_id,p_departure_id,p_party_id,p_template_day_id);
  IF v_context.agency_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler media scope denied';
  END IF;
  SELECT id INTO v_day_id FROM travel.departure_days
   WHERE agency_id=v_context.agency_id AND departure_id=p_departure_id
     AND template_day_id=p_template_day_id;
  IF v_day_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid memory day';
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
  VALUES(p_media_id,v_context.agency_id,p_departure_id,p_party_id,
    (SELECT user_id FROM travel.traveler_profiles WHERE agency_id=v_context.agency_id AND id=v_context.traveler_id),
    p_provider,p_bucket,p_object_key,p_original_name,p_content_type,p_size_bytes,'memory','party','ready');
  RETURN QUERY INSERT INTO journey.memories(id,agency_id,departure_id,party_id,departure_day_id,
    media_asset_id,created_by_traveler_id,client_operation_id)
  VALUES(p_memory_id,v_context.agency_id,p_departure_id,p_party_id,v_day_id,p_media_id,
    v_context.traveler_id,p_memory_id)
  RETURNING journey.memories.id,journey.memories.created_at;
END $$;

CREATE OR REPLACE FUNCTION app.register_legacy_ticket_upload(
  p_legacy_user_id TEXT,p_departure_id UUID,p_legacy_item_id UUID,p_media_id UUID,
  p_document_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,p_original_name TEXT,
  p_content_type TEXT,p_size_bytes BIGINT
)
RETURNS TABLE(document_id UUID,title TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops
SET row_security=off
AS $$
DECLARE v_agency_id UUID;v_actor UUID;v_item_id UUID;v_prefix TEXT;
BEGIN
  SELECT item.agency_id,user_map.target_id,item.id INTO v_agency_id,v_actor,v_item_id
  FROM ops.legacy_id_map user_map
  JOIN iam.agency_memberships membership ON membership.user_id=user_map.target_id
    AND membership.status='active' AND membership.role IN ('owner','admin','editor')
  JOIN ops.legacy_id_map item_map ON item_map.source_system='public-v2'
    AND item_map.entity_type='departure_item'
    AND item_map.legacy_id=p_departure_id::text||':'||p_legacy_item_id::text
    AND item_map.agency_id=membership.agency_id
  JOIN travel.departure_itinerary_items item ON item.id=item_map.target_id
    AND item.agency_id=membership.agency_id AND item.departure_id=p_departure_id
    AND item.item_type IN ('flight','train')
  WHERE user_map.source_system='public-v2' AND user_map.entity_type='user'
    AND user_map.legacy_id=p_legacy_user_id LIMIT 1;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ticket media scope denied';
  END IF;
  v_prefix:='agencies/'||v_agency_id||'/departures/'||p_departure_id||'/tickets/'||p_legacy_item_id||'/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN ('r2','s3')
     OR p_size_bytes<=0 OR btrim(p_bucket)='' OR btrim(p_original_name)=''
     OR btrim(p_content_type)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid ticket metadata';
  END IF;
  INSERT INTO ops.media_assets(id,agency_id,departure_id,uploaded_by_user_id,provider,bucket,
    object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_media_id,v_agency_id,p_departure_id,v_actor,p_provider,p_bucket,p_object_key,
    p_original_name,p_content_type,p_size_bytes,'ticket','departure','ready');
  RETURN QUERY INSERT INTO ops.travel_documents(id,agency_id,departure_id,departure_item_id,
    media_asset_id,document_type,title,status)
  VALUES(p_document_id,v_agency_id,p_departure_id,v_item_id,p_media_id,'ticket',p_original_name,'ready')
  RETURNING ops.travel_documents.id,ops.travel_documents.title,ops.travel_documents.created_at;
END $$;

REVOKE ALL ON FUNCTION app.register_legacy_memory_upload(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_legacy_ticket_upload(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_legacy_memory_upload(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.register_legacy_ticket_upload(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('119_v3_normalized_media_registration') ON CONFLICT(version) DO NOTHING;
