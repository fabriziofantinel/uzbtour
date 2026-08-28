-- Consente di ricostruire una proiezione programma assente anche se la partenza
-- ha già gruppi. Una proiezione esistente resta protetta da rimaterializzazioni.
CREATE OR REPLACE FUNCTION app.materialize_departure_programme_v3(p_departure_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,travel SET row_security=off AS $$
DECLARE v_departure travel.departures%ROWTYPE;v_day RECORD;v_departure_day UUID;
BEGIN
  SELECT * INTO v_departure FROM travel.departures WHERE id=p_departure_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='departure not found'; END IF;
  IF EXISTS(SELECT 1 FROM travel.travel_parties WHERE departure_id=p_departure_id)
     AND EXISTS(SELECT 1 FROM travel.departure_days WHERE departure_id=p_departure_id) THEN
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

REVOKE ALL ON FUNCTION app.materialize_departure_programme_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.materialize_departure_programme_v3(UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('088_v3_departure_programme_recovery') ON CONFLICT(version) DO NOTHING;
