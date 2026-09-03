CREATE OR REPLACE FUNCTION app.create_trip_template_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_template_id UUID,p_version_id UUID,
  p_slug TEXT,p_title TEXT,p_timezone TEXT
)
RETURNS TABLE(id UUID,agency_id UUID,slug TEXT,title TEXT,status TEXT,default_timezone TEXT,version_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
BEGIN
  PERFORM app.require_agency_editor_v3(p_actor_user_id,p_agency_id);
  IF NULLIF(btrim(p_slug),'') IS NULL OR NULLIF(btrim(p_title),'') IS NULL
    OR NULLIF(btrim(p_timezone),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid trip template';
  END IF;
  INSERT INTO travel.trip_templates(id,agency_id,slug,title,status,default_locale,default_timezone,created_by_user_id)
  VALUES(p_template_id,p_agency_id,btrim(p_slug),btrim(p_title),'draft','it-IT',btrim(p_timezone),p_actor_user_id);
  INSERT INTO travel.trip_template_versions(id,agency_id,template_id,version_number,status,revision_note,created_by_user_id)
  VALUES(p_version_id,p_agency_id,p_template_id,1,'draft','Versione iniziale in attesa del programma di viaggio.',p_actor_user_id);
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,p_actor_user_id,'trip_template',p_template_id::text,'created',
    jsonb_build_object('title',btrim(p_title),'source','travel-v3'));
  RETURN QUERY SELECT template.id,template.agency_id,template.slug::text,template.title::text,
    template.status::text,template.default_timezone,p_version_id
  FROM travel.trip_templates template WHERE template.id=p_template_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_departure_from_programme_v3(
  p_actor_user_id UUID,p_template_id UUID,p_departure_id UUID,p_code TEXT,
  p_title TEXT,p_starts_on DATE,p_ends_on DATE
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel SET row_security=off AS $$
DECLARE v_agency UUID;v_version UUID;v_timezone TEXT;
BEGIN
  SELECT template.agency_id,version.id,template.default_timezone INTO v_agency,v_version,v_timezone
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
  PERFORM app.require_agency_editor_v3(p_actor_user_id,v_agency);
  INSERT INTO travel.departures(id,agency_id,template_id,template_version_id,code,title,
    starts_on,ends_on,timezone,status,published_at)
  VALUES(p_departure_id,v_agency,p_template_id,v_version,p_code,p_title,p_starts_on,p_ends_on,
    v_timezone,'confirmed',clock_timestamp());
  PERFORM app.materialize_departure_programme_v3(p_departure_id);
  RETURN p_departure_id;
END $$;

REVOKE ALL ON FUNCTION app.create_trip_template_v3(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT),
  app.create_departure_from_programme_v3(TEXT,UUID,UUID,TEXT,TEXT,DATE,DATE) FROM smf_app;
REVOKE ALL ON FUNCTION app.create_trip_template_v3(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT),
  app.create_departure_from_programme_v3(UUID,UUID,UUID,TEXT,TEXT,DATE,DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_trip_template_v3(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT),
  app.create_departure_from_programme_v3(UUID,UUID,UUID,TEXT,TEXT,DATE,DATE) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('163_v3_native_trip_departure_creation') ON CONFLICT(version) DO NOTHING;
