CREATE OR REPLACE FUNCTION app.is_departure_operator_v3(p_actor_user_id UUID,p_departure UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
 SELECT EXISTS(
   SELECT 1 FROM travel.departures d
   WHERE d.id=p_departure AND (
     EXISTS(SELECT 1 FROM iam.agency_memberships m
       WHERE m.agency_id=d.agency_id AND m.user_id=p_actor_user_id
         AND m.status='active' AND m.role='owner')
     OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments s
       WHERE s.agency_id=d.agency_id AND s.departure_id=d.id AND s.user_id=p_actor_user_id
         AND s.role='tour_leader' AND s.status='active'
         AND clock_timestamp() BETWEEN s.valid_from AND s.valid_until)
   )
 );
$$;

CREATE OR REPLACE FUNCTION app.list_operational_alerts_v3(p_actor_user_id UUID,p_departure UUID)
RETURNS TABLE(id UUID,traveler_id UUID,traveler_name TEXT,party_id UUID,alert_summary TEXT,assistance_instructions TEXT,expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,privacy,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_count INTEGER;
BEGIN
 IF NOT app.is_departure_operator_v3(p_actor_user_id,p_departure) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='operational alerts not authorized';
 END IF;
 SELECT d.agency_id INTO v_agency FROM travel.departures d WHERE d.id=p_departure;
 PERFORM app.purge_expired_operational_alerts_v3();
 SELECT count(*)::integer INTO v_count FROM privacy.traveler_operational_alerts a
   WHERE a.agency_id=v_agency AND a.departure_id=p_departure AND a.status='active' AND a.deleted_at IS NULL;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,p_actor_user_id,'operational_alert_collection',p_departure::text,'sensitive_data_read',
   jsonb_build_object('activeAlertCount',v_count));
 RETURN QUERY
 SELECT a.id,a.traveler_id,p.display_name,a.party_id,a.alert_summary,a.assistance_instructions,a.expires_at
 FROM privacy.traveler_operational_alerts a
 JOIN travel.traveler_profiles p ON p.id=a.traveler_id AND p.agency_id=a.agency_id
 WHERE a.agency_id=v_agency AND a.departure_id=p_departure AND a.status='active' AND a.deleted_at IS NULL
 ORDER BY p.display_name;
END $$;

REVOKE ALL ON FUNCTION app.is_departure_operator_v3(UUID,UUID),app.list_operational_alerts_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_departure_operator_v3(UUID,UUID),app.list_operational_alerts_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('144_v3_operational_alert_read_audit') ON CONFLICT(version) DO NOTHING;
