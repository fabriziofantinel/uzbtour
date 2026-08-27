-- Letture globali superadmin da IAM/Travel V3, senza accesso runtime diretto
-- alle mappe di compatibilita'.

CREATE OR REPLACE FUNCTION app.read_superadmin_summary(p_actor_legacy_user_id TEXT)
RETURNS TABLE(agencies INTEGER,trips INTEGER,travelers INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT (SELECT count(*)::integer FROM iam.agencies),
    (SELECT count(*)::integer FROM travel.trip_templates),
    (SELECT count(*)::integer FROM travel.traveler_profiles)
  WHERE EXISTS(
    SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id
      AND actor.status='active' AND actor.platform_role='superadmin'
  )
$$;

CREATE OR REPLACE FUNCTION app.read_superadmin_agency_registry(p_actor_legacy_user_id TEXT)
RETURNS TABLE(
  agency_id UUID,slug TEXT,agency_name TEXT,agency_status TEXT,legal_name TEXT,
  vat_number TEXT,tax_code TEXT,registered_address TEXT,registered_city TEXT,
  registered_postal_code TEXT,registered_province TEXT,registered_country TEXT,
  pec TEXT,sdi_code TEXT,agency_phone TEXT,agency_email TEXT,website TEXT,
  reference_name TEXT,reference_email TEXT,reference_phone TEXT,branding JSONB,
  trip_count INTEGER,traveler_count INTEGER,agent_id TEXT,agent_name TEXT,
  agent_email TEXT,agent_phone TEXT,agent_role TEXT,agent_status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  WITH authorized AS(
    SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id
      AND actor.status='active' AND actor.platform_role='superadmin'
  ),trip_counts AS(
    SELECT agency_id,count(*)::integer count FROM travel.trip_templates GROUP BY agency_id
  ),traveler_counts AS(
    SELECT agency_id,count(*)::integer count FROM travel.traveler_profiles GROUP BY agency_id
  )
  SELECT agency.id,agency.slug,agency.name,agency.status,COALESCE(agency.legal_name,''),
    COALESCE(agency.vat_number,''),COALESCE(agency.tax_code,''),
    COALESCE(agency.registered_address,''),COALESCE(agency.registered_city,''),
    COALESCE(agency.registered_postal_code,''),COALESCE(agency.registered_province,''),
    COALESCE(agency.registered_country_code,''),COALESCE(agency.pec,''),
    COALESCE(agency.sdi_code,''),COALESCE(agency.phone,''),COALESCE(agency.email,''),
    COALESCE(agency.website,''),agency.reference_name,COALESCE(agency.reference_email,''),
    COALESCE(agency.reference_phone,''),agency.branding,COALESCE(trips.count,0),
    COALESCE(travelers.count,0),agent_map.legacy_id,agent.display_name,
    COALESCE(agent.email,''),COALESCE(agent.phone,''),membership.role,agent.status
  FROM authorized CROSS JOIN iam.agencies agency
  LEFT JOIN trip_counts trips ON trips.agency_id=agency.id
  LEFT JOIN traveler_counts travelers ON travelers.agency_id=agency.id
  LEFT JOIN iam.agency_memberships membership ON membership.agency_id=agency.id
    AND membership.status<>'revoked'
  LEFT JOIN iam.users agent ON agent.id=membership.user_id
  LEFT JOIN ops.legacy_id_map agent_map ON agent_map.target_id=agent.id
    AND agent_map.source_system='public-v2' AND agent_map.entity_type='user'
  ORDER BY agency.name,agent.display_name
$$;

CREATE OR REPLACE FUNCTION app.read_superadmin_impersonation_users(p_actor_legacy_user_id TEXT)
RETURNS TABLE(
  legacy_user_id TEXT,display_name TEXT,email TEXT,phone TEXT,user_status TEXT,
  platform_role TEXT,agency_names TEXT[],agency_roles TEXT[],is_traveler BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  WITH actor_identity AS(
    SELECT actor.id FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id
      AND actor.status='active' AND actor.platform_role='superadmin'
  )
  SELECT user_map.legacy_id,users.display_name,COALESCE(users.email,''),
    COALESCE(users.phone,''),users.status,users.platform_role,
    COALESCE(array_agg(DISTINCT agency.name) FILTER(WHERE agency.id IS NOT NULL),ARRAY[]::text[]),
    COALESCE(array_agg(DISTINCT membership.role) FILTER(WHERE membership.role IS NOT NULL),ARRAY[]::text[]),
    EXISTS(SELECT 1 FROM travel.traveler_profiles traveler WHERE traveler.user_id=users.id)
  FROM actor_identity actor
  CROSS JOIN iam.users users
  JOIN ops.legacy_id_map user_map ON user_map.target_id=users.id
    AND user_map.source_system='public-v2' AND user_map.entity_type='user'
  LEFT JOIN iam.agency_memberships membership ON membership.user_id=users.id
    AND membership.status<>'revoked'
  LEFT JOIN iam.agencies agency ON agency.id=membership.agency_id
  WHERE users.id<>actor.id AND users.status NOT IN('disabled','anonymized')
  GROUP BY user_map.legacy_id,users.id
  ORDER BY users.display_name,users.email
$$;

REVOKE ALL ON FUNCTION app.read_superadmin_summary(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_superadmin_agency_registry(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_superadmin_impersonation_users(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_superadmin_summary(TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.read_superadmin_agency_registry(TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.read_superadmin_impersonation_users(TEXT) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('042_v3_superadmin_read_cutover') ON CONFLICT(version) DO NOTHING;
