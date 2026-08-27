-- Corregge il riferimento ambiguo a template_id introdotto dalla funzione tabellare.
CREATE OR REPLACE FUNCTION app.publish_import_programme_v3(
  p_actor_legacy_user_id TEXT,p_import_id UUID,p_agency_id UUID,p_draft JSONB,
  p_catalog JSONB,p_start_date DATE,p_end_date DATE,p_departure_id UUID,p_departure_code TEXT
)
RETURNS TABLE(template_id UUID,departure_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_template UUID;v_version UUID;v_timezone TEXT;v_day JSONB;v_refs JSONB;
  v_day_id UUID;v_item JSONB;v_accommodation JSONB;v_stay_id UUID;v_index INTEGER:=0;
  v_item_index INTEGER;v_site_index INTEGER;v_stay_index INTEGER;
  v_info JSONB;v_country TEXT;v_city TEXT;v_site TEXT;v_hotel TEXT;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF jsonb_typeof(p_draft)<>'object' OR jsonb_typeof(p_draft->'days')<>'array'
    OR jsonb_array_length(p_draft->'days')=0 OR p_end_date<p_start_date THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid programme draft';
  END IF;
  SELECT import_job.template_id,version.id,template.default_timezone INTO v_template,v_version,v_timezone
  FROM ops.import_jobs import_job
  JOIN travel.trip_templates template ON template.id=import_job.template_id AND template.agency_id=import_job.agency_id
  JOIN LATERAL(SELECT version_row.id FROM travel.trip_template_versions version_row
    WHERE version_row.agency_id=import_job.agency_id AND version_row.template_id=import_job.template_id
      AND version_row.status='draft' ORDER BY version_row.version_number DESC LIMIT 1) version ON true
  WHERE import_job.id=p_import_id AND import_job.agency_id=p_agency_id
    AND import_job.status='ready_for_review' FOR UPDATE OF import_job;
  IF v_version IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='import is not publishable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text,0));

  DELETE FROM travel.template_useful_information WHERE agency_id=p_agency_id AND template_version_id=v_version;
  DELETE FROM travel.template_days WHERE agency_id=p_agency_id AND template_version_id=v_version;
  DELETE FROM travel.template_countries WHERE agency_id=p_agency_id AND template_id=v_template;
  FOR v_country IN SELECT jsonb_array_elements_text(COALESCE(p_catalog->'countryIds','[]')) LOOP
    INSERT INTO travel.template_countries(agency_id,template_id,country_id,sort_order)
    VALUES(p_agency_id,v_template,v_country::uuid,
      (SELECT count(*)::smallint FROM travel.template_countries WHERE template_id=v_template));
  END LOOP;

  FOR v_day IN SELECT value FROM jsonb_array_elements(p_draft->'days') LOOP
    v_refs:=COALESCE(p_catalog->'dayReferences'->v_index,'{}');v_day_id:=uuidv7();
    INSERT INTO travel.template_days(id,agency_id,template_version_id,day_number,day_offset,title,description,metadata)
    VALUES(v_day_id,p_agency_id,v_version,(v_index+1)::smallint,v_index::smallint,
      COALESCE(v_day->>'title',''),COALESCE(v_day->>'description',''),
      jsonb_build_object('legacyLabel',COALESCE(v_day->>'label',''),'legacyCity',COALESCE(v_day->>'city',''),
        'sourceDate',NULLIF(v_day->>'date',''),'importedDayNumber',v_day->'dayNumber','country',v_day->'country',
        'countryValidation',v_day->'countryValidation','cityValidation',v_day->'cityValidation'));
    FOR v_city IN SELECT jsonb_array_elements_text(COALESCE(v_refs->'cityIds','[]')) LOOP
      INSERT INTO travel.template_day_cities(agency_id,template_version_id,template_day_id,city_id,sort_order)
      VALUES(p_agency_id,v_version,v_day_id,v_city::uuid,
        (SELECT count(*)::smallint FROM travel.template_day_cities WHERE template_day_id=v_day_id));
    END LOOP;
    FOR v_site IN SELECT jsonb_array_elements_text(COALESCE(v_refs->'siteIds','[]')) LOOP
      INSERT INTO travel.template_day_sites(agency_id,template_version_id,template_day_id,visit_site_id,sort_order)
      VALUES(p_agency_id,v_version,v_day_id,v_site::uuid,
        (SELECT count(*)::smallint FROM travel.template_day_sites WHERE template_day_id=v_day_id));
    END LOOP;
    v_item_index:=0;v_site_index:=0;
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_day->'activities','[]')) LOOP
      INSERT INTO travel.template_itinerary_items(agency_id,template_version_id,template_day_id,
        visit_site_id,item_type,title,description,notes,sort_order,scheduled_start_local,scheduled_end_local,metadata)
      VALUES(p_agency_id,v_version,v_day_id,
        CASE WHEN v_item->>'type'='visit' AND v_refs->'siteIds'->>v_site_index IS NOT NULL
          THEN (v_refs->'siteIds'->>v_site_index)::uuid END,
        COALESCE(NULLIF(v_item->>'type',''),'other'),COALESCE(NULLIF(v_item->>'title',''),'Attività'),
        COALESCE(v_item->>'description',''),COALESCE(v_item->>'notes',''),v_item_index,
        CASE WHEN v_item->>'type' IN('transport','flight','train','meal','meeting')
          AND COALESCE(v_item->>'startsAt','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN (v_item->>'startsAt')::time END,
        CASE WHEN v_item->>'type' IN('transport','flight','train','meal','meeting')
          AND COALESCE(v_item->>'endsAt','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN (v_item->>'endsAt')::time END,
        jsonb_strip_nulls(jsonb_build_object('placeName',v_item->>'placeName','placeCity',v_item->>'placeCity',
          'placeCountry',v_item->>'placeCountry','placeValidation',v_item->'placeValidation',
          'includedInQuote',v_item->'includedInQuote')));
      IF v_item->>'type'='visit' THEN v_site_index:=v_site_index+1; END IF;v_item_index:=v_item_index+1;
    END LOOP;

    v_stay_index:=0;
    FOR v_accommodation IN
      SELECT value FROM jsonb_array_elements(
        jsonb_build_array(COALESCE(v_day->'accommodation','{}'::jsonb)) ||
        COALESCE(v_day->'additionalAccommodations','[]'::jsonb)
      )
    LOOP
      IF NULLIF(btrim(COALESCE(v_accommodation->>'name','')),'') IS NOT NULL THEN
        v_stay_id:=uuidv7();
        v_hotel:=NULLIF(COALESCE(v_refs->'hotelIds'->>v_stay_index,
          CASE WHEN v_stay_index=0 THEN v_refs->>'hotelId' END),'');
        INSERT INTO travel.template_accommodation_stays(id,agency_id,template_version_id,
          template_day_id,hotel_id,name_snapshot,notes,sort_order,metadata)
        VALUES(v_stay_id,p_agency_id,v_version,v_day_id,v_hotel::uuid,v_accommodation->>'name',
          COALESCE(v_accommodation->>'notes',''),v_stay_index,
          jsonb_strip_nulls(jsonb_build_object('city',v_accommodation->>'city','country',v_accommodation->>'country',
            'validation',v_accommodation->'validation')));
        IF v_hotel IS NOT NULL THEN
          INSERT INTO travel.template_day_hotels(agency_id,template_version_id,template_day_id,hotel_id,sort_order)
          VALUES(p_agency_id,v_version,v_day_id,v_hotel::uuid,v_stay_index) ON CONFLICT DO NOTHING;
        END IF;
        v_stay_index:=v_stay_index+1;
      END IF;
    END LOOP;
    v_index:=v_index+1;
  END LOOP;

  v_index:=0;
  FOR v_info IN SELECT value FROM jsonb_array_elements(COALESCE(p_draft->'usefulInformation','[]')) LOOP
    INSERT INTO travel.template_useful_information(agency_id,template_version_id,category,title,body,phone,url,sort_order,source)
    VALUES(p_agency_id,v_version,COALESCE(NULLIF(v_info->>'category',''),'Generale'),
      COALESCE(NULLIF(v_info->>'title',''),'Informazione utile'),COALESCE(v_info->>'body',''),
      NULLIF(v_info->>'phone',''),NULLIF(v_info->>'url',''),v_index,'import');v_index:=v_index+1;
  END LOOP;
  UPDATE travel.trip_templates SET title=COALESCE(NULLIF(p_draft->>'title',''),title),
    primary_country_id=NULLIF(p_catalog->>'primaryCountryId','')::uuid,description=COALESCE(p_draft->>'summary',''),
    status='active',updated_at=clock_timestamp() WHERE id=v_template AND agency_id=p_agency_id;
  UPDATE travel.trip_template_versions SET status='published',published_at=clock_timestamp(),
    published_by_user_id=v_actor,revision_note='Programma revisionato e pubblicato dall’agenzia.'
    WHERE id=v_version AND agency_id=p_agency_id AND status='draft';
  INSERT INTO travel.departures(id,agency_id,template_id,template_version_id,code,title,starts_on,ends_on,timezone,status,published_at)
  VALUES(p_departure_id,p_agency_id,v_template,v_version,p_departure_code,
    COALESCE(NULLIF(p_draft->>'title',''),'Viaggio'),p_start_date,p_end_date,
    COALESCE(NULLIF(v_timezone,''),'UTC'),'confirmed',clock_timestamp())
  ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,starts_on=EXCLUDED.starts_on,
    ends_on=EXCLUDED.ends_on,status='confirmed',updated_at=clock_timestamp();
  PERFORM app.materialize_departure_programme_v3(p_departure_id);
  UPDATE ops.import_jobs SET status='published',updated_at=clock_timestamp()
    WHERE id=p_import_id AND agency_id=p_agency_id;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'trip_template',v_template::text,'programme_published',
    jsonb_build_object('importId',p_import_id,'days',jsonb_array_length(p_draft->'days')));
  RETURN QUERY SELECT v_template,p_departure_id;
END $$;

REVOKE ALL ON FUNCTION app.publish_import_programme_v3(TEXT,UUID,UUID,JSONB,JSONB,DATE,DATE,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_import_programme_v3(TEXT,UUID,UUID,JSONB,JSONB,DATE,DATE,UUID,TEXT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('070_v3_publish_template_id_ambiguity_fix') ON CONFLICT(version) DO NOTHING;
