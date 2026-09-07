CREATE OR REPLACE FUNCTION app.read_staff_journey_management_v3(
  p_actor_user_id UUID,
  p_departure_id UUID
)
RETURNS TABLE(
  departure_id UUID,agency_id UUID,title TEXT,code TEXT,starts_on DATE,ends_on DATE,
  departure_status TEXT,agency_name TEXT,destination_country TEXT,
  party_id UUID,party_name TEXT,party_code TEXT,party_status TEXT,party_experience_profile TEXT,
  traveler_id UUID,traveler_name TEXT,traveler_username TEXT,traveler_email TEXT,traveler_phone TEXT,
  membership_role TEXT,membership_status TEXT,user_status TEXT,
  member_type TEXT,minor_image_consent TEXT,traveler_participates_in_trip_games BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ref,privacy SET row_security=off AS $$
  WITH allowed AS (
    SELECT card.agency_id,card.agency_name
    FROM app.read_staff_trip_cards_v3(p_actor_user_id) card
    WHERE card.departure_id=p_departure_id
    LIMIT 1
  )
  SELECT departure.id,departure.agency_id,departure.title,departure.code,
    departure.starts_on,departure.ends_on,departure.status,allowed.agency_name,
    COALESCE(country.name,''),party.id,party.name,party.code,party.status,
    COALESCE(experience.profile,departure.experience_profile),
    traveler.id,traveler.display_name,COALESCE(account.username,''),COALESCE(traveler.email,''),
    COALESCE(traveler.phone,''),membership.role,membership.status,COALESCE(account.status,membership.status),
    membership.member_type,COALESCE(consent.decision,'missing'),COALESCE(membership.participates_in_trip_games,false)
  FROM allowed
  JOIN travel.departures departure ON departure.id=p_departure_id AND departure.agency_id=allowed.agency_id
  JOIN travel.trip_templates template ON template.id=departure.template_id AND template.agency_id=departure.agency_id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  LEFT JOIN travel.travel_parties party ON party.departure_id=departure.id AND party.agency_id=departure.agency_id
  LEFT JOIN travel.departure_party_experience_profiles experience ON experience.agency_id=departure.agency_id
    AND experience.departure_id=departure.id AND experience.party_id=party.id
  LEFT JOIN travel.party_memberships membership ON membership.party_id=party.id
    AND membership.agency_id=departure.agency_id AND membership.status<>'removed'
  LEFT JOIN travel.traveler_profiles traveler ON traveler.id=membership.traveler_id
    AND traveler.agency_id=departure.agency_id
  LEFT JOIN iam.users account ON account.id=traveler.user_id
  LEFT JOIN LATERAL (
    SELECT record.decision FROM privacy.consent_records record
    WHERE record.agency_id=departure.agency_id AND record.departure_id=departure.id
      AND record.party_id=party.id AND record.subject_traveler_id=traveler.id
      AND record.consent_type='minor_image_upload' AND record.consent_scope='party'
      AND (record.expires_at IS NULL OR record.expires_at>clock_timestamp())
    ORDER BY record.effective_at DESC,record.id DESC LIMIT 1
  ) consent ON true
  ORDER BY party.name,membership.role,traveler.display_name
$$;

REVOKE ALL ON FUNCTION app.read_staff_journey_management_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_staff_journey_management_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('187_v3_staff_journey_management_read') ON CONFLICT(version) DO NOTHING;
