-- Contesto rooming list esposto al runtime senza accesso diretto allo schema IAM.

CREATE OR REPLACE FUNCTION app.read_rooming_list_scope_v3(
  p_actor UUID,
  p_departure UUID
)
RETURNS TABLE(
  agency_id UUID,
  title TEXT,
  agency_name TEXT,
  primary_color TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel
SET row_security=off
AS $$
  SELECT
    departure.agency_id,
    departure.title,
    agency.name,
    COALESCE(agency.branding->>'primaryColor','#247A6B')
  FROM travel.departures departure
  JOIN iam.agencies agency ON agency.id=departure.agency_id
  WHERE departure.id=p_departure
    AND app.can_manage_rooming_list_v3(p_actor,p_departure)
$$;

REVOKE ALL ON FUNCTION app.read_rooming_list_scope_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_rooming_list_scope_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('201_v3_rooming_read_scope') ON CONFLICT(version) DO NOTHING;
