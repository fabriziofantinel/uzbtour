DO $migration$
DECLARE
  v_signature REGPROCEDURE :=
    'app.enqueue_platform_job_v3(text,uuid,text,text,jsonb,text,timestamptz)'::regprocedure;
  v_definition TEXT;
  v_corrected TEXT;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  v_corrected := replace(
    v_definition,
    '(limits.agency_id = p_agency_id) DESC,',
    '(limits.agency_id = p_agency_id) DESC NULLS LAST,'
  );
  IF v_corrected = v_definition THEN
    IF position(
      '(limits.agency_id = p_agency_id) DESC NULLS LAST,' IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION 'tenant workload limit lookup pattern not found';
    END IF;
  ELSE
    EXECUTE v_corrected;
  END IF;
END
$migration$;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('138_v3_tenant_workload_limit_precedence')
ON CONFLICT (version) DO NOTHING;
