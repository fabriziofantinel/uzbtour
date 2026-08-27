-- Mutazioni media atomiche e autorizzate sul modello V3.
-- Le API continuano a popolare le tabelle pubbliche durante la convergenza;
-- i trigger 023/028 replicano nello stesso commit in journey/ops.

CREATE OR REPLACE FUNCTION app.register_legacy_memory_upload(
  p_legacy_user_id TEXT,
  p_departure_id UUID,
  p_party_id UUID,
  p_template_day_id UUID,
  p_media_id UUID,
  p_memory_id UUID,
  p_provider TEXT,
  p_bucket TEXT,
  p_object_key TEXT,
  p_original_name TEXT,
  p_content_type TEXT,
  p_size_bytes BIGINT
)
RETURNS TABLE(memory_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,public
SET row_security=off
AS $$
DECLARE
  v_context RECORD;
  v_prefix TEXT;
BEGIN
  SELECT * INTO v_context
  FROM app.resolve_legacy_traveler_context(
    p_legacy_user_id,p_departure_id,p_party_id,p_template_day_id
  );
  IF v_context.agency_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler media scope denied';
  END IF;
  v_prefix := 'agencies/'||v_context.agency_id||'/departures/'||p_departure_id||
    '/parties/'||p_party_id||'/days/'||p_template_day_id||'/memories/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN ('r2','s3')
     OR p_size_bytes<=0 OR btrim(p_bucket)='' OR btrim(p_original_name)=''
     OR btrim(p_content_type)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid memory metadata';
  END IF;

  INSERT INTO public.media_assets
    (id,agency_id,departure_id,party_id,uploaded_by_user_id,provider,bucket,
     object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES
    (p_media_id,v_context.agency_id,p_departure_id,p_party_id,p_legacy_user_id,
     p_provider,p_bucket,p_object_key,p_original_name,p_content_type,p_size_bytes,
     'memory_photo','party','ready');

  RETURN QUERY
  INSERT INTO public.party_memories
    (id,agency_id,party_id,trip_day_id,media_asset_id,created_by_user_id)
  VALUES
    (p_memory_id,v_context.agency_id,p_party_id,p_template_day_id,p_media_id,p_legacy_user_id)
  RETURNING party_memories.id,party_memories.created_at;
END $$;

CREATE OR REPLACE FUNCTION app.register_legacy_ticket_upload(
  p_legacy_user_id TEXT,
  p_departure_id UUID,
  p_legacy_item_id UUID,
  p_media_id UUID,
  p_document_id UUID,
  p_provider TEXT,
  p_bucket TEXT,
  p_object_key TEXT,
  p_original_name TEXT,
  p_content_type TEXT,
  p_size_bytes BIGINT
)
RETURNS TABLE(document_id UUID, title TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public
SET row_security=off
AS $$
DECLARE
  v_agency_id UUID;
  v_prefix TEXT;
BEGIN
  SELECT item.agency_id INTO v_agency_id
  FROM ops.legacy_id_map user_map
  JOIN iam.agency_memberships membership
    ON membership.user_id=user_map.target_id
   AND membership.status='active'
   AND membership.role IN ('owner','admin','editor')
  JOIN ops.legacy_id_map item_map
    ON item_map.source_system='public-v2'
   AND item_map.entity_type='departure_item'
   AND item_map.legacy_id=p_departure_id::text||':'||p_legacy_item_id::text
   AND item_map.agency_id=membership.agency_id
  JOIN travel.departure_itinerary_items item
    ON item.id=item_map.target_id
   AND item.agency_id=membership.agency_id
   AND item.departure_id=p_departure_id
   AND item.item_type IN ('flight','train')
  WHERE user_map.source_system='public-v2'
    AND user_map.entity_type='user'
    AND user_map.legacy_id=p_legacy_user_id
  LIMIT 1;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ticket media scope denied';
  END IF;
  v_prefix := 'agencies/'||v_agency_id||'/departures/'||p_departure_id||
    '/tickets/'||p_legacy_item_id||'/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN ('r2','s3')
     OR p_size_bytes<=0 OR btrim(p_bucket)='' OR btrim(p_original_name)=''
     OR btrim(p_content_type)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid ticket metadata';
  END IF;

  INSERT INTO public.media_assets
    (id,agency_id,departure_id,uploaded_by_user_id,provider,bucket,object_key,
     original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES
    (p_media_id,v_agency_id,p_departure_id,p_legacy_user_id,p_provider,p_bucket,
     p_object_key,p_original_name,p_content_type,p_size_bytes,'travel_ticket','departure','ready');

  RETURN QUERY
  INSERT INTO public.itinerary_item_documents
    (id,agency_id,departure_id,itinerary_item_id,media_asset_id,document_type,title,
     created_by_user_id)
  VALUES
    (p_document_id,v_agency_id,p_departure_id,p_legacy_item_id,p_media_id,'ticket',
     p_original_name,p_legacy_user_id)
  RETURNING itinerary_item_documents.id,itinerary_item_documents.title,
    itinerary_item_documents.created_at;
END $$;

CREATE OR REPLACE FUNCTION app.delete_legacy_demo_media(
  p_viewer_legacy_user_id TEXT,
  p_media_kind TEXT,
  p_media_id BIGINT
)
RETURNS TABLE(deleted BOOLEAN, object_key TEXT, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public
SET row_security=off
AS $$
DECLARE
  v_owner TEXT;
  v_object_key TEXT;
  v_blocked BOOLEAN:=false;
  v_authorized BOOLEAN:=false;
BEGIN
  IF p_media_kind='photo' THEN
    SELECT photo.uploaded_by_id,photo.pathname,
      EXISTS(SELECT 1 FROM public.trip_photo_contests contest
        WHERE contest.winner_photo_id=photo.id AND contest.status='completed')
    INTO v_owner,v_object_key,v_blocked
    FROM public.trip_photos photo WHERE photo.id=p_media_id FOR UPDATE;
  ELSIF p_media_kind='contest' THEN
    SELECT photo.uploaded_by_id,photo.pathname,
      EXISTS(SELECT 1 FROM public.trip_daily_photo_contests contest
        WHERE contest.day=photo.day AND contest.contest_type=photo.contest_type
          AND contest.status='completed')
    INTO v_owner,v_object_key,v_blocked
    FROM public.trip_contest_photos photo WHERE photo.id=p_media_id FOR UPDATE;
  ELSE
    RETURN QUERY SELECT false,NULL::text,'invalid_kind'::text;
    RETURN;
  END IF;
  IF v_owner IS NULL THEN
    RETURN QUERY SELECT false,NULL::text,'not_found'::text;
    RETURN;
  END IF;

  v_authorized := v_owner=p_viewer_legacy_user_id OR EXISTS (
    SELECT 1
    FROM ops.legacy_id_map viewer_map
    JOIN iam.users viewer ON viewer.id=viewer_map.target_id AND viewer.status='active'
    WHERE viewer_map.source_system='public-v2'
      AND viewer_map.entity_type='user'
      AND viewer_map.legacy_id=p_viewer_legacy_user_id
      AND (
        viewer.platform_role='superadmin'
        OR EXISTS (
          SELECT 1
          FROM ops.legacy_id_map owner_map
          JOIN travel.traveler_profiles owner_profile ON owner_profile.user_id=owner_map.target_id
          JOIN iam.agency_memberships viewer_membership
            ON viewer_membership.agency_id=owner_profile.agency_id
           AND viewer_membership.user_id=viewer.id
           AND viewer_membership.status='active'
           AND viewer_membership.role IN ('owner','admin','editor')
          WHERE owner_map.source_system='public-v2'
            AND owner_map.entity_type='user'
            AND owner_map.legacy_id=v_owner
        )
        OR EXISTS (
          SELECT 1
          FROM ops.legacy_id_map owner_map
          JOIN iam.agency_memberships owner_membership ON owner_membership.user_id=owner_map.target_id
          JOIN iam.agency_memberships viewer_membership
            ON viewer_membership.agency_id=owner_membership.agency_id
           AND viewer_membership.user_id=viewer.id
           AND viewer_membership.status='active'
           AND viewer_membership.role IN ('owner','admin','editor')
          WHERE owner_map.source_system='public-v2'
            AND owner_map.entity_type='user'
            AND owner_map.legacy_id=v_owner
        )
      )
  );
  IF NOT v_authorized THEN
    RETURN QUERY SELECT false,NULL::text,'forbidden'::text;
    RETURN;
  END IF;
  IF v_blocked THEN
    RETURN QUERY SELECT false,NULL::text,'locked'::text;
    RETURN;
  END IF;

  IF p_media_kind='photo' THEN
    DELETE FROM public.trip_photos WHERE id=p_media_id;
  ELSE
    DELETE FROM public.trip_contest_photos WHERE id=p_media_id;
  END IF;
  RETURN QUERY SELECT true,v_object_key,NULL::text;
END $$;

REVOKE ALL ON FUNCTION app.register_legacy_memory_upload(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_legacy_ticket_upload(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.delete_legacy_demo_media(TEXT,TEXT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_legacy_memory_upload(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.register_legacy_ticket_upload(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.delete_legacy_demo_media(TEXT,TEXT,BIGINT) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('036_v3_media_mutation_authorization') ON CONFLICT(version) DO NOTHING;
