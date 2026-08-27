-- Cutover della selezione viaggio e dell'autorizzazione famiglia verso il modello v3.
-- Il chiamante fornisce solo l'identificativo applicativo autenticato. La mappa
-- tecnica legacy rimane privata e viene risolta esclusivamente in queste funzioni.

CREATE OR REPLACE FUNCTION app.list_legacy_user_journeys(p_legacy_user_id TEXT)
RETURNS TABLE (
  departure_id TEXT,
  agency_id TEXT,
  template_version_id TEXT,
  title TEXT,
  code TEXT,
  starts_on TEXT,
  ends_on TEXT,
  timezone TEXT,
  status TEXT,
  party_id TEXT,
  party_name TEXT,
  destination_country TEXT,
  agency_name TEXT,
  agency_branding JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,travel,ops
SET row_security=off
AS $$
  WITH resolved_user AS (
    SELECT map.target_id AS user_id
    FROM ops.legacy_id_map map
    WHERE map.source_system='public-v2'
      AND map.entity_type='user'
      AND map.legacy_id=p_legacy_user_id
    LIMIT 1
  )
  SELECT departure.id::text,departure.agency_id::text,
    departure.template_version_id::text,departure.title,departure.code,
    departure.starts_on::text,departure.ends_on::text,departure.timezone,
    departure.status,party.id::text,party.name,country.name,agency.name,
    agency.branding
  FROM resolved_user resolved
  JOIN travel.traveler_profiles profile ON profile.user_id=resolved.user_id
  JOIN travel.party_memberships membership
    ON membership.agency_id=profile.agency_id
   AND membership.traveler_id=profile.id
   AND membership.status='active'
  JOIN travel.travel_parties party
    ON party.agency_id=membership.agency_id
   AND party.departure_id=membership.departure_id
   AND party.id=membership.party_id
  JOIN travel.departures departure
    ON departure.agency_id=party.agency_id
   AND departure.id=party.departure_id
  JOIN travel.trip_templates template
    ON template.agency_id=departure.agency_id
   AND template.id=departure.template_id
  JOIN iam.agencies agency ON agency.id=departure.agency_id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  WHERE departure.status NOT IN ('cancelled','archived')
  ORDER BY
    CASE WHEN CURRENT_DATE BETWEEN departure.starts_on AND departure.ends_on THEN 0
         WHEN departure.starts_on>=CURRENT_DATE THEN 1 ELSE 2 END,
    CASE WHEN departure.starts_on>=CURRENT_DATE THEN departure.starts_on END,
    departure.starts_on DESC
$$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_traveler_scope(
  p_legacy_user_id TEXT,
  p_departure_id UUID,
  p_party_id UUID,
  p_template_day_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops
SET row_security=off
AS $$
  SELECT departure.agency_id
  FROM ops.legacy_id_map map
  JOIN travel.traveler_profiles profile ON profile.user_id=map.target_id
  JOIN travel.party_memberships membership
    ON membership.agency_id=profile.agency_id
   AND membership.traveler_id=profile.id
   AND membership.status='active'
  JOIN travel.travel_parties party
    ON party.agency_id=membership.agency_id
   AND party.departure_id=membership.departure_id
   AND party.id=membership.party_id
  JOIN travel.departures departure
    ON departure.agency_id=party.agency_id
   AND departure.id=party.departure_id
  WHERE map.source_system='public-v2'
    AND map.entity_type='user'
    AND map.legacy_id=p_legacy_user_id
    AND departure.id=p_departure_id
    AND party.id=p_party_id
    AND (p_template_day_id IS NULL OR EXISTS (
      SELECT 1
      FROM travel.template_days day
      WHERE day.agency_id=departure.agency_id
        AND day.template_version_id=departure.template_version_id
        AND day.id=p_template_day_id
    ))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.list_legacy_user_journeys(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_legacy_traveler_scope(TEXT,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_legacy_user_journeys(TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_traveler_scope(TEXT,UUID,UUID,UUID) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('032_v3_traveler_scope_read_cutover') ON CONFLICT(version) DO NOTHING;
