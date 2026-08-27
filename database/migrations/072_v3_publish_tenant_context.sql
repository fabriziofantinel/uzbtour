-- Imposta il tenant nella stessa transazione della pubblicazione prima dei publish gate.
DO $migration$
DECLARE
  v_signature regprocedure := 'app.publish_import_programme_v3(text,uuid,uuid,jsonb,jsonb,date,date,uuid,text)'::regprocedure;
  v_original TEXT;
  v_corrected TEXT;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_original;
  IF position('set_config(''app.agency_id'',p_agency_id::text,true)' IN v_original) > 0 THEN
    v_corrected := v_original;
  ELSE
    v_corrected := replace(
      v_original,
      'v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);',
      'v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);' || chr(10) ||
      '  PERFORM set_config(''app.agency_id'',p_agency_id::text,true);'
    );
  END IF;
  IF position('set_config(''app.agency_id'',p_agency_id::text,true)' IN v_corrected) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='publish tenant context gate failed';
  END IF;
  EXECUTE v_corrected;
END $migration$;

REVOKE ALL ON FUNCTION app.publish_import_programme_v3(TEXT,UUID,UUID,JSONB,JSONB,DATE,DATE,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_import_programme_v3(TEXT,UUID,UUID,JSONB,JSONB,DATE,DATE,UUID,TEXT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('072_v3_publish_tenant_context') ON CONFLICT(version) DO NOTHING;
