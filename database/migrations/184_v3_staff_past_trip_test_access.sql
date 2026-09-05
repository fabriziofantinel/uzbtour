-- Explicit, expiring exception for manually authorized tests on a past trip.
ALTER TABLE travel.departure_staff_assignments
  ADD COLUMN IF NOT EXISTS test_access_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION app.list_my_departure_staff_v3(p_actor_user_id UUID)
RETURNS TABLE(departure_id UUID,title TEXT,agency_name TEXT,starts_on DATE,ends_on DATE,staff_role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
 SELECT departure.id,departure.title::text,agency.name::text,departure.starts_on,departure.ends_on,
   CASE WHEN assignment.role='tour_leader' THEN 'accompagnatore' ELSE assignment.role END::text
 FROM travel.departure_staff_assignments assignment
 JOIN travel.departures departure ON departure.id=assignment.departure_id AND departure.agency_id=assignment.agency_id
 JOIN iam.agencies agency ON agency.id=departure.agency_id
 WHERE assignment.user_id=p_actor_user_id AND assignment.status='active'
   AND assignment.role IN ('tour_leader','agent','accompagnatore','guida')
   AND clock_timestamp()>=assignment.valid_from AND clock_timestamp()<assignment.valid_until
   AND (departure.ends_on>=current_date OR clock_timestamp()<assignment.test_access_until)
 ORDER BY departure.starts_on,departure.title;
$$;
REVOKE ALL ON FUNCTION app.list_my_departure_staff_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_my_departure_staff_v3(UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('184_v3_staff_past_trip_test_access') ON CONFLICT(version) DO NOTHING;
