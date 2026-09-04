-- Le comunicazioni operative possono essere indirizzate all'intera partenza,
-- a un gruppo oppure a uno specifico viaggiatore.

ALTER TABLE ops.traveler_change_notices
  ADD COLUMN IF NOT EXISTS audience_traveler_ids UUID[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION app.snapshot_traveler_change_notice_recipients_v3()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey,ops SET row_security=off AS $$
BEGIN
 INSERT INTO ops.traveler_change_notice_recipients(
  agency_id,notice_id,departure_id,party_id,traveler_id,user_id,reachable_by_push)
 SELECT membership.agency_id,NEW.id,membership.departure_id,membership.party_id,membership.traveler_id,profile.user_id,
  EXISTS(SELECT 1 FROM journey.web_push_subscriptions subscription
   WHERE subscription.agency_id=membership.agency_id AND subscription.traveler_id=membership.traveler_id
    AND subscription.revoked_at IS NULL AND (subscription.expires_at IS NULL OR subscription.expires_at>clock_timestamp()))
 FROM travel.party_memberships membership JOIN travel.traveler_profiles profile
  ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
 WHERE membership.agency_id=NEW.agency_id AND membership.departure_id=NEW.departure_id AND membership.status='active'
  AND (cardinality(NEW.audience_party_ids)=0 OR membership.party_id=ANY(NEW.audience_party_ids))
  AND (cardinality(NEW.audience_traveler_ids)=0 OR membership.traveler_id=ANY(NEW.audience_traveler_ids))
 ON CONFLICT(notice_id,traveler_id) DO NOTHING;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.publish_departure_communication_v3(
  p_actor_legacy TEXT,p_departure UUID,p_title TEXT,p_summary TEXT,p_severity TEXT,
  p_requires_ack BOOLEAN,p_acknowledge_by TIMESTAMPTZ,p_audience_parties UUID[],p_audience_travelers UUID[],p_operation UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_notice UUID;v_existing UUID;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure
 JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id
  AND membership.user_id=v_actor AND membership.status='active' AND membership.role IN('owner','admin','editor')
 WHERE departure.id=p_departure AND departure.status NOT IN('cancelled','archived') LIMIT 1;
 IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='communication publication not authorized';END IF;
 IF btrim(COALESCE(p_title,''))='' OR btrim(COALESCE(p_summary,''))='' OR p_severity NOT IN('information','important','urgent') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid communication';END IF;
 IF COALESCE(cardinality(p_audience_parties),0)>0 AND EXISTS(
  SELECT 1 FROM unnest(p_audience_parties) audience_party_id WHERE NOT EXISTS(
   SELECT 1 FROM travel.travel_parties party WHERE party.agency_id=v_agency AND party.departure_id=p_departure AND party.id=audience_party_id))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid communication group audience';END IF;
 IF COALESCE(cardinality(p_audience_travelers),0)>0 AND EXISTS(
  SELECT 1 FROM unnest(p_audience_travelers) audience_traveler_id WHERE NOT EXISTS(
   SELECT 1 FROM travel.party_memberships membership
   WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure
    AND membership.traveler_id=audience_traveler_id AND membership.status='active'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid communication traveler audience';END IF;
 IF COALESCE(cardinality(p_audience_travelers),0)>0 AND COALESCE(cardinality(p_audience_parties),0)>0 AND EXISTS(
  SELECT 1 FROM unnest(p_audience_travelers) audience_traveler_id WHERE NOT EXISTS(
   SELECT 1 FROM travel.party_memberships membership WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure
    AND membership.traveler_id=audience_traveler_id AND membership.party_id=ANY(p_audience_parties) AND membership.status='active'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='traveler does not belong to selected communication group';END IF;
 SELECT notice.id INTO v_existing FROM ops.traveler_change_notices notice
  WHERE notice.agency_id=v_agency AND notice.client_operation_id=p_operation LIMIT 1;
 IF v_existing IS NOT NULL THEN RETURN v_existing;END IF;
 INSERT INTO ops.traveler_change_notices(
  agency_id,departure_id,change_type,severity,title,summary,changed_by,kind,
  requires_acknowledgement,acknowledge_by,audience_party_ids,audience_traveler_ids,client_operation_id)
 VALUES(v_agency,p_departure,'other',p_severity,left(btrim(p_title),180),btrim(p_summary),v_actor,'announcement',
  p_requires_ack,p_acknowledge_by,COALESCE(p_audience_parties,'{}'),COALESCE(p_audience_travelers,'{}'),p_operation) RETURNING id INTO v_notice;
 RETURN v_notice;
END $$;

REVOKE ALL ON FUNCTION app.publish_departure_communication_v3(TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID[],UUID[],UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_departure_communication_v3(TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID[],UUID[],UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version) VALUES('171_v3_communication_audience_scope') ON CONFLICT(version) DO NOTHING;
