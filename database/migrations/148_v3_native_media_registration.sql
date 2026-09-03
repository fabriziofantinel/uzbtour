-- consolidation-approval: move media registration authorization to native IAM UUIDs

CREATE OR REPLACE FUNCTION app.require_agency_editor_v3(p_actor_user_id UUID,p_agency_id UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users actor
    LEFT JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.agency_id=p_agency_id AND membership.status='active'
      AND membership.role IN('owner','admin','editor')
    WHERE actor.id=p_actor_user_id AND actor.status='active'
      AND (actor.platform_role='superadmin' OR membership.user_id IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency editor access denied';
  END IF;
  RETURN p_actor_user_id;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_traveler_context_v3(
  p_actor_user_id UUID,p_departure_id UUID,p_party_id UUID,p_template_day_id UUID DEFAULT NULL
)
RETURNS TABLE(agency_id UUID,template_version_id UUID,traveler_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,travel SET row_security=off AS $$
  SELECT departure.agency_id,departure.template_version_id,profile.id
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
    AND membership.traveler_id=profile.id AND membership.status='active'
  JOIN travel.travel_parties party ON party.agency_id=membership.agency_id
    AND party.departure_id=membership.departure_id AND party.id=membership.party_id
  JOIN travel.departures departure ON departure.agency_id=party.agency_id AND departure.id=party.departure_id
  WHERE profile.user_id=p_actor_user_id AND departure.id=p_departure_id AND party.id=p_party_id
    AND (p_template_day_id IS NULL OR EXISTS(SELECT 1 FROM travel.template_days day
      WHERE day.agency_id=departure.agency_id AND day.template_version_id=departure.template_version_id
        AND day.id=p_template_day_id))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.register_memory_upload_v3(
  p_actor_user_id UUID,p_departure_id UUID,p_party_id UUID,p_template_day_id UUID,
  p_media_id UUID,p_memory_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,
  p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT
)
RETURNS TABLE(memory_id UUID,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey,ops SET row_security=off AS $$
DECLARE v_context RECORD;v_day_id UUID;v_prefix TEXT;
BEGIN
  SELECT * INTO v_context FROM app.resolve_traveler_context_v3(
    p_actor_user_id,p_departure_id,p_party_id,p_template_day_id);
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
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN('r2','s3')
    OR p_size_bytes<=0 OR btrim(p_bucket)='' OR btrim(p_original_name)=''
    OR btrim(p_content_type)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid memory metadata';
  END IF;
  INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,
    provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_media_id,v_context.agency_id,p_departure_id,p_party_id,p_actor_user_id,
    p_provider,p_bucket,p_object_key,p_original_name,p_content_type,p_size_bytes,'memory','party','ready');
  RETURN QUERY INSERT INTO journey.memories(id,agency_id,departure_id,party_id,departure_day_id,
    media_asset_id,created_by_traveler_id,client_operation_id)
  VALUES(p_memory_id,v_context.agency_id,p_departure_id,p_party_id,v_day_id,p_media_id,
    v_context.traveler_id,p_memory_id)
  RETURNING journey.memories.id,journey.memories.created_at;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_context.agency_id,p_actor_user_id,'media_asset',p_media_id::text,'privacy_attestation',
    jsonb_build_object('departureId',p_departure_id,'partyId',p_party_id,'minorConsentRequired',true));
END $$;

CREATE OR REPLACE FUNCTION app.register_ticket_upload_v3(
  p_actor_user_id UUID,p_departure_id UUID,p_legacy_item_id UUID,p_media_id UUID,
  p_document_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,p_original_name TEXT,
  p_content_type TEXT,p_size_bytes BIGINT
)
RETURNS TABLE(document_id UUID,title TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_agency_id UUID;v_item_id UUID;v_prefix TEXT;
BEGIN
  SELECT item.agency_id,item.id INTO v_agency_id,v_item_id
  FROM ops.legacy_id_map item_map
  JOIN travel.departure_itinerary_items item ON item.id=item_map.target_id
    AND item.agency_id=item_map.agency_id AND item.departure_id=p_departure_id
    AND item.item_type IN('flight','train')
  WHERE item_map.source_system='public-v2' AND item_map.entity_type='departure_item'
    AND item_map.legacy_id=p_departure_id::text||':'||p_legacy_item_id::text
  LIMIT 1;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ticket media scope denied';
  END IF;
  PERFORM app.require_agency_editor_v3(p_actor_user_id,v_agency_id);
  v_prefix:='agencies/'||v_agency_id||'/departures/'||p_departure_id||'/tickets/'||p_legacy_item_id||'/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN('r2','s3')
    OR p_size_bytes<=0 OR btrim(p_bucket)='' OR btrim(p_original_name)=''
    OR btrim(p_content_type)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid ticket metadata';
  END IF;
  INSERT INTO ops.media_assets(id,agency_id,departure_id,uploaded_by_user_id,provider,bucket,
    object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_media_id,v_agency_id,p_departure_id,p_actor_user_id,p_provider,p_bucket,p_object_key,
    p_original_name,p_content_type,p_size_bytes,'ticket','departure','ready');
  RETURN QUERY INSERT INTO ops.travel_documents(id,agency_id,departure_id,departure_item_id,
    media_asset_id,document_type,title,status)
  VALUES(p_document_id,v_agency_id,p_departure_id,v_item_id,p_media_id,'ticket',p_original_name,'ready')
  RETURNING ops.travel_documents.id,ops.travel_documents.title,ops.travel_documents.created_at;
END $$;

CREATE OR REPLACE FUNCTION app.register_departure_day_document_v3(
  p_actor_user_id UUID,p_departure_id UUID,p_day_id UUID,p_party_id UUID,
  p_media_id UUID,p_document_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,
  p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT,p_description TEXT
)
RETURNS TABLE(document_id UUID,title TEXT,description TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_prefix TEXT;v_description TEXT;
BEGIN
  SELECT day.agency_id INTO v_agency FROM travel.departure_days day
  JOIN travel.travel_parties party ON party.agency_id=day.agency_id
    AND party.departure_id=day.departure_id AND party.id=p_party_id AND party.status<>'archived'
  WHERE day.id=p_day_id AND day.departure_id=p_departure_id;
  IF v_agency IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='departure day or group not found';
  END IF;
  PERFORM app.require_agency_editor_v3(p_actor_user_id,v_agency);
  v_description:=btrim(COALESCE(p_description,''));
  v_prefix:='agencies/'||v_agency||'/departures/'||p_departure_id||'/parties/'||p_party_id||'/days/'||p_day_id||'/documents/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN('r2','s3')
    OR p_size_bytes<=0 OR p_size_bytes>26214400 OR btrim(p_bucket)=''
    OR btrim(p_original_name)='' OR btrim(p_content_type)='' OR v_description='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid group day document metadata';
  END IF;
  INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,
    provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_media_id,v_agency,p_departure_id,p_party_id,p_actor_user_id,p_provider,p_bucket,p_object_key,
    p_original_name,p_content_type,p_size_bytes,'other','party','ready');
  RETURN QUERY INSERT INTO ops.travel_documents(id,agency_id,departure_id,departure_day_id,
    party_id,media_asset_id,document_type,title,description,status)
  VALUES(p_document_id,v_agency,p_departure_id,p_day_id,p_party_id,p_media_id,'other',
    p_original_name,v_description,'ready')
  RETURNING ops.travel_documents.id,ops.travel_documents.title,
    ops.travel_documents.description,ops.travel_documents.created_at;
END $$;

REVOKE ALL ON FUNCTION app.require_agency_editor_v3(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_traveler_context_v3(UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_memory_upload_v3(UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_ticket_upload_v3(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_departure_day_document_v3(UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.require_agency_editor_v3(UUID,UUID),
  app.resolve_traveler_context_v3(UUID,UUID,UUID,UUID),
  app.register_memory_upload_v3(UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),
  app.register_ticket_upload_v3(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),
  app.register_departure_day_document_v3(UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT)
  TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('148_v3_native_media_registration') ON CONFLICT(version) DO NOTHING;
