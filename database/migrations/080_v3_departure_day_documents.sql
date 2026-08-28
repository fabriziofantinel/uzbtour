-- Documenti privati associati a una giornata della partenza.
ALTER TABLE ops.travel_documents
  ADD COLUMN IF NOT EXISTS departure_day_id UUID,
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='ops.travel_documents'::regclass
      AND conname='travel_documents_departure_day_fk'
  ) THEN
    ALTER TABLE ops.travel_documents
      ADD CONSTRAINT travel_documents_departure_day_fk
      FOREIGN KEY(agency_id,departure_id,departure_day_id)
      REFERENCES travel.departure_days(agency_id,departure_id,id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS travel_documents_day_ready_idx
  ON ops.travel_documents(agency_id,departure_id,departure_day_id,created_at DESC,id)
  WHERE status='ready' AND departure_day_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.register_departure_day_document(
  p_actor_legacy_user_id TEXT,p_departure_id UUID,p_day_id UUID,p_media_id UUID,
  p_document_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,
  p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT,p_description TEXT
)
RETURNS TABLE(document_id UUID,title TEXT,description TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_actor UUID;v_prefix TEXT;v_description TEXT;
BEGIN
  SELECT day.agency_id INTO v_agency
  FROM travel.departure_days day
  WHERE day.id=p_day_id AND day.departure_id=p_departure_id;
  IF v_agency IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='departure day not found';
  END IF;
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,v_agency);
  v_description:=btrim(COALESCE(p_description,''));
  v_prefix:='agencies/'||v_agency||'/departures/'||p_departure_id||'/days/'||p_day_id||'/documents/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN('r2','s3')
     OR p_size_bytes<=0 OR p_size_bytes>26214400 OR btrim(p_bucket)=''
     OR btrim(p_original_name)='' OR btrim(p_content_type)='' OR v_description='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid day document metadata';
  END IF;

  INSERT INTO ops.media_assets(
    id,agency_id,departure_id,uploaded_by_user_id,provider,bucket,object_key,
    original_name,content_type,size_bytes,purpose,visibility,status
  ) VALUES(
    p_media_id,v_agency,p_departure_id,v_actor,p_provider,p_bucket,p_object_key,
    p_original_name,p_content_type,p_size_bytes,'other','departure','ready'
  );

  RETURN QUERY INSERT INTO ops.travel_documents(
    id,agency_id,departure_id,departure_day_id,media_asset_id,document_type,
    title,description,status
  ) VALUES(
    p_document_id,v_agency,p_departure_id,p_day_id,p_media_id,'other',
    p_original_name,v_description,'ready'
  ) RETURNING ops.travel_documents.id,ops.travel_documents.title,
      ops.travel_documents.description,ops.travel_documents.created_at;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_travel_document_download(
  p_legacy_user_id TEXT,p_document_id UUID
)
RETURNS TABLE(provider TEXT,bucket TEXT,object_key TEXT,original_name TEXT,content_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
  SELECT asset.provider::text,asset.bucket,asset.object_key,asset.original_name,asset.content_type
  FROM ops.travel_documents document
  JOIN ops.media_assets asset ON asset.agency_id=document.agency_id AND asset.id=document.media_asset_id
  WHERE document.id=p_document_id AND document.departure_id IS NOT NULL
    AND (document.departure_item_id IS NOT NULL OR document.departure_day_id IS NOT NULL)
    AND document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
    AND EXISTS(
      SELECT 1 FROM ops.legacy_id_map map
      WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_legacy_user_id
        AND (EXISTS(
          SELECT 1 FROM iam.agency_memberships membership
          WHERE membership.agency_id=document.agency_id AND membership.user_id=map.target_id
            AND membership.status='active' AND membership.role IN('owner','admin','editor')
        ) OR EXISTS(
          SELECT 1 FROM travel.traveler_profiles profile
          JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
            AND membership.traveler_id=profile.id AND membership.status='active'
          WHERE profile.user_id=map.target_id AND membership.agency_id=document.agency_id
            AND membership.departure_id=document.departure_id
        ))
    ) LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.register_departure_day_document(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_departure_day_document(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT) TO smf_app;
REVOKE ALL ON FUNCTION app.resolve_legacy_travel_document_download(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_travel_document_download(TEXT,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('080_v3_departure_day_documents') ON CONFLICT(version) DO NOTHING;
