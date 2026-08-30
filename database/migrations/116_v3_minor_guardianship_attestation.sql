CREATE OR REPLACE FUNCTION app.set_minor_image_consent_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,
  p_subject_traveler_id UUID,p_decision TEXT,p_notes TEXT DEFAULT ''
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,privacy,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_decider UUID;v_previous UUID;v_id UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF p_decision NOT IN('granted','denied','withdrawn') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid consent decision';
  END IF;
  SELECT leader.traveler_id INTO v_decider FROM travel.party_memberships leader
  WHERE leader.agency_id=p_agency_id AND leader.departure_id=p_departure_id AND leader.party_id=p_party_id
    AND leader.role='organizer' AND leader.member_type='adult' AND leader.status<>'removed' LIMIT 1;
  IF v_decider IS NULL OR NOT EXISTS(SELECT 1 FROM travel.party_memberships subject
    WHERE subject.agency_id=p_agency_id AND subject.departure_id=p_departure_id AND subject.party_id=p_party_id
      AND subject.traveler_id=p_subject_traveler_id AND subject.member_type='dependent_minor' AND subject.status<>'removed')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='minor or adult group leader not available';END IF;

  INSERT INTO travel.traveler_guardianships(agency_id,departure_id,party_id,minor_traveler_id,
    guardian_traveler_id,relationship,status,effective_from,effective_until)
  VALUES(p_agency_id,p_departure_id,p_party_id,p_subject_traveler_id,v_decider,
    'agency_attested_group_leader','active',current_date,NULL)
  ON CONFLICT(party_id,minor_traveler_id,guardian_traveler_id) DO UPDATE
    SET status='active',relationship=EXCLUDED.relationship,effective_until=NULL;

  SELECT id INTO v_previous FROM privacy.consent_records WHERE agency_id=p_agency_id AND departure_id=p_departure_id
    AND party_id=p_party_id AND subject_traveler_id=p_subject_traveler_id AND consent_type='minor_image_upload'
    AND consent_scope='party' ORDER BY effective_at DESC,id DESC LIMIT 1 FOR UPDATE;
  INSERT INTO privacy.consent_records(agency_id,departure_id,party_id,subject_traveler_id,decided_by_traveler_id,
    consent_type,consent_scope,decision,policy_version,supersedes_consent_id,captured_by_user_id,capture_method,notes)
  VALUES(p_agency_id,p_departure_id,p_party_id,p_subject_traveler_id,v_decider,'minor_image_upload','party',p_decision,
    'smf-photo-privacy-v1',CASE WHEN p_decision='withdrawn' THEN v_previous ELSE NULL END,v_actor,
    'agency_attestation',left(coalesce(p_notes,''),1000)) RETURNING id INTO v_id;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'traveler_profile',p_subject_traveler_id::text,'minor_image_consent_updated',
    jsonb_build_object('departureId',p_departure_id,'partyId',p_party_id,'decision',p_decision,'consentId',v_id,
      'guardianTravelerId',v_decider));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.set_minor_image_consent_v3(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_minor_image_consent_v3(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('116_v3_minor_guardianship_attestation') ON CONFLICT(version) DO NOTHING;
