CREATE OR REPLACE FUNCTION app.read_superadmin_summary(p_actor_user_id UUID)
RETURNS TABLE(agencies INTEGER,trips INTEGER,travelers INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
  SELECT (SELECT count(*)::integer FROM iam.agencies),
    (SELECT count(*)::integer FROM travel.trip_templates),
    (SELECT count(*)::integer FROM travel.traveler_profiles)
  WHERE EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin')
$$;

CREATE OR REPLACE FUNCTION app.read_superadmin_agency_registry(p_actor_user_id UUID)
RETURNS TABLE(
  agency_id UUID,slug TEXT,agency_name TEXT,agency_status TEXT,legal_name TEXT,
  vat_number TEXT,tax_code TEXT,registered_address TEXT,registered_city TEXT,
  registered_postal_code TEXT,registered_province TEXT,registered_country TEXT,
  pec TEXT,sdi_code TEXT,agency_phone TEXT,agency_email TEXT,website TEXT,
  reference_name TEXT,reference_email TEXT,reference_phone TEXT,branding JSONB,
  trip_count INTEGER,traveler_count INTEGER,ongoing_trip_count INTEGER,upcoming_trip_count INTEGER,
  agent_id TEXT,agent_name TEXT,agent_username TEXT,agent_email TEXT,agent_phone TEXT,
  agent_role TEXT,agent_status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  WITH authorized AS(
    SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active' AND platform_role='superadmin'
  ),trip_counts AS(
    SELECT agency_id,count(*)::integer count FROM travel.trip_templates GROUP BY agency_id
  ),traveler_counts AS(
    SELECT agency_id,count(*)::integer count FROM travel.traveler_profiles GROUP BY agency_id
  ),departure_counts AS(
    SELECT agency_id,
      count(*) FILTER(WHERE starts_on<=current_date AND ends_on>=current_date
        AND status NOT IN('cancelled','archived'))::integer ongoing,
      count(*) FILTER(WHERE starts_on>current_date
        AND status NOT IN('cancelled','archived'))::integer upcoming
    FROM travel.departures GROUP BY agency_id
  )
  SELECT agency.id,agency.slug,agency.name,agency.status,COALESCE(agency.legal_name,''),
    COALESCE(agency.vat_number,''),COALESCE(agency.tax_code,''),COALESCE(agency.registered_address,''),
    COALESCE(agency.registered_city,''),COALESCE(agency.registered_postal_code,''),
    COALESCE(agency.registered_province,''),COALESCE(agency.registered_country_code,''),
    COALESCE(agency.pec,''),COALESCE(agency.sdi_code,''),COALESCE(agency.phone,''),
    COALESCE(agency.email,''),COALESCE(agency.website,''),agency.reference_name,
    COALESCE(agency.reference_email,''),COALESCE(agency.reference_phone,''),agency.branding,
    COALESCE(trips.count,0),COALESCE(travelers.count,0),COALESCE(departures.ongoing,0),
    COALESCE(departures.upcoming,0),agent_map.legacy_id,agent.display_name,
    COALESCE(agent.username,''),COALESCE(agent.email,''),COALESCE(agent.phone,''),membership.role,agent.status
  FROM authorized CROSS JOIN iam.agencies agency
  LEFT JOIN trip_counts trips ON trips.agency_id=agency.id
  LEFT JOIN traveler_counts travelers ON travelers.agency_id=agency.id
  LEFT JOIN departure_counts departures ON departures.agency_id=agency.id
  LEFT JOIN iam.agency_memberships membership ON membership.agency_id=agency.id AND membership.status<>'revoked'
  LEFT JOIN iam.users agent ON agent.id=membership.user_id
  LEFT JOIN ops.legacy_id_map agent_map ON agent_map.target_id=agent.id
    AND agent_map.source_system='public-v2' AND agent_map.entity_type='user'
  ORDER BY agency.name,agent.display_name
$$;

CREATE OR REPLACE FUNCTION app.is_username_available(p_actor_user_id UUID,p_username TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam SET row_security=off AS $$
  SELECT EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND status='active')
    AND NOT EXISTS(SELECT 1 FROM iam.users WHERE normalized_username=lower(btrim(p_username)))
$$;

REVOKE ALL ON FUNCTION app.read_superadmin_summary(TEXT),app.read_superadmin_agency_registry(TEXT),
  app.read_superadmin_impersonation_users(TEXT),app.is_username_available(TEXT,TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.read_superadmin_summary(UUID),app.read_superadmin_agency_registry(UUID),
  app.is_username_available(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_superadmin_summary(UUID),app.read_superadmin_agency_registry(UUID),
  app.is_username_available(UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('158_v3_native_superadmin_reads') ON CONFLICT(version) DO NOTHING;
