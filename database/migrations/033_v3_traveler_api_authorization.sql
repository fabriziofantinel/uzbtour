-- Contesto minimo per autorizzare le API operative del viaggiatore.
-- La funzione non espone dati anagrafici e risolve la compatibilità legacy
-- senza concedere al runtime accesso alla mappa tecnica delle identità.

CREATE OR REPLACE FUNCTION app.resolve_legacy_traveler_context(
  p_legacy_user_id TEXT,
  p_departure_id UUID,
  p_party_id UUID,
  p_template_day_id UUID DEFAULT NULL
)
RETURNS TABLE (
  agency_id UUID,
  template_version_id UUID,
  traveler_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops
SET row_security=off
AS $$
  SELECT departure.agency_id,departure.template_version_id,profile.id
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
SET search_path=pg_catalog,app
SET row_security=off
AS $$
  SELECT context.agency_id
  FROM app.resolve_legacy_traveler_context(
    p_legacy_user_id,p_departure_id,p_party_id,p_template_day_id
  ) context
$$;

REVOKE ALL ON FUNCTION app.resolve_legacy_traveler_context(TEXT,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_legacy_traveler_scope(TEXT,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_traveler_context(TEXT,UUID,UUID,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_traveler_scope(TEXT,UUID,UUID,UUID) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('033_v3_traveler_api_authorization') ON CONFLICT(version) DO NOTHING;
