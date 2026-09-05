CREATE OR REPLACE FUNCTION app.read_staff_dashboard_v3(p_actor UUID)
RETURNS TABLE(payload JSONB) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ref SET row_security=off AS $$
 SELECT to_jsonb(card) || jsonb_build_object(
   'template_id',departure.template_id,
   'destination_country',COALESCE(country.name,''),
   'status',departure.status,
   'traveler_names',COALESCE((SELECT jsonb_agg(profile.display_name ORDER BY profile.display_name)
     FROM travel.party_memberships member JOIN travel.traveler_profiles profile
       ON profile.id=member.traveler_id AND profile.agency_id=member.agency_id
     WHERE member.departure_id=departure.id AND member.agency_id=departure.agency_id AND member.status='active'),'[]'::jsonb))
 FROM app.read_staff_trip_cards_v3(p_actor) card
 JOIN travel.departures departure ON departure.id=card.departure_id
 JOIN travel.trip_templates template ON template.id=departure.template_id AND template.agency_id=departure.agency_id
 LEFT JOIN ref.countries country ON country.id=template.primary_country_id;
$$;
REVOKE ALL ON FUNCTION app.read_staff_dashboard_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_staff_dashboard_v3(UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('186_v3_staff_dashboard_details') ON CONFLICT(version) DO NOTHING;
