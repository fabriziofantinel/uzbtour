-- Pubblicazione atomica e variazioni operative direttamente su Travel V3.

CREATE OR REPLACE FUNCTION app.assert_template_version_mutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops AS $$
DECLARE v_agency UUID;v_version UUID;v_status TEXT;v_job UUID;
BEGIN
  IF pg_trigger_depth()>1 AND current_setting('app.legacy_sync',true)='on' THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_agency:=CASE WHEN TG_OP='DELETE' THEN OLD.agency_id ELSE NEW.agency_id END;
  v_version:=CASE WHEN TG_OP='DELETE' THEN OLD.template_version_id ELSE NEW.template_version_id END;
  v_job:=NULLIF(current_setting('app.materialization_job_id',true),'')::uuid;
  IF v_job IS NOT NULL AND EXISTS(
    SELECT 1 FROM ops.platform_jobs job
    JOIN travel.trip_template_versions version ON version.id=v_version
      AND version.agency_id=v_agency
    WHERE job.id=v_job AND job.agency_id=v_agency
      AND job.job_type='travel-reference.enrich' AND job.status='processing'
      AND job.payload->>'templateId'=version.template_id::text
  ) THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text,0));
  SELECT status INTO v_status FROM travel.trip_template_versions
    WHERE agency_id=v_agency AND id=v_version;
  IF v_status IS NULL THEN RAISE EXCEPTION 'template version % not found in tenant %',v_version,v_agency; END IF;
  IF v_status<>'draft' THEN RAISE EXCEPTION 'template version % is immutable in status %',v_version,v_status; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION app.materialize_departure_programme_v3(p_departure_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,travel SET row_security=off AS $$
DECLARE v_departure travel.departures%ROWTYPE;v_day RECORD;v_departure_day UUID;
BEGIN
  SELECT * INTO v_departure FROM travel.departures WHERE id=p_departure_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='departure not found'; END IF;
  IF EXISTS(SELECT 1 FROM travel.travel_parties WHERE departure_id=p_departure_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='departure programme already in use';
  END IF;
  DELETE FROM travel.departure_days WHERE departure_id=p_departure_id;
  FOR v_day IN SELECT * FROM travel.template_days
    WHERE agency_id=v_departure.agency_id AND template_version_id=v_departure.template_version_id
    ORDER BY day_number
  LOOP
    v_departure_day:=uuidv7();
    INSERT INTO travel.departure_days(id,agency_id,departure_id,template_version_id,
      template_day_id,service_date)
    VALUES(v_departure_day,v_departure.agency_id,v_departure.id,v_departure.template_version_id,
      v_day.id,v_departure.starts_on+v_day.day_offset);
    INSERT INTO travel.departure_itinerary_items(agency_id,departure_id,template_version_id,
      departure_day_id,source_template_item_id,visit_site_id,hotel_id,item_type,title,
      description,notes,sort_order,scheduled_start_at,scheduled_end_at,metadata)
    SELECT item.agency_id,v_departure.id,item.template_version_id,v_departure_day,item.id,
      item.visit_site_id,item.hotel_id,item.item_type,item.title,item.description,item.notes,
      item.sort_order,
      CASE WHEN item.scheduled_start_local IS NOT NULL THEN
        ((v_departure.starts_on+v_day.day_offset)+item.scheduled_start_local) AT TIME ZONE v_departure.timezone END,
      CASE WHEN item.scheduled_end_local IS NOT NULL THEN
        ((v_departure.starts_on+v_day.day_offset)+item.scheduled_end_local+
          CASE WHEN item.scheduled_start_local IS NOT NULL
            AND item.scheduled_end_local<item.scheduled_start_local THEN interval '1 day'
          ELSE interval '0' END) AT TIME ZONE v_departure.timezone END,
      item.metadata
    FROM travel.template_itinerary_items item
    WHERE item.agency_id=v_departure.agency_id
      AND item.template_version_id=v_departure.template_version_id
      AND item.template_day_id=v_day.id ORDER BY item.sort_order;
    INSERT INTO travel.departure_accommodation_stays(agency_id,departure_id,template_version_id,
      departure_day_id,source_template_stay_id,hotel_id,name_snapshot,notes,sort_order,metadata)
    SELECT stay.agency_id,v_departure.id,stay.template_version_id,v_departure_day,stay.id,
      stay.hotel_id,stay.name_snapshot,stay.notes,stay.sort_order,stay.metadata
    FROM travel.template_accommodation_stays stay
    WHERE stay.agency_id=v_departure.agency_id
      AND stay.template_version_id=v_departure.template_version_id
      AND stay.template_day_id=v_day.id ORDER BY stay.sort_order;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_template_agency_v3(p_template_id UUID)
RETURNS TABLE(agency_id UUID) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,travel SET row_security=off AS $$
  SELECT template.agency_id FROM travel.trip_templates template WHERE template.id=p_template_id
$$;

CREATE OR REPLACE FUNCTION app.read_trip_reference_content_v3(
  p_job_id UUID,p_agency_id UUID,p_template_id UUID
)
RETURNS TABLE(template_version_id UUID,template_day_id UUID,content_type TEXT,
  content JSONB,entity_order INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ref,travel,ops SET row_security=off AS $$
  WITH authorized AS(
    SELECT 1 FROM ops.platform_jobs job
    WHERE job.id=p_job_id AND job.agency_id=p_agency_id
      AND job.job_type='travel-reference.enrich' AND job.status='processing'
      AND job.payload->>'templateId'=p_template_id::text
  ), version AS(
    SELECT v.id FROM travel.trip_template_versions v,authorized
    WHERE v.agency_id=p_agency_id AND v.template_id=p_template_id AND v.status='published'
      AND EXISTS(SELECT 1 FROM travel.template_days day
        WHERE day.agency_id=v.agency_id AND day.template_version_id=v.id)
      AND EXISTS(SELECT 1 FROM travel.template_itinerary_items item
        WHERE item.agency_id=v.agency_id AND item.template_version_id=v.id)
    ORDER BY v.version_number DESC LIMIT 1
  ), country_content AS(
    SELECT version.id,NULL::uuid,reference.content_type::text,reference.content,0
    FROM version
    JOIN travel.template_countries country ON country.agency_id=p_agency_id
      AND country.template_id=p_template_id
    JOIN ref.reference_contents reference ON reference.country_id=country.country_id
      AND reference.locale='it-IT' AND reference.status='approved'
      AND reference.content_type IN('useful_info','phrasebook','bingo')
  ), day_entities AS(
    SELECT city.template_version_id,city.template_day_id,city.city_id,NULL::uuid AS site_id,0 AS entity_order
    FROM travel.template_day_cities city JOIN version ON version.id=city.template_version_id
    WHERE city.agency_id=p_agency_id
    UNION ALL
    SELECT site.template_version_id,site.template_day_id,NULL::uuid,site.visit_site_id,1
    FROM travel.template_day_sites site JOIN version ON version.id=site.template_version_id
    WHERE site.agency_id=p_agency_id
  ), day_content AS(
    SELECT entity.template_version_id,entity.template_day_id,reference.content_type::text,
      reference.content,entity.entity_order
    FROM day_entities entity
    JOIN ref.reference_contents reference
      ON (reference.city_id=entity.city_id OR reference.visit_site_id=entity.site_id)
      AND reference.locale='it-IT' AND reference.status='approved'
      AND reference.content_type IN('quiz','mission','game','photo_contest')
  )
  SELECT * FROM country_content UNION ALL SELECT * FROM day_content
  ORDER BY 2 NULLS FIRST,5,3
$$;

CREATE OR REPLACE FUNCTION app.replace_trip_experience_v3(
  p_job_id UUID,p_agency_id UUID,p_template_id UUID,p_useful JSONB,p_phrases JSONB,p_activities JSONB
)
RETURNS TABLE(template_version_id UUID,generated_sections INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,content,ops SET row_security=off AS $$
DECLARE v_version UUID;v_row JSONB;v_item JSONB;v_activity UUID;v_count INTEGER:=0;
BEGIN
  IF jsonb_typeof(p_useful)<>'array' OR jsonb_typeof(p_phrases)<>'array'
    OR jsonb_typeof(p_activities)<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid generated experience payload';
  END IF;
  SELECT version.id INTO v_version
  FROM ops.platform_jobs job
  JOIN LATERAL(SELECT id FROM travel.trip_template_versions
    WHERE agency_id=p_agency_id AND template_id=p_template_id AND status='published'
      AND EXISTS(SELECT 1 FROM travel.template_days day
        WHERE day.agency_id=p_agency_id AND day.template_version_id=travel.trip_template_versions.id)
      AND EXISTS(SELECT 1 FROM travel.template_itinerary_items item
        WHERE item.agency_id=p_agency_id AND item.template_version_id=travel.trip_template_versions.id)
    ORDER BY version_number DESC LIMIT 1) version ON true
  WHERE job.id=p_job_id AND job.agency_id=p_agency_id
    AND job.job_type='travel-reference.enrich' AND job.status='processing'
    AND job.payload->>'templateId'=p_template_id::text FOR UPDATE OF job;
  IF v_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='materialization job is not authorized';
  END IF;
  PERFORM set_config('app.materialization_job_id',p_job_id::text,true);
  DELETE FROM travel.template_useful_information information
    WHERE information.agency_id=p_agency_id AND information.template_version_id=v_version
      AND information.source='ai';
  DELETE FROM travel.template_phrasebook_entries phrase
    WHERE phrase.agency_id=p_agency_id AND phrase.template_version_id=v_version
      AND phrase.source='ai';
  UPDATE content.activities activity SET status='archived',updated_at=clock_timestamp()
    WHERE activity.agency_id=p_agency_id AND activity.template_version_id=v_version
      AND activity.source='ai' AND activity.status<>'archived';
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_useful) LOOP
    INSERT INTO travel.template_useful_information(agency_id,template_version_id,category,
      title,body,sort_order,source,metadata)
    VALUES(p_agency_id,v_version,v_row->>'category',v_row->>'title',COALESCE(v_row->>'body',''),
      (v_row->>'sortOrder')::integer,'ai',jsonb_build_object('materializationJobId',p_job_id));
    v_count:=v_count+1;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_phrases) LOOP
    INSERT INTO travel.template_phrasebook_entries(agency_id,template_version_id,locale,
      language_code,category,term,pronunciation,translation,sort_order,source)
    VALUES(p_agency_id,v_version,'it-IT',v_row->>'language','general',v_row->>'term',
      COALESCE(v_row->>'pronunciation',''),v_row->>'translation',
      (v_row->>'sortOrder')::integer,'ai');
    v_count:=v_count+1;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_activities) LOOP
    v_activity:=uuidv7();
    INSERT INTO content.activities(id,agency_id,template_version_id,template_day_id,
      activity_type,contest_category,title,instructions,availability_rule,relative_days,
      unlock_local_time,max_score,max_entries,status,source,sort_order,config)
    VALUES(v_activity,p_agency_id,v_version,NULLIF(v_row->>'templateDayId','')::uuid,
      v_row->>'activityType',NULLIF(v_row->>'contestCategory',''),v_row->>'title',
      COALESCE(v_row->>'instructions',''),v_row->>'availabilityRule',
      NULLIF(v_row->>'relativeDays','')::smallint,NULLIF(v_row->>'unlockLocalTime','')::time,
      NULLIF(v_row->>'maxScore','')::integer,NULLIF(v_row->>'maxEntries','')::smallint,
      'approved','ai',(v_row->>'sortOrder')::integer,
      jsonb_build_object('materializationJobId',p_job_id));
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_row->'items','[]')) LOOP
      INSERT INTO content.activity_items(agency_id,template_version_id,activity_id,ordinal,
        item_kind,prompt,payload,answer_spec,points)
      VALUES(p_agency_id,v_version,v_activity,(v_item->>'ordinal')::smallint,
        v_item->>'itemKind',COALESCE(v_item->>'prompt',''),COALESCE(v_item->'payload','{}'),
        COALESCE(v_item->'answerSpec','{}'),COALESCE((v_item->>'points')::integer,0));
      v_count:=v_count+1;
    END LOOP;
    v_count:=v_count+1;
  END LOOP;
  RETURN QUERY SELECT v_version,v_count;
