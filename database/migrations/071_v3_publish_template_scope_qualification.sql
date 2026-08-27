-- Qualifica ogni riferimento residuo a template_id nella funzione tabellare di pubblicazione.
DO $migration$
DECLARE
  v_signature regprocedure := 'app.publish_import_programme_v3(text,uuid,uuid,jsonb,jsonb,date,date,uuid,text)'::regprocedure;
  v_original TEXT;
  v_corrected TEXT;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_original;
  v_corrected := replace(
    v_original,
    'DELETE FROM travel.template_countries WHERE agency_id=p_agency_id AND template_id=v_template;',
    'DELETE FROM travel.template_countries template_country WHERE template_country.agency_id=p_agency_id AND template_country.template_id=v_template;'
  );
  v_corrected := replace(
    v_corrected,
    '(SELECT count(*)::smallint FROM travel.template_countries WHERE template_id=v_template)',
    '(SELECT count(*)::smallint FROM travel.template_countries template_country_count WHERE template_country_count.template_id=v_template)'
  );
  IF v_corrected = v_original
    OR position('WHERE agency_id=p_agency_id AND template_id=v_template' IN v_corrected) > 0
    OR position('WHERE template_id=v_template' IN v_corrected) > 0 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='publish function qualification gate failed';
  END IF;
  EXECUTE v_corrected;
END $migration$;

REVOKE ALL ON FUNCTION app.publish_import_programme_v3(TEXT,UUID,UUID,JSONB,JSONB,DATE,DATE,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_import_programme_v3(TEXT,UUID,UUID,JSONB,JSONB,DATE,DATE,UUID,TEXT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('071_v3_publish_template_scope_qualification') ON CONFLICT(version) DO NOTHING;
