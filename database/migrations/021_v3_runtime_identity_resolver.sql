-- Risoluzione stretta delle identità legacy per il dual-write v3.
-- ops.legacy_id_map resta chiusa da RLS: il runtime non riceve accesso diretto.

CREATE OR REPLACE FUNCTION app.resolve_legacy_user_id(
  p_legacy_user_id TEXT,
  p_agency_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, ops, public
AS $$
  SELECT map.target_id
  FROM ops.legacy_id_map map
  WHERE map.source_system = 'public-v2'
    AND map.entity_type = 'user'
    AND map.legacy_id = p_legacy_user_id
    AND p_agency_id = app.current_agency_id()
    AND EXISTS (
      SELECT 1
      FROM public.traveler_profiles profile
      WHERE profile.agency_id = p_agency_id
        AND profile.user_id = p_legacy_user_id
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_legacy_user_id(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_user_id(TEXT, UUID) TO smf_app;

-- Revoca il grant ridondante delle migrazioni 019/020. La tabella rimane
-- disponibile solo a owner/backfill; il runtime usa esclusivamente la funzione.
REVOKE SELECT ON TABLE ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations (version)
VALUES ('021_v3_runtime_identity_resolver')
ON CONFLICT (version) DO NOTHING;
