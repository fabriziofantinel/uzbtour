-- Keep the existing publish-gate implementation intact and align only the
-- contest cardinality predicate with the two-photo product contract.
DO $$
DECLARE v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('app.validate_template_version_publish(uuid,uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition LIKE '%max_entries = 3%' THEN
    EXECUTE replace(v_definition,'max_entries = 3','max_entries = 2');
  ELSIF v_definition NOT LIKE '%max_entries = 2%' THEN
    RAISE EXCEPTION 'unexpected publish-gate definition';
  END IF;
END $$;

INSERT INTO public.platform_schema_migrations(version)
VALUES('111_v3_photo_contest_publish_gate') ON CONFLICT(version) DO NOTHING;
