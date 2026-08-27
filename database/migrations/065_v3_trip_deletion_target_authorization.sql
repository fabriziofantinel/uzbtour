-- Resolve a trip deletion target inside the database security boundary.
-- The actor is authorized against the owning agency before any data is returned.

CREATE OR REPLACE FUNCTION app.resolve_trip_deletion_target_v3(
  p_actor_legacy_user_id TEXT,p_template_id UUID
)
RETURNS TABLE(id UUID,agency_id UUID,title TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,travel SET row_security=off AS $$
DECLARE v_agency_id UUID;
BEGIN
  SELECT template.agency_id INTO v_agency_id
  FROM travel.trip_templates AS template
  WHERE template.id=p_template_id;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='trip template not found';
  END IF;
  PERFORM app.require_agency_editor(p_actor_legacy_user_id,v_agency_id);
  RETURN QUERY
  SELECT template.id,template.agency_id,template.title::text
  FROM travel.trip_templates AS template
  WHERE template.id=p_template_id AND template.agency_id=v_agency_id;
END $$;

REVOKE ALL ON FUNCTION app.resolve_trip_deletion_target_v3(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_trip_deletion_target_v3(TEXT,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('065_v3_trip_deletion_target_authorization') ON CONFLICT(version) DO NOTHING;