END $$;

CREATE OR REPLACE FUNCTION app.publish_import_programme_v3(
  p_actor_legacy_user_id TEXT,p_import_id UUID,p_agency_id UUID,p_draft JSONB,
  p_catalog JSONB,p_start_date DATE,p_end_date DATE,p_departure_id UUID,p_departure_code TEXT
)
RETURNS TABLE(template_id UUID,departure_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_template UUID;v_version UUID;v_timezone TEXT;v_day JSONB;v_refs JSONB;
  v_day_id UUID;v_item JSONB;v_stay_id UUID;v_index INTEGER:=0;v_item_index INTEGER;v_site_index INTEGER;
  v_info JSONB;v_country TEXT;v_city TEXT;v_site TEXT;v_hotel TEXT;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF jsonb_typeof(p_draft)<>'object' OR jsonb_typeof(p_draft->'days')<>'array'
    OR jsonb_array_length(p_draft->'days')=0 OR p_end_date<p_start_date THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid programme draft';
  END IF;
  SELECT import_job.template_id,version.id,template.default_timezone
    INTO v_template,v_version,v_timezone
  FROM ops.import_jobs import_job
  JOIN travel.trip_templates template ON template.id=import_job.template_id
    AND template.agency_id=import_job.agency_id
  JOIN LATERAL(SELECT id FROM travel.trip_template_versions
    WHERE agency_id=import_job.agency_id AND template_id=import_job.template_id
      AND status='draft' ORDER BY version_number DESC LIMIT 1) version ON true
  WHERE import_job.id=p_import_id AND import_job.agency_id=p_agency_id
    AND import_job.status='ready_for_review' FOR UPDATE OF import_job;
  IF v_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='import is not publishable';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text,0));

  DELETE FROM travel.template_useful_information
    WHERE agency_id=p_agency_id AND template_version_id=v_version;
  DELETE FROM travel.template_days
    WHERE agency_id=p_agency_id AND template_version_id=v_version;
  DELETE FROM travel.template_countries WHERE agency_id=p_agency_id AND template_id=v_template;

  FOR v_country IN SELECT jsonb_array_elements_text(COALESCE(p_catalog->'countryIds','[]')) LOOP
    INSERT INTO travel.template_countries(agency_id,template_id,country_id,sort_order)
    VALUES(p_agency_id,v_template,v_country::uuid,
      (SELECT count(*)::smallint FROM travel.template_countries WHERE template_id=v_template));
  END LOOP;

  FOR v_day IN SELECT value FROM jsonb_array_elements(p_draft->'days') LOOP
    v_refs:=COALESCE(p_catalog->'dayReferences'->v_index,'{}');
    v_day_id:=uuidv7();
    INSERT INTO travel.template_days(id,agency_id,template_version_id,day_number,day_offset,
      title,description,metadata)
    VALUES(v_day_id,p_agency_id,v_version,(v_index+1)::smallint,v_index::smallint,
      COALESCE(v_day->>'title',''),COALESCE(v_day->>'description',''),
      jsonb_build_object('legacyLabel',COALESCE(v_day->>'label',''),
        'legacyCity',COALESCE(v_day->>'city',''),'sourceDate',NULLIF(v_day->>'date',''),
        'importedDayNumber',v_day->'dayNumber','country',v_day->'country',
        'countryValidation',v_day->'countryValidation','cityValidation',v_day->'cityValidation'));
    FOR v_city IN SELECT jsonb_array_elements_text(COALESCE(v_refs->'cityIds','[]')) LOOP
      INSERT INTO travel.template_day_cities(agency_id,template_version_id,template_day_id,
        city_id,sort_order)
      VALUES(p_agency_id,v_version,v_day_id,v_city::uuid,
        (SELECT count(*)::smallint FROM travel.template_day_cities WHERE template_day_id=v_day_id));
    END LOOP;
    FOR v_site IN SELECT jsonb_array_elements_text(COALESCE(v_refs->'siteIds','[]')) LOOP
      INSERT INTO travel.template_day_sites(agency_id,template_version_id,template_day_id,
        visit_site_id,sort_order)
      VALUES(p_agency_id,v_version,v_day_id,v_site::uuid,
        (SELECT count(*)::smallint FROM travel.template_day_sites WHERE template_day_id=v_day_id));
    END LOOP;
    v_item_index:=0;v_site_index:=0;
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_day->'activities','[]')) LOOP
      INSERT INTO travel.template_itinerary_items(agency_id,template_version_id,template_day_id,
        visit_site_id,item_type,title,description,notes,sort_order,scheduled_start_local,
        scheduled_end_local,metadata)
      VALUES(p_agency_id,v_version,v_day_id,
        CASE WHEN v_item->>'type'='visit' AND v_refs->'siteIds'->>v_site_index IS NOT NULL
          THEN (v_refs->'siteIds'->>v_site_index)::uuid END,
        COALESCE(NULLIF(v_item->>'type',''),'other'),
        COALESCE(NULLIF(v_item->>'title',''),'Attività'),COALESCE(v_item->>'description',''),
        COALESCE(v_item->>'notes',''),v_item_index,
        CASE WHEN v_item->>'type' IN('transport','flight','train')
          AND COALESCE(v_item->>'startsAt','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
          THEN (v_item->>'startsAt')::time END,
        CASE WHEN v_item->>'type' IN('transport','flight','train')
          AND COALESCE(v_item->>'endsAt','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
          THEN (v_item->>'endsAt')::time END,
        jsonb_strip_nulls(jsonb_build_object('placeName',v_item->>'placeName',
          'placeCity',v_item->>'placeCity','placeCountry',v_item->>'placeCountry',
          'placeValidation',v_item->'placeValidation','includedInQuote',v_item->'includedInQuote')));
      IF v_item->>'type'='visit' THEN v_site_index:=v_site_index+1; END IF;
      v_item_index:=v_item_index+1;
    END LOOP;
    IF NULLIF(btrim(COALESCE(v_day->'accommodation'->>'name','')),'') IS NOT NULL THEN
      v_stay_id:=uuidv7();v_hotel:=NULLIF(v_refs->>'hotelId','');
      INSERT INTO travel.template_accommodation_stays(id,agency_id,template_version_id,
        template_day_id,hotel_id,name_snapshot,notes,sort_order,metadata)
      VALUES(v_stay_id,p_agency_id,v_version,v_day_id,v_hotel::uuid,
        v_day->'accommodation'->>'name',COALESCE(v_day->'accommodation'->>'notes',''),0,
        jsonb_strip_nulls(jsonb_build_object('city',v_day->'accommodation'->>'city',
          'country',v_day->'accommodation'->>'country',
          'validation',v_day->'accommodation'->'validation')));
      IF v_hotel IS NOT NULL THEN
        INSERT INTO travel.template_day_hotels(agency_id,template_version_id,template_day_id,
          hotel_id,sort_order) VALUES(p_agency_id,v_version,v_day_id,v_hotel::uuid,0);
      END IF;
    END IF;
    v_index:=v_index+1;
  END LOOP;
  v_index:=0;
  FOR v_info IN SELECT value FROM jsonb_array_elements(COALESCE(p_draft->'usefulInformation','[]')) LOOP
    INSERT INTO travel.template_useful_information(agency_id,template_version_id,category,
      title,body,phone,url,sort_order,source)
    VALUES(p_agency_id,v_version,COALESCE(NULLIF(v_info->>'category',''),'Generale'),
      COALESCE(NULLIF(v_info->>'title',''),'Informazione utile'),COALESCE(v_info->>'body',''),
      NULLIF(v_info->>'phone',''),NULLIF(v_info->>'url',''),v_index,'import');
    v_index:=v_index+1;
  END LOOP;
  UPDATE travel.trip_templates SET title=COALESCE(NULLIF(p_draft->>'title',''),title),
    primary_country_id=NULLIF(p_catalog->>'primaryCountryId','')::uuid,
    description=COALESCE(p_draft->>'summary',''),status='active',updated_at=clock_timestamp()
  WHERE id=v_template AND agency_id=p_agency_id;
  UPDATE travel.trip_template_versions SET status='published',published_at=clock_timestamp(),
    published_by_user_id=v_actor,revision_note='Programma revisionato e pubblicato dall’agenzia.'
  WHERE id=v_version AND agency_id=p_agency_id AND status='draft';
  INSERT INTO travel.departures(id,agency_id,template_id,template_version_id,code,title,
    starts_on,ends_on,timezone,status,published_at)
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

CREATE OR REPLACE FUNCTION app.update_departure_programme_day_v3(
  p_actor_legacy_user_id TEXT,p_departure_id UUID,p_day_id UUID,p_label TEXT,p_title TEXT,
  p_city TEXT,p_description TEXT,p_items JSONB,p_stays JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_service_date DATE;v_timezone TEXT;v_row JSONB;
  v_start TIME;v_end TIME;v_type TEXT;v_count INTEGER;
BEGIN
  SELECT day.agency_id,day.service_date,departure.timezone
    INTO v_agency,v_service_date,v_timezone
  FROM travel.departure_days day JOIN travel.departures departure
    ON departure.id=day.departure_id AND departure.agency_id=day.agency_id
  WHERE day.id=p_day_id AND day.departure_id=p_departure_id FOR UPDATE OF day;
  IF v_agency IS NULL THEN RETURN false; END IF;
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,v_agency);
  IF jsonb_typeof(p_items)<>'array' OR jsonb_typeof(p_stays)<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid programme items';
  END IF;
  SELECT count(*) INTO v_count FROM travel.departure_itinerary_items item
  WHERE item.agency_id=v_agency AND item.departure_id=p_departure_id
    AND item.departure_day_id=p_day_id;
  IF v_count<>jsonb_array_length(p_items) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='complete itinerary item set required';
  END IF;
  SELECT count(*) INTO v_count FROM travel.departure_itinerary_items item
  WHERE item.agency_id=v_agency AND item.departure_id=p_departure_id
    AND item.departure_day_id=p_day_id
    AND item.id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_items));
  IF v_count<>jsonb_array_length(p_items) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid itinerary item scope';
  END IF;
  SELECT count(*) INTO v_count FROM travel.departure_accommodation_stays stay
  WHERE stay.agency_id=v_agency AND stay.departure_id=p_departure_id
    AND stay.departure_day_id=p_day_id AND stay.operational_status<>'cancelled';
  IF v_count<>jsonb_array_length(p_stays) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='complete accommodation stay set required';
  END IF;
  SELECT count(*) INTO v_count FROM travel.departure_accommodation_stays stay
  WHERE stay.agency_id=v_agency AND stay.departure_id=p_departure_id
    AND stay.departure_day_id=p_day_id AND stay.operational_status<>'cancelled'
    AND stay.id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_stays));
  IF v_count<>jsonb_array_length(p_stays) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid accommodation stay scope';
  END IF;
  UPDATE travel.departure_days SET label_override=p_label,title_override=p_title,
    city_override=p_city,description_override=p_description,updated_at=clock_timestamp()
  WHERE id=p_day_id AND agency_id=v_agency AND departure_id=p_departure_id;
  UPDATE travel.departure_itinerary_items SET sort_order=sort_order+100000
    WHERE agency_id=v_agency AND departure_id=p_departure_id AND departure_day_id=p_day_id;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT item_type INTO v_type FROM travel.departure_itinerary_items
      WHERE id=(v_row->>'id')::uuid;
    v_start:=CASE WHEN v_type IN('transport','flight','train')
      AND COALESCE(v_row->>'startsAt','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN (v_row->>'startsAt')::time END;
    v_end:=CASE WHEN v_type IN('transport','flight','train')
      AND COALESCE(v_row->>'endsAt','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN (v_row->>'endsAt')::time END;
    UPDATE travel.departure_itinerary_items SET title=v_row->>'title',
      description=COALESCE(v_row->>'description',''),sort_order=(v_row->>'sortOrder')::integer,
      scheduled_start_at=CASE WHEN v_start IS NULL THEN NULL ELSE (v_service_date+v_start) AT TIME ZONE v_timezone END,
      scheduled_end_at=CASE WHEN v_end IS NULL THEN NULL ELSE
        (v_service_date+v_end+CASE WHEN v_start IS NOT NULL AND v_end<v_start
          THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE v_timezone END,
      metadata=metadata||jsonb_strip_nulls(jsonb_build_object('includedInQuote',v_row->'includedInQuote')),
      updated_at=clock_timestamp()
    WHERE id=(v_row->>'id')::uuid AND agency_id=v_agency AND departure_id=p_departure_id;
  END LOOP;
  UPDATE travel.departure_accommodation_stays SET sort_order=sort_order+100000
    WHERE agency_id=v_agency AND departure_id=p_departure_id AND departure_day_id=p_day_id;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_stays) LOOP
    UPDATE travel.departure_accommodation_stays SET name_snapshot=v_row->>'name',
      notes=COALESCE(v_row->>'notes',''),sort_order=(v_row->>'sortOrder')::integer,
      updated_at=clock_timestamp()
    WHERE id=(v_row->>'id')::uuid AND agency_id=v_agency AND departure_id=p_departure_id;
  END LOOP;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,v_actor,'departure_day',p_day_id::text,'updated',
    jsonb_build_object('departureId',p_departure_id));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.create_departure_from_programme_v3(
  p_actor_legacy_user_id TEXT,p_template_id UUID,p_departure_id UUID,p_code TEXT,
  p_title TEXT,p_starts_on DATE,p_ends_on DATE
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel SET row_security=off AS $$
DECLARE v_agency UUID;v_version UUID;v_timezone TEXT;
BEGIN
  SELECT template.agency_id,version.id,template.default_timezone
    INTO v_agency,v_version,v_timezone
  FROM travel.trip_templates template
  JOIN LATERAL(SELECT id FROM travel.trip_template_versions
    WHERE agency_id=template.agency_id AND template_id=template.id AND status='published'
      AND EXISTS(SELECT 1 FROM travel.template_days day
        WHERE day.agency_id=template.agency_id AND day.template_version_id=travel.trip_template_versions.id)
      AND EXISTS(SELECT 1 FROM travel.template_itinerary_items item
        WHERE item.agency_id=template.agency_id AND item.template_version_id=travel.trip_template_versions.id)
    ORDER BY version_number DESC LIMIT 1) version ON true
  WHERE template.id=p_template_id AND template.status='active';
  IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='published template not found'; END IF;
  PERFORM app.require_agency_editor(p_actor_legacy_user_id,v_agency);
  INSERT INTO travel.departures(id,agency_id,template_id,template_version_id,code,title,
    starts_on,ends_on,timezone,status,published_at)
  VALUES(p_departure_id,v_agency,p_template_id,v_version,p_code,p_title,p_starts_on,p_ends_on,
    v_timezone,'confirmed',clock_timestamp());
  PERFORM app.materialize_departure_programme_v3(p_departure_id);
  RETURN p_departure_id;
END $$;

REVOKE ALL ON FUNCTION app.materialize_departure_programme_v3(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_template_agency_v3(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_trip_reference_content_v3(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.replace_trip_experience_v3(UUID,UUID,UUID,JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_import_programme_v3(TEXT,UUID,UUID,JSONB,JSONB,DATE,DATE,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_departure_programme_day_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_departure_from_programme_v3(TEXT,UUID,UUID,TEXT,TEXT,DATE,DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_import_programme_v3(TEXT,UUID,UUID,JSONB,JSONB,DATE,DATE,UUID,TEXT),
 app.resolve_template_agency_v3(UUID),
 app.read_trip_reference_content_v3(UUID,UUID,UUID),
 app.replace_trip_experience_v3(UUID,UUID,UUID,JSONB,JSONB,JSONB),
 app.update_departure_programme_day_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB),
 app.create_departure_from_programme_v3(TEXT,UUID,UUID,TEXT,TEXT,DATE,DATE) TO smf_app;
GRANT SELECT ON travel.departure_accommodation_stays,travel.template_accommodation_stays TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('046_v3_programme_write_cutover') ON CONFLICT(version) DO NOTHING;
