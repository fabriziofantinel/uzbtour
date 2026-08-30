CREATE OR REPLACE FUNCTION app.resolve_legacy_user_id(
  p_legacy_user_id TEXT,
  p_agency_id UUID
) RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,ops,travel SET row_security=off AS $$
  SELECT map.target_id
  FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2'
    AND map.entity_type='user'
    AND map.legacy_id=p_legacy_user_id
    AND p_agency_id=app.current_agency_id()
    AND EXISTS(
      SELECT 1 FROM travel.traveler_profiles profile
      WHERE profile.agency_id=p_agency_id AND profile.user_id=map.target_id
    )
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION app.resolve_legacy_user_id(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_user_id(TEXT,UUID) TO smf_app;
REVOKE SELECT ON TABLE ops.legacy_id_map FROM smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('106_v3_runtime_identity_resolver_final') ON CONFLICT(version) DO NOTHING;
