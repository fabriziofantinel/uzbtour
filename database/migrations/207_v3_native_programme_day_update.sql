-- Ripristina il salvataggio del programma con l'identita IAM nativa.
CREATE OR REPLACE FUNCTION app.update_departure_programme_day_v3(
  p_actor_user_id UUID,p_departure_id UUID,p_day_id UUID,p_label TEXT,p_title TEXT,
  p_city TEXT,p_description TEXT,p_items JSONB,p_stays JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE
  v_agency UUID;v_version UUID;v_service_date DATE;v_timezone TEXT;v_row JSONB;
  v_start TIME;v_end TIME;v_type TEXT;v_item_id UUID;v_stay_id UUID;
BEGIN
  SELECT day.agency_id,day.template_version_id,day.service_date,departure.timezone
    INTO v_agency,v_version,v_service_date,v_timezone
  FROM travel.departure_days day
  JOIN travel.departures departure ON departure.id=day.departure_id AND departure.agency_id=day.agency_id
  WHERE day.id=p_day_id AND day.departure_id=p_departure_id FOR UPDATE OF day;
  IF v_agency IS NULL THEN RETURN false; END IF;
  PERFORM app.require_agency_editor_v3(p_actor_user_id,v_agency);
  IF jsonb_typeof(p_items)<>'array' OR jsonb_typeof(p_stays)<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid programme items';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_items) value
    WHERE COALESCE(value->>'id','')!~'^[0-9a-fA-F-]{36}$'
      OR COALESCE(value->>'type','') NOT IN('visit','transport','flight','train','hotel','meal','free_time','meeting','other')
      OR btrim(COALESCE(value->>'title',''))=''
  ) OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_stays) value
    WHERE COALESCE(value->>'id','')!~'^[0-9a-fA-F-]{36}$' OR btrim(COALESCE(value->>'name',''))=''
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid programme payload';
  END IF;

  UPDATE travel.departure_days SET label_override=p_label,title_override=p_title,
    city_override=p_city,description_override=p_description,updated_at=clock_timestamp()
  WHERE id=p_day_id AND agency_id=v_agency AND departure_id=p_departure_id;
  UPDATE travel.departure_itinerary_items SET sort_order=sort_order+100000
  WHERE agency_id=v_agency AND departure_id=p_departure_id AND departure_day_id=p_day_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_item_id:=(v_row->>'id')::uuid;
    v_type:=v_row->>'type';
    v_start:=CASE WHEN v_type IN('transport','flight','train','meal','meeting')
      AND COALESCE(v_row->>'startsAt','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN (v_row->>'startsAt')::time END;
    v_end:=CASE WHEN v_type IN('transport','flight','train','meal','meeting')
      AND COALESCE(v_row->>'endsAt','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN (v_row->>'endsAt')::time END;
    UPDATE travel.departure_itinerary_items SET item_type=v_type,title=v_row->>'title',
      description=COALESCE(v_row->>'description',''),sort_order=(v_row->>'sortOrder')::integer,
      scheduled_start_at=CASE WHEN v_start IS NULL THEN NULL ELSE (v_service_date+v_start) AT TIME ZONE v_timezone END,
      scheduled_end_at=CASE WHEN v_end IS NULL THEN NULL ELSE
        (v_service_date+v_end+CASE WHEN v_start IS NOT NULL AND v_end<v_start THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE v_timezone END,
      operational_status='planned',status_reason='',status_changed_at=NULL,
      metadata=metadata||jsonb_strip_nulls(jsonb_build_object('includedInQuote',v_row->'includedInQuote')),
      updated_at=clock_timestamp()
    WHERE id=v_item_id AND agency_id=v_agency AND departure_id=p_departure_id AND departure_day_id=p_day_id;
    IF NOT FOUND THEN
      INSERT INTO travel.departure_itinerary_items(
        id,agency_id,departure_id,template_version_id,departure_day_id,item_type,title,
        description,notes,sort_order,scheduled_start_at,scheduled_end_at,metadata
      ) VALUES(
        v_item_id,v_agency,p_departure_id,v_version,p_day_id,v_type,v_row->>'title',
        COALESCE(v_row->>'description',''),'',(v_row->>'sortOrder')::integer,
        CASE WHEN v_start IS NULL THEN NULL ELSE (v_service_date+v_start) AT TIME ZONE v_timezone END,
        CASE WHEN v_end IS NULL THEN NULL ELSE
          (v_service_date+v_end+CASE WHEN v_start IS NOT NULL AND v_end<v_start THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE v_timezone END,
        jsonb_strip_nulls(jsonb_build_object('includedInQuote',v_row->'includedInQuote'))
      );
    END IF;
  END LOOP;
  UPDATE travel.departure_itinerary_items SET operational_status='cancelled',
    status_reason='Rimosso dal programma dall''agenzia',status_changed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND departure_id=p_departure_id AND departure_day_id=p_day_id
    AND operational_status<>'cancelled'
    AND NOT(id=ANY(COALESCE(ARRAY(SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_items)),ARRAY[]::uuid[])));

  UPDATE travel.departure_accommodation_stays SET sort_order=sort_order+100000
  WHERE agency_id=v_agency AND departure_id=p_departure_id AND departure_day_id=p_day_id;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_stays) LOOP
    v_stay_id:=(v_row->>'id')::uuid;
    UPDATE travel.departure_accommodation_stays SET name_snapshot=v_row->>'name',
      notes=COALESCE(v_row->>'notes',''),sort_order=(v_row->>'sortOrder')::integer,
      operational_status='planned',updated_at=clock_timestamp()
    WHERE id=v_stay_id AND agency_id=v_agency AND departure_id=p_departure_id AND departure_day_id=p_day_id;
    IF NOT FOUND THEN
      INSERT INTO travel.departure_accommodation_stays(
        id,agency_id,departure_id,template_version_id,departure_day_id,name_snapshot,notes,sort_order,metadata
      ) VALUES(v_stay_id,v_agency,p_departure_id,v_version,p_day_id,v_row->>'name',
        COALESCE(v_row->>'notes',''),(v_row->>'sortOrder')::integer,'{}'::jsonb);
    END IF;
  END LOOP;
  UPDATE travel.departure_accommodation_stays SET operational_status='cancelled',updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND departure_id=p_departure_id AND departure_day_id=p_day_id
    AND operational_status<>'cancelled'
    AND NOT(id=ANY(COALESCE(ARRAY(SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_stays)),ARRAY[]::uuid[])));

  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,p_actor_user_id,'departure_day',p_day_id::text,'updated',jsonb_build_object(
    'departureId',p_departure_id,'items',jsonb_array_length(p_items),'stays',jsonb_array_length(p_stays)));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.update_departure_programme_day_v3(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_departure_programme_day_v3(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('207_v3_native_programme_day_update') ON CONFLICT(version) DO NOTHING;
