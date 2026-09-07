-- Future assignments are visible as soon as they are configured. Explicit test access reopens past assignments.

CREATE OR REPLACE FUNCTION app.is_departure_operator_v3(p_actor_user_id UUID,p_departure UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
 SELECT EXISTS(
   SELECT 1 FROM travel.departures departure
   WHERE departure.id=p_departure AND (
     EXISTS(SELECT 1 FROM iam.agency_memberships membership
       WHERE membership.agency_id=departure.agency_id AND membership.user_id=p_actor_user_id
         AND membership.status='active' AND membership.role IN ('owner','admin','editor'))
     OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment
       WHERE assignment.agency_id=departure.agency_id AND assignment.departure_id=p_departure
         AND assignment.user_id=p_actor_user_id AND assignment.role IN ('tour_leader','agent','accompagnatore','guida')
         AND assignment.status='active'
         AND (clock_timestamp()<assignment.valid_until OR clock_timestamp()<assignment.test_access_until))
   )
 );
$$;

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
   AND ((departure.ends_on>=current_date AND clock_timestamp()<assignment.valid_until)
     OR clock_timestamp()<assignment.test_access_until)
 ORDER BY departure.starts_on,departure.title;
$$;

CREATE OR REPLACE FUNCTION app.can_edit_departure_day_v3(p_actor_user_id UUID,p_departure_id UUID,p_day_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel AS $$
 SELECT EXISTS(
  SELECT 1 FROM travel.departure_days day
  JOIN travel.departures departure ON departure.id=day.departure_id AND departure.agency_id=day.agency_id
  WHERE day.id=p_day_id AND day.departure_id=p_departure_id AND (
   EXISTS(SELECT 1 FROM iam.agency_memberships membership
     WHERE membership.agency_id=departure.agency_id AND membership.user_id=p_actor_user_id
       AND membership.status='active' AND membership.role IN('owner','admin','editor'))
   OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment
     JOIN travel.departure_staff_day_assignments coverage
       ON coverage.staff_assignment_id=assignment.id AND coverage.departure_day_id=day.id
     WHERE assignment.agency_id=departure.agency_id AND assignment.departure_id=departure.id
       AND assignment.user_id=p_actor_user_id AND assignment.status='active'
       AND assignment.role IN('accompagnatore','guida')
       AND (clock_timestamp()<assignment.valid_until OR clock_timestamp()<assignment.test_access_until))
  )
 );
$$;

CREATE OR REPLACE FUNCTION app.read_agency_branding_v3(p_actor_user_id UUID)
RETURNS TABLE(agency_id UUID,branding JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
 SELECT agency.id,agency.branding FROM iam.agencies agency
 WHERE agency.status<>'deleted' AND EXISTS(
   SELECT 1 FROM iam.users actor WHERE actor.id=p_actor_user_id AND actor.status='active')
 AND (
   EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=agency.id
     AND membership.user_id=p_actor_user_id AND membership.status='active'
     AND membership.role IN('owner','admin','editor'))
   OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment
     WHERE assignment.agency_id=agency.id AND assignment.user_id=p_actor_user_id
       AND assignment.status='active'
       AND (clock_timestamp()<assignment.valid_until OR clock_timestamp()<assignment.test_access_until))
 );
$$;

REVOKE ALL ON FUNCTION app.is_departure_operator_v3(UUID,UUID),app.list_my_departure_staff_v3(UUID),
  app.can_edit_departure_day_v3(UUID,UUID,UUID),app.read_agency_branding_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_departure_operator_v3(UUID,UUID),app.list_my_departure_staff_v3(UUID),
  app.can_edit_departure_day_v3(UUID,UUID,UUID),app.read_agency_branding_v3(UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('195_v3_staff_temporal_access_fix') ON CONFLICT(version) DO NOTHING;
