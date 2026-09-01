DO $$
DECLARE v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('app.complete_photo_contest_evaluation_v3(uuid,uuid[],text,jsonb)'::regprocedure)
  INTO v_definition;
  v_definition:=replace(v_definition,
    'left(COALESCE(value ->> ''reason''::text, ''''::text), 500)',
    'COALESCE(value ->> ''reason''::text, ''''::text)');
  IF v_definition LIKE '%left(COALESCE(value ->> ''reason''::text, ''''::text), 500)%' THEN
    RAISE EXCEPTION 'photo contest reason limit was not removed';
  END IF;
  EXECUTE v_definition;
END $$;

INSERT INTO public.platform_schema_migrations(version)
VALUES('126_v3_photo_contest_full_ai_reason') ON CONFLICT(version) DO NOTHING;
