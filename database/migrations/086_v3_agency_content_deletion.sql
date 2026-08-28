-- Cancellazioni governate da parte dell'agenzia: documenti in soft-delete,
-- viaggiatori rimossi dalla partenza e gruppi eliminabili solo quando vuoti.

-- Un contenuto ancora entro i sei mesi ma prodotto con un contratto AI superato
-- deve essere rigenerato: l'età da sola non è un criterio sufficiente.
CREATE OR REPLACE FUNCTION app.reference_content_needs_refresh_v3(
  p_job_id UUID,p_agency_id UUID,p_entity_type TEXT,p_entity_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ref,ops SET row_security=off AS $$
DECLARE v_expected TEXT[];v_count INTEGER;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.platform_jobs WHERE id=p_job_id AND agency_id=p_agency_id
    AND job_type='travel-reference.enrich' AND status='processing') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reference enrichment job not active';
  END IF;
  v_expected:=CASE WHEN p_entity_type='country' THEN ARRAY['useful_info','phrasebook','bingo']
    ELSE ARRAY['quiz','mission','game','photo_contest'] END;
  SELECT count(DISTINCT content_type) INTO v_count FROM ref.reference_contents content
  WHERE ((p_entity_type='country' AND country_id=p_entity_id) OR
         (p_entity_type='city' AND city_id=p_entity_id) OR
         (p_entity_type='site' AND visit_site_id=p_entity_id))
    AND content_type=ANY(v_expected) AND locale='it-IT' AND status='approved'
    AND COALESCE(refresh_after,generated_at+interval '180 days')>clock_timestamp()
    AND jsonb_typeof(content.content)='array'
    AND CASE
      WHEN p_entity_type='country' AND content_type='useful_info' THEN
        jsonb_array_length(content.content)=11 AND
        (SELECT count(DISTINCT entry->>'category') FROM jsonb_array_elements(content.content) entry)=11
      WHEN p_entity_type='country' AND content_type='phrasebook' THEN
        jsonb_array_length(content.content) IN(12,24,36) AND
        NOT EXISTS(SELECT 1 FROM jsonb_array_elements(content.content) entry
          WHERE COALESCE(entry->>'language','')='' OR COALESCE(entry->>'term','')=''
            OR COALESCE(entry->>'pronunciation','')='' OR COALESCE(entry->>'translation','')='')
      WHEN p_entity_type='country' AND content_type='bingo' THEN jsonb_array_length(content.content)=15
      ELSE true
    END;
  RETURN v_count<cardinality(v_expected);
END $$;

CREATE OR REPLACE FUNCTION app.archive_day_document_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_document_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_media_id UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  SELECT document.media_asset_id INTO v_media_id
  FROM ops.travel_documents document
  WHERE document.id=p_document_id AND document.agency_id=p_agency_id
    AND document.departure_id=p_departure_id AND document.party_id IS NOT NULL
    AND document.departure_day_id IS NOT NULL AND document.status='ready'
  FOR UPDATE;
  IF v_media_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey document not found';
  END IF;
  UPDATE ops.travel_documents SET status='archived' WHERE id=p_document_id;
  UPDATE ops.media_assets SET status='deleted',deleted_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=v_media_id AND agency_id=p_agency_id AND status<>'deleted';
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'travel_document',p_document_id::text,'archived',
    jsonb_build_object('departureId',p_departure_id,'mediaAssetId',v_media_id));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.remove_journey_traveler_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,p_traveler_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_role TEXT;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  SELECT membership.role INTO v_role FROM travel.party_memberships membership
  WHERE membership.agency_id=p_agency_id AND membership.departure_id=p_departure_id
    AND membership.party_id=p_party_id AND membership.traveler_id=p_traveler_id
    AND membership.status<>'removed' FOR UPDATE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey traveler membership not found';
  END IF;
  IF v_role='organizer' AND EXISTS(
    SELECT 1 FROM travel.party_memberships membership
    WHERE membership.agency_id=p_agency_id AND membership.departure_id=p_departure_id
      AND membership.party_id=p_party_id AND membership.traveler_id<>p_traveler_id
      AND membership.status<>'removed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='set another group leader before removal';
  END IF;
  UPDATE travel.party_memberships SET status='removed',participates_in_trip_games=false
  WHERE agency_id=p_agency_id AND departure_id=p_departure_id
    AND party_id=p_party_id AND traveler_id=p_traveler_id;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'traveler_profile',p_traveler_id::text,'removed_from_journey',
    jsonb_build_object('departureId',p_departure_id,'partyId',p_party_id));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.delete_empty_journey_party_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_deleted UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF EXISTS(SELECT 1 FROM travel.party_memberships membership
    WHERE membership.agency_id=p_agency_id AND membership.departure_id=p_departure_id
      AND membership.party_id=p_party_id AND membership.status<>'removed') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='remove all travelers before deleting the group';
  END IF;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'travel_party',p_party_id::text,'deleted',
    jsonb_build_object('departureId',p_departure_id));
  DELETE FROM travel.travel_parties party
  WHERE party.id=p_party_id AND party.agency_id=p_agency_id AND party.departure_id=p_departure_id
  RETURNING party.id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey group not found';
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.archive_day_document_v3(TEXT,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reference_content_needs_refresh_v3(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.remove_journey_traveler_v3(TEXT,UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.delete_empty_journey_party_v3(TEXT,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.archive_day_document_v3(TEXT,UUID,UUID,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.reference_content_needs_refresh_v3(UUID,UUID,TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.remove_journey_traveler_v3(TEXT,UUID,UUID,UUID,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.delete_empty_journey_party_v3(TEXT,UUID,UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('086_v3_agency_content_deletion') ON CONFLICT(version) DO NOTHING;
