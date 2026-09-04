CREATE OR REPLACE FUNCTION app.update_departure_programme_day_staff_v3(p_actor UUID,p_departure UUID,p_day UUID,p_label TEXT,p_title TEXT,p_city TEXT,p_description TEXT,p_items JSONB,p_stays JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,travel,ops AS $$
DECLARE a UUID;v UUID;d DATE;z TEXT;r JSONB;i UUID;s UUID;t TEXT;
BEGIN
 IF NOT app.can_edit_departure_day_v3(p_actor,p_departure,p_day) OR jsonb_typeof(p_items)<>'array' OR jsonb_typeof(p_stays)<>'array' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='day programme edit not authorized'; END IF;
 SELECT day.agency_id,day.template_version_id,day.service_date,departure.timezone INTO a,v,d,z FROM travel.departure_days day JOIN travel.departures departure ON departure.id=day.departure_id WHERE day.id=p_day AND day.departure_id=p_departure FOR UPDATE;
 UPDATE travel.departure_days SET label_override=p_label,title_override=p_title,city_override=p_city,description_override=p_description,updated_at=clock_timestamp() WHERE id=p_day;
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  i:=(r->>'id')::uuid;t:=r->>'type';
  UPDATE travel.departure_itinerary_items SET item_type=t,title=r->>'title',description=COALESCE(r->>'description',''),sort_order=COALESCE((r->>'sortOrder')::int,0),updated_at=clock_timestamp() WHERE id=i AND agency_id=a AND departure_id=p_departure AND departure_day_id=p_day;
  IF NOT FOUND THEN INSERT INTO travel.departure_itinerary_items(id,agency_id,departure_id,template_version_id,departure_day_id,item_type,title,description,notes,sort_order,metadata) VALUES(i,a,p_departure,v,p_day,t,r->>'title',COALESCE(r->>'description',''),'',COALESCE((r->>'sortOrder')::int,0),'{}'); END IF;
 END LOOP;
 UPDATE travel.departure_itinerary_items SET operational_status='cancelled',status_reason='Rimosso dal programma',status_changed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE agency_id=a AND departure_id=p_departure AND departure_day_id=p_day AND operational_status<>'cancelled' AND NOT id=ANY(COALESCE(ARRAY(SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_items)),ARRAY[]::uuid[]));
 FOR r IN SELECT value FROM jsonb_array_elements(p_stays) LOOP
  s:=(r->>'id')::uuid; UPDATE travel.departure_accommodation_stays SET name_snapshot=r->>'name',notes=COALESCE(r->>'notes',''),sort_order=COALESCE((r->>'sortOrder')::int,0),updated_at=clock_timestamp() WHERE id=s AND agency_id=a AND departure_id=p_departure AND departure_day_id=p_day;
  IF NOT FOUND THEN INSERT INTO travel.departure_accommodation_stays(id,agency_id,departure_id,template_version_id,departure_day_id,name_snapshot,notes,sort_order,metadata) VALUES(s,a,p_departure,v,p_day,r->>'name',COALESCE(r->>'notes',''),COALESCE((r->>'sortOrder')::int,0),'{}'); END IF;
 END LOOP;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes) VALUES(a,p_actor,'departure_day',p_day::text,'staff_updated',jsonb_build_object('departureId',p_departure)); RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.update_departure_programme_day_staff_v3(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_departure_programme_day_staff_v3(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('180_v3_staff_programme_day_write') ON CONFLICT(version) DO NOTHING;
