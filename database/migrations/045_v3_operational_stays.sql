-- Pernottamenti tipizzati e override operativi della singola partenza.

ALTER TABLE travel.departure_days
  ADD COLUMN IF NOT EXISTS label_override TEXT,
  ADD COLUMN IF NOT EXISTS title_override TEXT,
  ADD COLUMN IF NOT EXISTS city_override TEXT,
  ADD COLUMN IF NOT EXISTS description_override TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS travel.template_accommodation_stays(
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  template_day_id UUID NOT NULL,
  hotel_id UUID REFERENCES ref.hotels(id) ON DELETE RESTRICT,
  name_snapshot TEXT NOT NULL CHECK(btrim(name_snapshot)<>''),
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order>=0),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(agency_id,template_version_id,template_day_id)
    REFERENCES travel.template_days(agency_id,template_version_id,id) ON DELETE CASCADE,
  UNIQUE(agency_id,template_version_id,id),
  UNIQUE(template_day_id,sort_order)
);
CREATE INDEX IF NOT EXISTS template_stays_tenant_idx ON travel.template_accommodation_stays
  (agency_id,template_version_id,template_day_id,sort_order,id);

CREATE TABLE IF NOT EXISTS travel.departure_accommodation_stays(
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  source_template_stay_id UUID,
  hotel_id UUID REFERENCES ref.hotels(id) ON DELETE RESTRICT,
  name_snapshot TEXT NOT NULL CHECK(btrim(name_snapshot)<>''),
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order>=0),
  operational_status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK(operational_status IN('planned','confirmed','cancelled','completed')),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(agency_id,departure_id,template_version_id,departure_day_id)
    REFERENCES travel.departure_days(agency_id,departure_id,template_version_id,id) ON DELETE CASCADE,
  FOREIGN KEY(agency_id,template_version_id,source_template_stay_id)
    REFERENCES travel.template_accommodation_stays(agency_id,template_version_id,id)
    ON DELETE SET NULL(source_template_stay_id),
  UNIQUE(agency_id,departure_id,id),
  UNIQUE(departure_day_id,sort_order)
);
CREATE INDEX IF NOT EXISTS departure_stays_tenant_idx ON travel.departure_accommodation_stays
  (agency_id,departure_id,departure_day_id,operational_status,sort_order,id);

ALTER TABLE travel.template_accommodation_stays ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel.departure_accommodation_stays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON travel.template_accommodation_stays;
CREATE POLICY tenant_isolation ON travel.template_accommodation_stays
  USING(agency_id=app.current_agency_id()) WITH CHECK(agency_id=app.current_agency_id());
DROP POLICY IF EXISTS tenant_isolation ON travel.departure_accommodation_stays;
CREATE POLICY tenant_isolation ON travel.departure_accommodation_stays
  USING(agency_id=app.current_agency_id()) WITH CHECK(agency_id=app.current_agency_id());

INSERT INTO travel.template_accommodation_stays(
  id,agency_id,template_version_id,template_day_id,hotel_id,name_snapshot,notes,
  sort_order,metadata,created_at,updated_at)
SELECT accommodation.id,accommodation.agency_id,day.template_version_id,day.id,
  hotel_link.hotel_id,accommodation.name,accommodation.notes,accommodation.sort_order,
  accommodation.metadata,clock_timestamp(),clock_timestamp()
FROM public.accommodations accommodation
JOIN public.trip_days day ON day.id=accommodation.trip_day_id
  AND day.agency_id=accommodation.agency_id
LEFT JOIN LATERAL(
  SELECT link.hotel_id FROM public.trip_day_hotels link
  WHERE link.trip_day_id=day.id ORDER BY link.hotel_id LIMIT 1
) hotel_link ON true
ON CONFLICT(id) DO UPDATE SET hotel_id=EXCLUDED.hotel_id,name_snapshot=EXCLUDED.name_snapshot,
  notes=EXCLUDED.notes,sort_order=EXCLUDED.sort_order,metadata=EXCLUDED.metadata,
  updated_at=EXCLUDED.updated_at;

INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,agency_id)
SELECT 'public-v2','departure_stay',departure.id::text||':'||stay.id::text,departure.agency_id
FROM travel.departures departure
JOIN travel.template_accommodation_stays stay
  ON stay.agency_id=departure.agency_id
 AND stay.template_version_id=departure.template_version_id
ON CONFLICT(source_system,entity_type,legacy_id) DO NOTHING;

INSERT INTO travel.departure_accommodation_stays(
  id,agency_id,departure_id,template_version_id,departure_day_id,source_template_stay_id,
  hotel_id,name_snapshot,notes,sort_order,metadata,created_at,updated_at)
SELECT map.target_id,departure.agency_id,departure.id,departure.template_version_id,
  departure_day.id,stay.id,stay.hotel_id,stay.name_snapshot,stay.notes,stay.sort_order,
  stay.metadata,departure.created_at,departure.updated_at
