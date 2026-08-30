CREATE OR REPLACE FUNCTION app.delete_empty_journey_party_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_updated UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF EXISTS(SELECT 1 FROM travel.party_memberships membership
    WHERE membership.agency_id=p_agency_id AND membership.departure_id=p_departure_id
      AND membership.party_id=p_party_id AND membership.status<>'removed') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='remove all travelers before deleting the group';
  END IF;
  UPDATE travel.travel_parties party SET status='archived',updated_at=clock_timestamp()
  WHERE party.id=p_party_id AND party.agency_id=p_agency_id AND party.departure_id=p_departure_id
    AND party.status<>'archived' RETURNING party.id INTO v_updated;
  IF v_updated IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey group not found';
  END IF;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'travel_party',p_party_id::text,'archived',
    jsonb_build_object('departureId',p_departure_id,'reason','privacy_safe_group_deletion'));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.delete_empty_journey_party_v3(TEXT,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_empty_journey_party_v3(TEXT,UUID,UUID,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('117_v3_group_privacy_safe_archive') ON CONFLICT(version) DO NOTHING;
