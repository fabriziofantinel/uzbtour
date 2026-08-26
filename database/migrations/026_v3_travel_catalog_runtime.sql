-- Blocco 9: prodotto viaggio versionato, partenze e programma materializzato.

CREATE OR REPLACE FUNCTION app.sync_legacy_trip_template(p_agency UUID,p_template UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ref,travel,ops SET row_security=off AS $$
DECLARE t public.trip_templates%ROWTYPE; v_user UUID;
BEGIN
 SELECT * INTO t FROM public.trip_templates WHERE agency_id=p_agency AND id=p_template;
 IF NOT FOUND THEN
   DELETE FROM travel.departures WHERE agency_id=p_agency AND template_id=p_template;
   DELETE FROM travel.trip_templates WHERE agency_id=p_agency AND id=p_template;
   RETURN;
 END IF;
 SELECT target_id INTO v_user FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=t.created_by_user_id;
 INSERT INTO travel.trip_templates(id,agency_id,slug,title,primary_country_id,description,status,
  default_locale,default_timezone,created_by_user_id,created_at,updated_at)
 VALUES(t.id,t.agency_id,t.slug,t.title,t.primary_country_id,t.description,t.status,
  t.default_locale,t.default_timezone,v_user,t.created_at,t.updated_at)
 ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,
  primary_country_id=EXCLUDED.primary_country_id,description=EXCLUDED.description,
  status=EXCLUDED.status,default_locale=EXCLUDED.default_locale,
  default_timezone=EXCLUDED.default_timezone,created_by_user_id=EXCLUDED.created_by_user_id,
  updated_at=EXCLUDED.updated_at;
 DELETE FROM travel.template_countries WHERE agency_id=p_agency AND template_id=p_template;
 INSERT INTO travel.template_countries(agency_id,template_id,country_id,sort_order)
 SELECT tpl.agency_id,tpl.id,x.country_id,
  row_number() OVER(ORDER BY x.priority,x.country_id)::smallint-1
 FROM public.trip_templates tpl
 CROSS JOIN LATERAL (
  SELECT tpl.primary_country_id country_id,0 priority WHERE tpl.primary_country_id IS NOT NULL
  UNION SELECT c.country_id,1 FROM public.trip_countries c WHERE c.template_id=tpl.id
 ) x WHERE tpl.agency_id=p_agency AND tpl.id=p_template
 GROUP BY tpl.agency_id,tpl.id,x.country_id,x.priority;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_trip_version(p_agency UUID,p_version UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,travel,ops SET row_security=off AS $$
DECLARE v public.trip_template_versions%ROWTYPE; v_user UUID; v_existing TEXT;
BEGIN
 SELECT * INTO v FROM public.trip_template_versions WHERE agency_id=p_agency AND id=p_version;
 IF NOT FOUND THEN DELETE FROM travel.trip_template_versions WHERE agency_id=p_agency AND id=p_version; RETURN; END IF;
 PERFORM app.sync_legacy_trip_template(v.agency_id,v.template_id);
 SELECT target_id INTO v_user FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=v.created_by_user_id;
 SELECT status INTO v_existing FROM travel.trip_template_versions WHERE id=v.id;
 IF v_existing IS NULL THEN
  INSERT INTO travel.trip_template_versions(id,agency_id,template_id,version_number,status,revision_note,
    published_at,published_by_user_id,created_by_user_id,created_at)
  VALUES(v.id,v.agency_id,v.template_id,v.version_number,
    CASE WHEN v.status='published' THEN 'draft' ELSE v.status END,v.revision_note,
    CASE WHEN v.status='published' THEN NULL ELSE v.published_at END,NULL,v_user,v.created_at);
 END IF;
 IF COALESCE(v_existing,'draft')='draft' THEN
  DELETE FROM travel.template_day_cities WHERE template_version_id=v.id;
  DELETE FROM travel.template_day_sites WHERE template_version_id=v.id;
  DELETE FROM travel.template_day_hotels WHERE template_version_id=v.id;
  DELETE FROM travel.template_itinerary_items WHERE template_version_id=v.id;
  DELETE FROM travel.template_days WHERE template_version_id=v.id;
  INSERT INTO travel.template_days(id,agency_id,template_version_id,day_number,day_offset,title,description,metadata)
  SELECT d.id,d.agency_id,d.template_version_id,d.day_number,d.day_offset,d.title,d.description,
    d.metadata||jsonb_strip_nulls(jsonb_build_object('legacyLabel',NULLIF(d.label,''),'legacyCity',NULLIF(d.city,''),'sourceDate',d.source_date))
  FROM public.trip_days d WHERE d.agency_id=p_agency AND d.template_version_id=v.id ORDER BY d.day_number;
  INSERT INTO travel.template_day_cities(agency_id,template_version_id,template_day_id,city_id,sort_order)
  SELECT d.agency_id,d.template_version_id,x.trip_day_id,x.city_id,
    row_number() OVER(PARTITION BY x.trip_day_id ORDER BY x.sort_order,x.city_id)::smallint-1
  FROM public.trip_day_cities x JOIN public.trip_days d ON d.id=x.trip_day_id WHERE d.template_version_id=v.id;
  INSERT INTO travel.template_day_sites(agency_id,template_version_id,template_day_id,visit_site_id,sort_order)
  SELECT d.agency_id,d.template_version_id,x.trip_day_id,x.site_id,
    row_number() OVER(PARTITION BY x.trip_day_id ORDER BY x.sort_order,x.site_id)::smallint-1
  FROM public.trip_day_sites x JOIN public.trip_days d ON d.id=x.trip_day_id WHERE d.template_version_id=v.id;
  INSERT INTO travel.template_day_hotels(agency_id,template_version_id,template_day_id,hotel_id,sort_order)
  SELECT d.agency_id,d.template_version_id,x.trip_day_id,x.hotel_id,
    row_number() OVER(PARTITION BY x.trip_day_id ORDER BY x.sort_order,x.hotel_id)::smallint-1
  FROM public.trip_day_hotels x JOIN public.trip_days d ON d.id=x.trip_day_id WHERE d.template_version_id=v.id;
  INSERT INTO travel.template_itinerary_items(id,agency_id,template_version_id,template_day_id,visit_site_id,hotel_id,
    item_type,title,description,notes,sort_order,scheduled_start_local,scheduled_end_local,source_page,extraction_confidence,metadata)
  SELECT i.id,i.agency_id,d.template_version_id,i.trip_day_id,NULL::uuid,NULL::uuid,i.item_type,i.title,i.description,
    COALESCE(NULLIF(i.metadata->>'notes',''),NULLIF(i.metadata->>'note',''),''),i.sort_order,
    CASE WHEN i.item_type IN('transport','flight','train') THEN i.starts_at END,
    CASE WHEN i.item_type IN('transport','flight','train') THEN i.ends_at END,
    i.source_page,i.extraction_confidence,i.metadata
  FROM public.itinerary_items i JOIN public.trip_days d ON d.id=i.trip_day_id
  WHERE d.template_version_id=v.id ORDER BY d.day_number,i.sort_order,i.id;
 END IF;
 UPDATE travel.trip_template_versions SET version_number=v.version_number,status=v.status,
  revision_note=v.revision_note,published_at=v.published_at,
  published_by_user_id=CASE WHEN v.status IN('published','archived') THEN v_user END,
  created_by_user_id=v_user WHERE id=v.id;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_departure(p_agency UUID,p_departure UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,travel,ops SET row_security=off AS $$
DECLARE d public.departures%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.departures WHERE agency_id=p_agency AND id=p_departure;
 IF NOT FOUND THEN DELETE FROM travel.departures WHERE agency_id=p_agency AND id=p_departure; RETURN; END IF;
 PERFORM app.sync_legacy_trip_version(d.agency_id,d.template_version_id);
 INSERT INTO travel.departures(id,agency_id,template_id,template_version_id,code,title,starts_on,ends_on,
  timezone,default_locale,status,settings,published_at,created_at,updated_at)
 SELECT d.id,d.agency_id,d.template_id,d.template_version_id,d.code,d.title,d.starts_on,d.ends_on,d.timezone,
  t.default_locale,d.status,d.settings,d.published_at,d.created_at,d.updated_at
 FROM public.trip_templates t WHERE t.id=d.template_id
 ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,title=EXCLUDED.title,starts_on=EXCLUDED.starts_on,
  ends_on=EXCLUDED.ends_on,timezone=EXCLUDED.timezone,default_locale=EXCLUDED.default_locale,
  status=EXCLUDED.status,settings=EXCLUDED.settings,published_at=EXCLUDED.published_at,updated_at=EXCLUDED.updated_at;
 INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,agency_id)
 SELECT 'public-v2','departure_day',d.id::text||':'||td.id::text,d.agency_id
 FROM public.trip_days td WHERE td.template_version_id=d.template_version_id
 ON CONFLICT(source_system,entity_type,legacy_id) DO NOTHING;
 INSERT INTO travel.departure_days(id,agency_id,departure_id,template_version_id,template_day_id,service_date)
 SELECT m.target_id,d.agency_id,d.id,d.template_version_id,td.id,d.starts_on+td.day_offset
 FROM public.trip_days td JOIN ops.legacy_id_map m ON m.source_system='public-v2'
  AND m.entity_type='departure_day' AND m.legacy_id=d.id::text||':'||td.id::text
 WHERE td.template_version_id=d.template_version_id
 ON CONFLICT(id) DO UPDATE SET service_date=EXCLUDED.service_date;
 INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,agency_id)
 SELECT 'public-v2','departure_item',d.id::text||':'||i.id::text,d.agency_id
 FROM public.itinerary_items i JOIN public.trip_days td ON td.id=i.trip_day_id
 WHERE td.template_version_id=d.template_version_id
 ON CONFLICT(source_system,entity_type,legacy_id) DO NOTHING;
 INSERT INTO travel.departure_itinerary_items(id,agency_id,departure_id,template_version_id,departure_day_id,
  source_template_item_id,visit_site_id,hotel_id,item_type,title,description,notes,sort_order,
  scheduled_start_at,scheduled_end_at,metadata,created_at,updated_at)
 SELECT mi.target_id,d.agency_id,d.id,d.template_version_id,dd.id,i.id,NULL::uuid,NULL::uuid,
  i.item_type,i.title,i.description,COALESCE(NULLIF(i.metadata->>'notes',''),NULLIF(i.metadata->>'note',''),''),i.sort_order,
  CASE WHEN i.item_type IN('transport','flight','train') THEN COALESCE(i.scheduled_start_at,CASE WHEN i.starts_at IS NOT NULL THEN (dd.service_date+i.starts_at) AT TIME ZONE d.timezone END) END,
  CASE WHEN i.item_type IN('transport','flight','train') THEN COALESCE(i.scheduled_end_at,CASE WHEN i.ends_at IS NOT NULL THEN (dd.service_date+i.ends_at+CASE WHEN i.starts_at IS NOT NULL AND i.ends_at<i.starts_at THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE d.timezone END) END,
  i.metadata,d.created_at,d.updated_at
 FROM public.itinerary_items i JOIN public.trip_days td ON td.id=i.trip_day_id
 JOIN travel.departure_days dd ON dd.departure_id=d.id AND dd.template_day_id=td.id
 JOIN ops.legacy_id_map mi ON mi.source_system='public-v2' AND mi.entity_type='departure_item' AND mi.legacy_id=d.id::text||':'||i.id::text
 WHERE td.template_version_id=d.template_version_id
 ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,notes=EXCLUDED.notes,
  visit_site_id=EXCLUDED.visit_site_id,hotel_id=EXCLUDED.hotel_id,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_travel_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,public AS $$
DECLARE r RECORD; v_agency UUID; v_template UUID; v_version UUID; v_departure UUID;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_TABLE_NAME='trip_templates' THEN PERFORM app.sync_legacy_trip_template(r.agency_id,r.id);
 ELSIF TG_TABLE_NAME='trip_template_versions' THEN PERFORM app.sync_legacy_trip_version(r.agency_id,r.id);
 ELSIF TG_TABLE_NAME='trip_countries' THEN PERFORM app.sync_legacy_trip_template(r.agency_id,r.template_id);
 ELSIF TG_TABLE_NAME='departures' THEN PERFORM app.sync_legacy_departure(r.agency_id,r.id);
 ELSE
  IF TG_TABLE_NAME='trip_days' THEN v_version:=r.template_version_id; v_agency:=r.agency_id;
  ELSE SELECT d.template_version_id,d.agency_id INTO v_version,v_agency FROM public.trip_days d WHERE d.id=r.trip_day_id; END IF;
  IF v_version IS NOT NULL THEN
    PERFORM app.sync_legacy_trip_version(v_agency,v_version);
    FOR v_departure IN SELECT id FROM public.departures WHERE agency_id=v_agency AND template_version_id=v_version
    LOOP PERFORM app.sync_legacy_departure(v_agency,v_departure); END LOOP;
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['trip_templates','trip_template_versions','trip_countries','trip_days','trip_day_cities','trip_day_sites','trip_day_hotels','itinerary_items','departures'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS sync_v3_travel_row ON public.%I',t);
  EXECUTE format('CREATE TRIGGER sync_v3_travel_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_travel_row()',t);
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION app.sync_legacy_trip_template(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_trip_version(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_departure(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_travel_row() FROM PUBLIC;
GRANT USAGE ON SCHEMA travel TO smf_app;
GRANT SELECT ON travel.trip_templates,travel.trip_template_versions,travel.template_countries,
 travel.template_days,travel.template_day_cities,travel.template_day_sites,travel.template_day_hotels,
 travel.template_itinerary_items,travel.departures,travel.departure_days,travel.departure_itinerary_items TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('026_v3_travel_catalog_runtime') ON CONFLICT(version) DO NOTHING;
