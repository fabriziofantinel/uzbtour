DO $$
DECLARE v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('app.complete_photo_contest_evaluation_v3(uuid,uuid[],text,jsonb)'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%ORDER BY judged.score DESC,entry.submitted_at,entry.id%' THEN
    v_definition:=replace(v_definition,
      'ORDER BY judged.score DESC,entry.participant_slot,entry.id LIMIT 1;',
      'ORDER BY judged.score DESC,entry.submitted_at,entry.id LIMIT 1;');
    IF v_definition NOT LIKE '%ORDER BY judged.score DESC,entry.submitted_at,entry.id%' THEN
      RAISE EXCEPTION 'unexpected complete contest evaluation definition';
    END IF;
    EXECUTE v_definition;
  END IF;

  SELECT pg_get_functiondef('app.close_due_photo_contests_v3()'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%ORDER BY score.score DESC,entry.submitted_at,entry.id%' THEN
    v_definition:=replace(v_definition,
      'ORDER BY score.score DESC,entry.evaluated_at,entry.id LIMIT 1;',
      'ORDER BY score.score DESC,entry.submitted_at,entry.id LIMIT 1;');
    IF v_definition NOT LIKE '%ORDER BY score.score DESC,entry.submitted_at,entry.id%' THEN
      RAISE EXCEPTION 'unexpected close contest definition';
    END IF;
    EXECUTE v_definition;
  END IF;
END $$;

INSERT INTO public.platform_schema_migrations(version)
VALUES('125_v3_photo_contest_upload_time_tiebreak') ON CONFLICT(version) DO NOTHING;
