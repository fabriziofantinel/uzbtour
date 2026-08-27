-- Qualify the template scope check because RETURNS TABLE exposes an `id`
-- output variable that otherwise conflicts with travel.trip_templates.id.

CREATE OR REPLACE FUNCTION app.read_trip_deletion_assets_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_template_id UUID
)
RETURNS TABLE(id UUID,provider TEXT,bucket TEXT,object_key TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
BEGIN
  PERFORM app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF NOT EXISTS(
    SELECT 1
    FROM travel.trip_templates AS template
    WHERE template.id=p_template_id
      AND template.agency_id=p_agency_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='trip template not found';
  END IF;
  RETURN QUERY
  SELECT DISTINCT asset.id,asset.provider::text,asset.bucket,asset.object_key
  FROM ops.media_assets AS asset
  LEFT JOIN ops.travel_documents AS document ON document.media_asset_id=asset.id
    AND document.agency_id=asset.agency_id
  WHERE asset.agency_id=p_agency_id AND (
    document.template_id=p_template_id OR asset.departure_id IN(
      SELECT departure.id FROM travel.departures AS departure
      WHERE departure.agency_id=p_agency_id AND departure.template_id=p_template_id));
END $$;

REVOKE ALL ON FUNCTION app.read_trip_deletion_assets_v3(TEXT,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_trip_deletion_assets_v3(TEXT,UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('066_v3_trip_deletion_assets_scope_fix') ON CONFLICT(version) DO NOTHING;
