-- Controlli self-service nel profilo sfide del viaggiatore.
CREATE OR REPLACE FUNCTION app.update_own_trip_competition_v3(
  p_actor_legacy_user_id TEXT,p_departure_id UUID,p_party_id UUID,p_enabled BOOLEAN
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_actor UUID;v_traveler UUID;
BEGIN
  SELECT party.agency_id INTO v_agency FROM travel.travel_parties party
  WHERE party.id=p_party_id AND party.departure_id=p_departure_id AND party.status<>'archived';
  IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey group not found'; END IF;
  v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,v_agency);
  SELECT profile.id INTO v_traveler FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
    AND membership.traveler_id=profile.id AND membership.departure_id=p_departure_id
    AND membership.party_id=p_party_id AND membership.status='active'
  WHERE profile.agency_id=v_agency AND profile.user_id=v_actor FOR UPDATE OF membership;
  IF v_traveler IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler is not an active group member'; END IF;
  UPDATE travel.party_memberships SET participates_in_trip_games=p_enabled
  WHERE agency_id=v_agency AND departure_id=p_departure_id AND party_id=p_party_id AND traveler_id=v_traveler;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,v_actor,'traveler_profile',v_traveler::text,'trip_competition_settings_updated',
    jsonb_build_object('departureId',p_departure_id,'partyId',p_party_id,'participatesInTripGames',p_enabled));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.transfer_own_group_leadership_v3(
  p_actor_legacy_user_id TEXT,p_departure_id UUID,p_party_id UUID,p_new_leader_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_agency UUID;v_actor UUID;v_current UUID;v_target_type TEXT;
BEGIN
  SELECT party.agency_id INTO v_agency FROM travel.travel_parties party
  WHERE party.id=p_party_id AND party.departure_id=p_departure_id AND party.status<>'archived' FOR UPDATE;
  IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey group not found'; END IF;
  v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,v_agency);
  SELECT profile.id INTO v_current FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
    AND membership.traveler_id=profile.id AND membership.departure_id=p_departure_id
    AND membership.party_id=p_party_id AND membership.status='active' AND membership.role='organizer'
  WHERE profile.agency_id=v_agency AND profile.user_id=v_actor;
  IF v_current IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='only the current group leader can transfer leadership'; END IF;
  SELECT membership.member_type INTO v_target_type FROM travel.party_memberships membership
  WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure_id
    AND membership.party_id=p_party_id AND membership.traveler_id=p_new_leader_id
    AND membership.status='active' FOR UPDATE;
  IF v_target_type IS NULL OR v_target_type<>'adult' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='new leader must be an adult group member';
  END IF;
  IF p_new_leader_id=v_current THEN RETURN true; END IF;
  UPDATE travel.party_memberships SET role='member'
  WHERE party_id=p_party_id AND traveler_id=v_current AND status='active';
  UPDATE travel.party_memberships SET role='organizer'
  WHERE party_id=p_party_id AND traveler_id=p_new_leader_id AND status='active';
  UPDATE public.party_memberships legacy SET role=membership.role
  FROM travel.party_memberships membership
  WHERE legacy.party_id=membership.party_id AND legacy.traveler_id=membership.traveler_id
    AND membership.party_id=p_party_id;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,v_actor,'travel_party',p_party_id::text,'leader_transferred_by_traveler',
    jsonb_build_object('departureId',p_departure_id,'previousLeaderId',v_current,'newLeaderId',p_new_leader_id));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.update_own_trip_competition_v3(TEXT,UUID,UUID,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.transfer_own_group_leadership_v3(TEXT,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_own_trip_competition_v3(TEXT,UUID,UUID,BOOLEAN) TO smf_app;
GRANT EXECUTE ON FUNCTION app.transfer_own_group_leadership_v3(TEXT,UUID,UUID,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('087_v3_traveler_profile_controls') ON CONFLICT(version) DO NOTHING;
