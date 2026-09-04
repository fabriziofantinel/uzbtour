-- Shared, native authorization primitive for every programme write.
CREATE OR REPLACE FUNCTION app.can_edit_departure_day_v3(p_actor_user_id UUID,p_departure_id UUID,p_day_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel AS $$
 SELECT EXISTS(
  SELECT 1 FROM travel.departure_days day
  JOIN travel.departures departure ON departure.id=day.departure_id AND departure.agency_id=day.agency_id
  WHERE day.id=p_day_id AND day.departure_id=p_departure_id AND (
   EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=departure.agency_id AND membership.user_id=p_actor_user_id AND membership.status='active' AND membership.role IN('owner','admin','editor')) OR
   EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment JOIN travel.departure_staff_day_assignments coverage ON coverage.staff_assignment_id=assignment.id AND coverage.departure_day_id=day.id WHERE assignment.agency_id=departure.agency_id AND assignment.departure_id=departure.id AND assignment.user_id=p_actor_user_id AND assignment.status='active' AND assignment.role IN('accompagnatore','guida') AND clock_timestamp()>=assignment.valid_from AND clock_timestamp()<assignment.valid_until)
  )
 );
$$;
REVOKE ALL ON FUNCTION app.can_edit_departure_day_v3(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_edit_departure_day_v3(UUID,UUID,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('179_v3_staff_day_programme_authorization') ON CONFLICT(version) DO NOTHING;
