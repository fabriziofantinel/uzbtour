-- Mantiene telefoni e URL generati per emergenze e rappresentanze diplomatiche.
CREATE OR REPLACE FUNCTION app.apply_generated_useful_information_contacts_v3(
  p_job_id UUID,
  p_agency_id UUID,
  p_template_id UUID,
  p_useful JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel, ops
SET row_security = off
AS $$
DECLARE
  v_version UUID;
  v_row JSONB;
  v_updated INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_useful) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid useful information payload';
  END IF;

  SELECT version.id INTO v_version
  FROM ops.platform_jobs job
  JOIN LATERAL (
    SELECT id
    FROM travel.trip_template_versions
    WHERE agency_id = p_agency_id
      AND template_id = p_template_id
      AND status = 'published'
    ORDER BY version_number DESC
    LIMIT 1
  ) version ON true
  WHERE job.id = p_job_id
    AND job.agency_id = p_agency_id
    AND job.job_type = 'travel-reference.enrich'
    AND job.status = 'processing'
    AND job.payload->>'templateId' = p_template_id::text;

  IF v_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'useful information contact update is not authorized';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_useful) LOOP
    UPDATE travel.template_useful_information information
    SET phone = NULLIF(v_row->>'phone', ''),
        url = NULLIF(v_row->>'url', ''),
        updated_at = clock_timestamp()
    WHERE information.agency_id = p_agency_id
      AND information.template_version_id = v_version
      AND information.source = 'ai'
      AND information.sort_order = (v_row->>'sortOrder')::integer;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION app.apply_generated_useful_information_contacts_v3(UUID,UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.apply_generated_useful_information_contacts_v3(UUID,UUID,UUID,JSONB) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('074_v3_generated_useful_information_contacts')
ON CONFLICT(version) DO NOTHING;