FROM travel.departures departure
JOIN travel.template_accommodation_stays stay
  ON stay.agency_id=departure.agency_id AND stay.template_version_id=departure.template_version_id
JOIN travel.departure_days departure_day
  ON departure_day.agency_id=departure.agency_id AND departure_day.departure_id=departure.id
 AND departure_day.template_day_id=stay.template_day_id
JOIN ops.legacy_id_map map ON map.source_system='public-v2' AND map.entity_type='departure_stay'
 AND map.legacy_id=departure.id::text||':'||stay.id::text
ON CONFLICT(id) DO UPDATE SET hotel_id=EXCLUDED.hotel_id,name_snapshot=EXCLUDED.name_snapshot,
  notes=EXCLUDED.notes,sort_order=EXCLUDED.sort_order,metadata=EXCLUDED.metadata,
  updated_at=EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION app.sync_legacy_accommodation_stay()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,travel,ops,public SET row_security=off AS $$
DECLARE r public.accommodations%ROWTYPE;v_version UUID;v_hotel UUID;v_departure RECORD;v_stay UUID;
BEGIN
  PERFORM set_config('app.legacy_sync','on',true);
  r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  SELECT template_version_id INTO v_version FROM public.trip_days WHERE id=r.trip_day_id;
  IF TG_OP='DELETE' THEN
    DELETE FROM travel.template_accommodation_stays WHERE id=r.id;
    RETURN OLD;
  END IF;
  SELECT hotel_id INTO v_hotel FROM public.trip_day_hotels
  WHERE trip_day_id=r.trip_day_id ORDER BY hotel_id LIMIT 1;
  INSERT INTO travel.template_accommodation_stays(id,agency_id,template_version_id,template_day_id,
    hotel_id,name_snapshot,notes,sort_order,metadata,created_at,updated_at)
  VALUES(r.id,r.agency_id,v_version,r.trip_day_id,v_hotel,r.name,r.notes,r.sort_order,
    r.metadata,clock_timestamp(),clock_timestamp())
  ON CONFLICT(id) DO UPDATE SET hotel_id=EXCLUDED.hotel_id,name_snapshot=EXCLUDED.name_snapshot,
    notes=EXCLUDED.notes,sort_order=EXCLUDED.sort_order,metadata=EXCLUDED.metadata,
    updated_at=EXCLUDED.updated_at;
  FOR v_departure IN SELECT id,agency_id,template_version_id,created_at,updated_at
    FROM travel.departures WHERE agency_id=r.agency_id AND template_version_id=v_version
  LOOP
    INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,agency_id)
    VALUES('public-v2','departure_stay',v_departure.id::text||':'||r.id::text,r.agency_id)
    ON CONFLICT(source_system,entity_type,legacy_id) DO NOTHING RETURNING target_id INTO v_stay;
    IF v_stay IS NULL THEN SELECT target_id INTO v_stay FROM ops.legacy_id_map
      WHERE source_system='public-v2' AND entity_type='departure_stay'
        AND legacy_id=v_departure.id::text||':'||r.id::text; END IF;
    INSERT INTO travel.departure_accommodation_stays(id,agency_id,departure_id,template_version_id,
      departure_day_id,source_template_stay_id,hotel_id,name_snapshot,notes,sort_order,metadata,
      created_at,updated_at)
    SELECT v_stay,r.agency_id,v_departure.id,v_version,day.id,r.id,v_hotel,r.name,r.notes,
      r.sort_order,r.metadata,v_departure.created_at,v_departure.updated_at
    FROM travel.departure_days day WHERE day.departure_id=v_departure.id
      AND day.template_day_id=r.trip_day_id
    ON CONFLICT(id) DO UPDATE SET hotel_id=EXCLUDED.hotel_id,name_snapshot=EXCLUDED.name_snapshot,
      notes=EXCLUDED.notes,sort_order=EXCLUDED.sort_order,metadata=EXCLUDED.metadata,
      updated_at=EXCLUDED.updated_at;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_v3_accommodation_stay ON public.accommodations;
CREATE TRIGGER sync_v3_accommodation_stay AFTER INSERT OR UPDATE OR DELETE ON public.accommodations
FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_accommodation_stay();
DROP TRIGGER IF EXISTS guard_template_version_mutation ON travel.template_accommodation_stays;
CREATE TRIGGER guard_template_version_mutation
BEFORE INSERT OR UPDATE OR DELETE ON travel.template_accommodation_stays
FOR EACH ROW EXECUTE FUNCTION app.assert_template_version_mutable();

REVOKE ALL ON FUNCTION app.sync_legacy_accommodation_stay() FROM PUBLIC;
GRANT SELECT ON travel.template_accommodation_stays,travel.departure_accommodation_stays TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('045_v3_operational_stays') ON CONFLICT(version) DO NOTHING;
