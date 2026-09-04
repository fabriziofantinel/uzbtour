-- Completa il passaggio delle operazioni di partenza alle identità UUID native.

CREATE OR REPLACE FUNCTION app.list_departure_operations_v3(
  p_actor_user_id UUID,p_departure UUID
) RETURNS TABLE(kind TEXT,id UUID,name TEXT,detail TEXT,status TEXT,day_id UUID,party_id UUID,traveler_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey SET row_security=off AS $$
DECLARE v_agency UUID;v_owner BOOLEAN;
BEGIN
  SELECT d.agency_id,
    EXISTS(SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id=d.agency_id AND m.user_id=p_actor_user_id
      AND m.status='active' AND m.role='owner')
  INTO v_agency,v_owner
  FROM travel.departures d WHERE d.id=p_departure;
  IF v_agency IS NULL OR NOT app.is_departure_operator_v3(p_actor_user_id,p_departure) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='departure operations not authorized';
  END IF;
  RETURN QUERY
    SELECT 'staff'::text,s.id,u.display_name::text,'Tour Leader'::text,s.status::text,NULL::uuid,NULL::uuid,NULL::uuid
    FROM travel.departure_staff_assignments s JOIN iam.users u ON u.id=s.user_id
    WHERE s.agency_id=v_agency AND s.departure_id=p_departure AND s.status='active'
    UNION ALL
    SELECT 'eligible_staff'::text,u.id,u.display_name::text,COALESCE(u.email,'')::text,'active'::text,NULL::uuid,NULL::uuid,NULL::uuid
    FROM iam.agency_memberships m JOIN iam.users u ON u.id=m.user_id
    WHERE v_owner AND m.agency_id=v_agency AND m.status='active' AND m.role IN('admin','editor')
    UNION ALL
    SELECT 'day'::text,d.id,to_char(d.service_date,'DD/MM/YYYY'),' '::text,'active'::text,d.id,NULL::uuid,NULL::uuid
    FROM travel.departure_days d WHERE d.agency_id=v_agency AND d.departure_id=p_departure
    UNION ALL
    SELECT 'traveler'::text,m.traveler_id,p.display_name::text,party.name::text,m.status::text,NULL::uuid,m.party_id,m.traveler_id
    FROM travel.party_memberships m
    JOIN travel.traveler_profiles p ON p.id=m.traveler_id AND p.agency_id=m.agency_id
    JOIN travel.travel_parties party ON party.id=m.party_id AND party.agency_id=m.agency_id
    WHERE m.agency_id=v_agency AND m.departure_id=p_departure AND m.status='active'
    UNION ALL
    SELECT 'attendance'::text,a.id,p.display_name::text,a.operational_note::text,a.status::text,a.departure_day_id,a.party_id,a.traveler_id
    FROM journey.departure_attendance a JOIN travel.traveler_profiles p ON p.id=a.traveler_id AND p.agency_id=a.agency_id
    WHERE a.agency_id=v_agency AND a.departure_id=p_departure
    ORDER BY 1,3;
END $$;

CREATE OR REPLACE FUNCTION app.record_departure_attendance_v3(
  p_actor_user_id UUID,p_day UUID,p_traveler UUID,p_status TEXT,p_note TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey SET row_security=off AS $$
DECLARE v_agency UUID;v_departure UUID;v_party UUID;v_id UUID;
BEGIN
  SELECT agency_id,departure_id INTO v_agency,v_departure FROM travel.departure_days WHERE id=p_day;
  IF v_agency IS NULL OR NOT app.is_departure_operator_v3(p_actor_user_id,v_departure)
    OR p_status NOT IN('present','absent','excused') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='attendance not authorized';
  END IF;
  SELECT party_id INTO v_party FROM travel.party_memberships
    WHERE agency_id=v_agency AND departure_id=v_departure AND traveler_id=p_traveler AND status='active';
  IF v_party IS NULL OR length(COALESCE(p_note,''))>500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid attendance';
  END IF;
  INSERT INTO journey.departure_attendance(agency_id,departure_id,departure_day_id,party_id,traveler_id,status,operational_note,recorded_by)
  VALUES(v_agency,v_departure,p_day,v_party,p_traveler,p_status,btrim(COALESCE(p_note,'')),p_actor_user_id)
  ON CONFLICT(departure_day_id,traveler_id) DO UPDATE SET
    status=EXCLUDED.status,operational_note=EXCLUDED.operational_note,recorded_by=EXCLUDED.recorded_by,recorded_at=clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.list_departure_operations_v3(UUID,UUID),app.record_departure_attendance_v3(UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_departure_operations_v3(UUID,UUID),app.record_departure_attendance_v3(UUID,UUID,UUID,TEXT,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('169_v3_native_operational_control') ON CONFLICT(version) DO NOTHING;
