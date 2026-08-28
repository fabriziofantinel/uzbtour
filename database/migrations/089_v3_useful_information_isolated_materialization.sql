-- Aggiorna esclusivamente le informazioni utili generate senza toccare le altre
-- attività del viaggio. Il job deve essere un enrichment attivo dello stesso tenant.
CREATE OR REPLACE FUNCTION app.replace_trip_useful_information_v3(
  p_job_id UUID,p_agency_id UUID,p_template_id UUID,p_useful JSONB
)
RETURNS TABLE(template_version_id UUID,generated_sections INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_version UUID;v_row JSONB;v_count INTEGER:=0;
BEGIN
  IF jsonb_typeof(p_useful)<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid useful information payload';
  END IF;
  SELECT version.id INTO v_version
  FROM ops.platform_jobs job
  JOIN LATERAL(SELECT id FROM travel.trip_template_versions
    WHERE agency_id=p_agency_id AND template_id=p_template_id AND status='published'
    ORDER BY version_number DESC LIMIT 1) version ON true
  WHERE job.id=p_job_id AND job.agency_id=p_agency_id
    AND job.job_type='travel-reference.enrich' AND job.status='processing'
    AND job.payload->>'templateId'=p_template_id::text FOR UPDATE OF job;
  IF v_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='useful information materialization job is not authorized';
  END IF;
  PERFORM set_config('app.materialization_job_id',p_job_id::text,true);
  DELETE FROM travel.template_useful_information information
    WHERE information.agency_id=p_agency_id AND information.template_version_id=v_version
      AND information.source='ai';
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_useful) LOOP
    INSERT INTO travel.template_useful_information(agency_id,template_version_id,category,
      title,body,phone,url,sort_order,source,metadata)
    VALUES(p_agency_id,v_version,v_row->>'category',v_row->>'title',COALESCE(v_row->>'body',''),
      NULLIF(v_row->>'phone',''),NULLIF(v_row->>'url',''),(v_row->>'sortOrder')::integer,
      'ai',jsonb_build_object('materializationJobId',p_job_id));
    v_count:=v_count+1;
  END LOOP;
  RETURN QUERY SELECT v_version,v_count;
END $$;

REVOKE ALL ON FUNCTION app.replace_trip_useful_information_v3(UUID,UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.replace_trip_useful_information_v3(UUID,UUID,UUID,JSONB) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('089_v3_useful_information_isolated_materialization') ON CONFLICT(version) DO NOTHING;
