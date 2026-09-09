-- Associate countries with a draft as soon as its source document has been interpreted.
-- The shared country profile can therefore be generated before programme publication.
CREATE OR REPLACE FUNCTION app.link_import_country_catalog_v3(
  p_actor UUID,p_import UUID,p_agency UUID,p_primary_country UUID,p_country_ids UUID[]
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,travel,ops SET row_security=off AS $$
DECLARE v_template UUID;v_country UUID;v_sort SMALLINT:=0;
BEGIN
  PERFORM app.require_agency_editor_v3(p_actor,p_agency);
  IF p_primary_country IS NULL OR cardinality(COALESCE(p_country_ids,ARRAY[]::UUID[]))=0
    OR NOT p_primary_country=ANY(p_country_ids) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid import country catalog';
  END IF;
  SELECT import_job.template_id INTO v_template
  FROM ops.import_jobs import_job
  WHERE import_job.id=p_import AND import_job.agency_id=p_agency
    AND import_job.status='ready_for_review'
  FOR UPDATE;
  IF v_template IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='reviewable import not found';
  END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(p_country_ids) country_id
    LEFT JOIN ref.countries country ON country.id=country_id
    WHERE country.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unknown country in import catalog';
  END IF;

  DELETE FROM travel.template_countries link
  WHERE link.agency_id=p_agency AND link.template_id=v_template;
  FOREACH v_country IN ARRAY p_country_ids LOOP
    IF NOT EXISTS(
      SELECT 1 FROM travel.template_countries link
      WHERE link.template_id=v_template AND link.country_id=v_country
    ) THEN
      INSERT INTO travel.template_countries(agency_id,template_id,country_id,sort_order)
      VALUES(p_agency,v_template,v_country,v_sort);
      v_sort:=v_sort+1;
    END IF;
  END LOOP;
  UPDATE travel.trip_templates template
  SET primary_country_id=p_primary_country,updated_at=clock_timestamp()
  WHERE template.id=v_template AND template.agency_id=p_agency;
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION app.link_import_country_catalog_v3(UUID,UUID,UUID,UUID,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.link_import_country_catalog_v3(UUID,UUID,UUID,UUID,UUID[]) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('205_v3_import_country_profile_trigger') ON CONFLICT(version) DO NOTHING;
