-- Registro formale del consenso immagini dei minori, governato dall'agenzia.

DROP FUNCTION app.read_journey_management(TEXT,UUID);
CREATE FUNCTION app.read_journey_management(p_actor_legacy_user_id TEXT,p_departure_id UUID)
RETURNS TABLE(
  departure_id UUID,agency_id UUID,title TEXT,code TEXT,starts_on DATE,ends_on DATE,
  departure_status TEXT,agency_name TEXT,destination_country TEXT,
  party_id UUID,party_name TEXT,party_code TEXT,party_status TEXT,
  party_participates_in_trip_games BOOLEAN,
  traveler_id UUID,traveler_name TEXT,traveler_username TEXT,traveler_email TEXT,traveler_phone TEXT,
  membership_role TEXT,membership_status TEXT,user_status TEXT,
  member_type TEXT,minor_image_consent TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ref,ops,privacy SET row_security=off AS $$
  SELECT departure.id,departure.agency_id,departure.title,departure.code,
    departure.starts_on,departure.ends_on,departure.status,agency.name,
    COALESCE(country.name,''),party.id,party.name,party.code,party.status,
    COALESCE(party.participates_in_trip_games,false),
    traveler.id,traveler.display_name,COALESCE(users.username,''),COALESCE(traveler.email,''),
    COALESCE(traveler.phone,''),membership.role,membership.status,users.status,
    membership.member_type,COALESCE(consent.decision,'missing')
  FROM travel.departures departure
  JOIN iam.agencies agency ON agency.id=departure.agency_id
  JOIN travel.trip_templates template ON template.id=departure.template_id AND template.agency_id=departure.agency_id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  JOIN iam.agency_memberships actor_membership ON actor_membership.agency_id=departure.agency_id
    AND actor_membership.status='active' AND actor_membership.role IN('owner','admin','editor')
  JOIN ops.legacy_id_map actor_map ON actor_map.target_id=actor_membership.user_id
    AND actor_map.source_system='public-v2' AND actor_map.entity_type='user' AND actor_map.legacy_id=p_actor_legacy_user_id
  JOIN iam.users actor ON actor.id=actor_membership.user_id AND actor.status='active'
  LEFT JOIN travel.travel_parties party ON party.departure_id=departure.id
  LEFT JOIN travel.party_memberships membership ON membership.party_id=party.id AND membership.status<>'removed'
  LEFT JOIN travel.traveler_profiles traveler ON traveler.id=membership.traveler_id AND traveler.agency_id=departure.agency_id
  LEFT JOIN iam.users users ON users.id=traveler.user_id
  LEFT JOIN LATERAL (
    SELECT record.decision FROM privacy.consent_records record
    WHERE record.agency_id=departure.agency_id AND record.departure_id=departure.id
      AND record.party_id=party.id AND record.subject_traveler_id=traveler.id
      AND record.consent_type='minor_image_upload' AND record.consent_scope='party'
      AND (record.expires_at IS NULL OR record.expires_at>clock_timestamp())
    ORDER BY record.effective_at DESC,record.id DESC LIMIT 1
  ) consent ON true
  WHERE departure.id=p_departure_id
  ORDER BY party.name,membership.role,traveler.display_name
$$;

CREATE OR REPLACE FUNCTION app.set_minor_image_consent_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,
  p_subject_traveler_id UUID,p_decision TEXT,p_notes TEXT DEFAULT ''
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,privacy,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_decider UUID;v_previous UUID;v_id UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF p_decision NOT IN('granted','denied','withdrawn') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid consent decision';END IF;
  SELECT leader.traveler_id INTO v_decider FROM travel.party_memberships leader
  WHERE leader.agency_id=p_agency_id AND leader.departure_id=p_departure_id AND leader.party_id=p_party_id
    AND leader.role='organizer' AND leader.member_type='adult' AND leader.status<>'removed' LIMIT 1;
  IF v_decider IS NULL OR NOT EXISTS(SELECT 1 FROM travel.party_memberships subject
    WHERE subject.agency_id=p_agency_id AND subject.departure_id=p_departure_id AND subject.party_id=p_party_id
      AND subject.traveler_id=p_subject_traveler_id AND subject.member_type='dependent_minor' AND subject.status<>'removed')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='minor or adult group leader not available';END IF;
  SELECT id INTO v_previous FROM privacy.consent_records WHERE agency_id=p_agency_id AND departure_id=p_departure_id
    AND party_id=p_party_id AND subject_traveler_id=p_subject_traveler_id AND consent_type='minor_image_upload'
    AND consent_scope='party' ORDER BY effective_at DESC,id DESC LIMIT 1 FOR UPDATE;
  INSERT INTO privacy.consent_records(agency_id,departure_id,party_id,subject_traveler_id,decided_by_traveler_id,
    consent_type,consent_scope,decision,policy_version,supersedes_consent_id,captured_by_user_id,capture_method,notes)
  VALUES(p_agency_id,p_departure_id,p_party_id,p_subject_traveler_id,v_decider,'minor_image_upload','party',p_decision,
    'smf-photo-privacy-v1',CASE WHEN p_decision='withdrawn' THEN v_previous ELSE NULL END,v_actor,'agency_attestation',left(coalesce(p_notes,''),1000)) RETURNING id INTO v_id;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'traveler_profile',p_subject_traveler_id::text,'minor_image_consent_updated',
    jsonb_build_object('departureId',p_departure_id,'partyId',p_party_id,'decision',p_decision,'consentId',v_id));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.read_journey_management(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.set_minor_image_consent_v3(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_journey_management(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.set_minor_image_consent_v3(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('096_v3_minor_photo_consent') ON CONFLICT(version) DO NOTHING;
