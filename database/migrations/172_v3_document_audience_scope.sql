ALTER TABLE ops.travel_documents ADD COLUMN IF NOT EXISTS traveler_id UUID REFERENCES travel.traveler_profiles(id) ON DELETE CASCADE;
ALTER TABLE ops.travel_documents DROP CONSTRAINT IF EXISTS travel_documents_day_requires_party_ck;
ALTER TABLE ops.travel_documents DROP CONSTRAINT IF EXISTS travel_documents_day_audience_ck;
ALTER TABLE ops.travel_documents ADD CONSTRAINT travel_documents_day_audience_ck CHECK(
  departure_day_id IS NULL OR traveler_id IS NULL OR party_id IS NOT NULL
) NOT VALID;
CREATE INDEX IF NOT EXISTS travel_documents_audience_ready_idx ON ops.travel_documents(agency_id,departure_id,party_id,traveler_id,departure_day_id,created_at DESC,id) WHERE status='ready' AND departure_day_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.register_departure_day_document_v3(
  p_actor_user_id UUID,p_departure_id UUID,p_day_id UUID,p_scope TEXT,p_party_id UUID,p_traveler_id UUID,
  p_media_id UUID,p_document_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT,p_description TEXT
) RETURNS TABLE(document_id UUID,title TEXT,description TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_prefix TEXT;v_description TEXT;v_visibility TEXT;
BEGIN
 SELECT day.agency_id INTO v_agency FROM travel.departure_days day WHERE day.id=p_day_id AND day.departure_id=p_departure_id;
 IF v_agency IS NULL OR p_scope NOT IN('trip','group','traveler') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid document audience';END IF;
 PERFORM app.require_agency_editor_v3(p_actor_user_id,v_agency);
 IF p_scope='trip' AND (p_party_id IS NOT NULL OR p_traveler_id IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid trip document audience';END IF;
 IF p_scope='group' AND (p_party_id IS NULL OR p_traveler_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM travel.travel_parties party WHERE party.agency_id=v_agency AND party.departure_id=p_departure_id AND party.id=p_party_id AND party.status<>'archived')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid group document audience';END IF;
 IF p_scope='traveler' AND (p_party_id IS NULL OR p_traveler_id IS NULL OR NOT EXISTS(SELECT 1 FROM travel.party_memberships membership WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure_id AND membership.party_id=p_party_id AND membership.traveler_id=p_traveler_id AND membership.status='active')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid traveler document audience';END IF;
 v_description:=btrim(COALESCE(p_description,'')); v_prefix:='agencies/'||v_agency||'/departures/'||p_departure_id||'/'||CASE p_scope WHEN 'trip' THEN 'trip' WHEN 'group' THEN 'groups/'||p_party_id ELSE 'travelers/'||p_traveler_id END||'/days/'||p_day_id||'/documents/';
 IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN('r2','s3') OR p_size_bytes<=0 OR p_size_bytes>26214400 OR btrim(p_bucket)='' OR btrim(p_original_name)='' OR btrim(p_content_type)='' OR v_description='' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid document metadata';END IF;
 v_visibility:=CASE p_scope WHEN 'trip' THEN 'agency' WHEN 'group' THEN 'party' ELSE 'private' END;
 INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
 VALUES(p_media_id,v_agency,p_departure_id,p_party_id,p_actor_user_id,p_provider,p_bucket,p_object_key,p_original_name,p_content_type,p_size_bytes,'other',v_visibility,'ready');
 RETURN QUERY INSERT INTO ops.travel_documents(id,agency_id,departure_id,departure_day_id,party_id,traveler_id,media_asset_id,document_type,title,description,status)
 VALUES(p_document_id,v_agency,p_departure_id,p_day_id,p_party_id,p_traveler_id,p_media_id,'other',p_original_name,v_description,'ready') RETURNING ops.travel_documents.id,ops.travel_documents.title,ops.travel_documents.description,ops.travel_documents.created_at;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_travel_document_download_v3(p_actor_user_id UUID,p_document_id UUID)
RETURNS TABLE(provider TEXT,bucket TEXT,object_key TEXT,original_name TEXT,content_type TEXT) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
 SELECT asset.provider::text,asset.bucket,asset.object_key,asset.original_name,asset.content_type FROM ops.travel_documents document
 JOIN ops.media_assets asset ON asset.agency_id=document.agency_id AND asset.id=document.media_asset_id
 WHERE document.id=p_document_id AND document.departure_id IS NOT NULL AND document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
 AND (EXISTS(SELECT 1 FROM iam.agency_memberships member WHERE member.agency_id=document.agency_id AND member.user_id=p_actor_user_id AND member.status='active' AND member.role IN('owner','admin','editor')) OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id AND membership.status='active' WHERE profile.user_id=p_actor_user_id AND membership.agency_id=document.agency_id AND membership.departure_id=document.departure_id AND (document.party_id IS NULL OR membership.party_id=document.party_id) AND (document.traveler_id IS NULL OR profile.id=document.traveler_id))) LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.register_departure_day_document_v3(UUID,UUID,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT),app.resolve_travel_document_download_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_departure_day_document_v3(UUID,UUID,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT),app.resolve_travel_document_download_v3(UUID,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('172_v3_document_audience_scope') ON CONFLICT(version) DO NOTHING;
