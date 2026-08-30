-- Global bingo activities have no template_day_id. They are played from a
-- concrete departure day, which remains the operational audit day.
DO $$
DECLARE v_name TEXT;v_definition TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'app.save_activity_item_result_v3(text,uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,jsonb,uuid)',
    'app.submit_photo_evidence_v3(text,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'
  ] LOOP
    SELECT pg_get_functiondef(v_name::regprocedure) INTO v_definition;
    IF v_definition LIKE '%activity.template_day_id=p_template_day_id%' THEN
      v_definition:=replace(v_definition,
        'activity.template_day_id=p_template_day_id',
        '(activity.template_day_id=p_template_day_id OR (activity.activity_type=''bingo'' AND activity.template_day_id IS NULL))');
      EXECUTE v_definition;
    ELSIF v_definition NOT LIKE '%activity.activity_type=''bingo'' AND activity.template_day_id IS NULL%' THEN
      RAISE EXCEPTION 'unexpected function definition for %',v_name;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION app.save_activity_item_result_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,INTEGER,INTEGER,TEXT,JSONB,UUID),
  app.submit_photo_evidence_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_activity_item_result_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,INTEGER,INTEGER,TEXT,JSONB,UUID),
  app.submit_photo_evidence_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('112_v3_trip_bingo_write_scope') ON CONFLICT(version) DO NOTHING;
