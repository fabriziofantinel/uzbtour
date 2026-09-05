CREATE OR REPLACE FUNCTION app.read_staff_trip_cards_v3(p_actor UUID)
RETURNS TABLE(departure_id UUID,title TEXT,agency_name TEXT,starts_on DATE,ends_on DATE,staff_role TEXT,agency_id UUID,branding JSONB,party_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel SET row_security=off AS $$
 SELECT listed.*,d.agency_id,a.branding,
   (SELECT count(*) FROM travel.travel_parties p WHERE p.departure_id=d.id AND p.agency_id=d.agency_id AND p.status<>'archived')
 FROM app.list_my_departure_staff_v3(p_actor) listed
 JOIN travel.departures d ON d.id=listed.departure_id
 JOIN iam.agencies a ON a.id=d.agency_id;
$$;
REVOKE ALL ON FUNCTION app.read_staff_trip_cards_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_staff_trip_cards_v3(UUID) TO smf_app;

CREATE OR REPLACE FUNCTION app.read_agency_branding_v3(p_actor_user_id UUID)
RETURNS TABLE(agency_id UUID,branding JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
 SELECT agency.id,agency.branding FROM iam.agencies agency
 WHERE agency.status<>'deleted' AND EXISTS(SELECT 1 FROM iam.users actor WHERE actor.id=p_actor_user_id AND actor.status='active')
 AND (EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=agency.id
   AND membership.user_id=p_actor_user_id AND membership.status='active' AND membership.role IN('owner','admin','editor'))
 OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment WHERE assignment.agency_id=agency.id
   AND assignment.user_id=p_actor_user_id AND assignment.status='active'
   AND clock_timestamp()>=assignment.valid_from AND clock_timestamp()<assignment.valid_until));
$$;
REVOKE ALL ON FUNCTION app.read_agency_branding_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_branding_v3(UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('185_v3_staff_trip_presentation') ON CONFLICT(version) DO NOTHING;
