-- CRUD del prodotto viaggio e catalogo globale direttamente sui domini V3.

CREATE OR REPLACE FUNCTION app.create_trip_template_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_template_id UUID,p_version_id UUID,
  p_slug TEXT,p_title TEXT,p_timezone TEXT
)
RETURNS TABLE(id UUID,agency_id UUID,slug TEXT,title TEXT,status TEXT,
  default_timezone TEXT,version_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF NULLIF(btrim(p_slug),'') IS NULL OR NULLIF(btrim(p_title),'') IS NULL
     OR NULLIF(btrim(p_timezone),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid trip template';
  END IF;
  INSERT INTO travel.trip_templates(id,agency_id,slug,title,status,default_locale,
    default_timezone,created_by_user_id)
  VALUES(p_template_id,p_agency_id,btrim(p_slug),btrim(p_title),'draft','it-IT',
    btrim(p_timezone),v_actor);
  INSERT INTO travel.trip_template_versions(id,agency_id,template_id,version_number,
    status,revision_note,created_by_user_id)
  VALUES(p_version_id,p_agency_id,p_template_id,1,'draft',
    'Versione iniziale in attesa del programma di viaggio.',v_actor);
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'trip_template',p_template_id::text,'created',
    jsonb_build_object('title',btrim(p_title),'source','travel-v3'));
  RETURN QUERY SELECT template.id,template.agency_id,template.slug::text,template.title::text,
    template.status::text,template.default_timezone,p_version_id
  FROM travel.trip_templates template WHERE template.id=p_template_id;
END $$;

CREATE OR REPLACE FUNCTION app.read_trip_deletion_assets_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_template_id UUID
)
RETURNS TABLE(id UUID,provider TEXT,bucket TEXT,object_key TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
BEGIN
  PERFORM app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF NOT EXISTS(SELECT 1 FROM travel.trip_templates
    WHERE id=p_template_id AND agency_id=p_agency_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='trip template not found';
  END IF;
  RETURN QUERY
  SELECT DISTINCT asset.id,asset.provider::text,asset.bucket,asset.object_key
  FROM ops.media_assets asset
  LEFT JOIN ops.travel_documents document ON document.media_asset_id=asset.id
    AND document.agency_id=asset.agency_id
  WHERE asset.agency_id=p_agency_id AND (
    document.template_id=p_template_id OR asset.departure_id IN(
      SELECT departure.id FROM travel.departures departure
      WHERE departure.agency_id=p_agency_id AND departure.template_id=p_template_id));
END $$;

CREATE OR REPLACE FUNCTION app.delete_trip_template_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_template_id UUID,p_media_asset_ids UUID[]
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,content,journey,privacy,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_title TEXT;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  SELECT title INTO v_title FROM travel.trip_templates
  WHERE id=p_template_id AND agency_id=p_agency_id FOR UPDATE;
  IF v_title IS NULL THEN RETURN false; END IF;
  DELETE FROM ops.platform_jobs job WHERE job.agency_id=p_agency_id AND (
    job.import_job_id IN(SELECT id FROM ops.import_jobs
      WHERE agency_id=p_agency_id AND template_id=p_template_id)
    OR job.payload->>'templateId'=p_template_id::text);
  DELETE FROM ops.generation_runs run WHERE run.agency_id=p_agency_id
    AND run.import_job_id IN(SELECT id FROM ops.import_jobs
      WHERE agency_id=p_agency_id AND template_id=p_template_id);
  DELETE FROM ops.import_jobs WHERE agency_id=p_agency_id AND template_id=p_template_id;
  DELETE FROM ops.travel_documents WHERE agency_id=p_agency_id AND template_id=p_template_id;
  DELETE FROM travel.departures WHERE agency_id=p_agency_id AND template_id=p_template_id;
  DELETE FROM travel.trip_templates WHERE agency_id=p_agency_id AND id=p_template_id;
  DELETE FROM ops.media_assets WHERE agency_id=p_agency_id
    AND id=ANY(COALESCE(p_media_asset_ids,ARRAY[]::uuid[]));
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'trip_template',p_template_id::text,'deleted',
    jsonb_build_object('title',v_title,'deletedAssets',cardinality(COALESCE(p_media_asset_ids,ARRAY[]::uuid[])),'source','travel-v3'));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.upsert_reference_catalog_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_entity_type TEXT,p_parent_id UUID,
  p_iso_code TEXT,p_name TEXT,p_normalized_name TEXT,p_google_url TEXT,
  p_latitude DOUBLE PRECISION DEFAULT NULL,p_longitude DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE(id UUID,name TEXT,latitude DOUBLE PRECISION,longitude DOUBLE PRECISION)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,ref SET row_security=off AS $$
DECLARE v_id UUID;
BEGIN
  PERFORM app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF NULLIF(btrim(p_name),'') IS NULL OR NULLIF(btrim(p_normalized_name),'') IS NULL
     OR NULLIF(btrim(p_google_url),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid reference entity';
  END IF;
  IF p_entity_type='country' THEN
    IF upper(COALESCE(p_iso_code,'')) !~ '^[A-Z]{2}$' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ISO 3166-1 alpha-2 country code required';
    END IF;
    SELECT country.id INTO v_id FROM ref.countries country
    WHERE country.normalized_name=btrim(p_normalized_name) OR country.iso_code=upper(p_iso_code)
    ORDER BY (country.normalized_name=btrim(p_normalized_name)) DESC LIMIT 1 FOR UPDATE;
    IF v_id IS NULL THEN
      INSERT INTO ref.countries(iso_code,name,normalized_name,google_url)
      VALUES(upper(p_iso_code),btrim(p_name),btrim(p_normalized_name),p_google_url)
      RETURNING ref.countries.id INTO v_id;
    ELSE
      UPDATE ref.countries SET name=btrim(p_name),normalized_name=btrim(p_normalized_name),
        google_url=p_google_url,updated_at=clock_timestamp() WHERE ref.countries.id=v_id;
    END IF;
  ELSIF p_entity_type='city' THEN
    INSERT INTO ref.cities(country_id,name,normalized_name,google_url,location)
    VALUES(p_parent_id,btrim(p_name),btrim(p_normalized_name),p_google_url,
      CASE WHEN p_latitude BETWEEN -90 AND 90 AND p_longitude BETWEEN -180 AND 180
        THEN public.ST_SetSRID(public.ST_MakePoint(p_longitude,p_latitude),4326)::public.geography END)
    ON CONFLICT(country_id,normalized_name) DO UPDATE SET name=EXCLUDED.name,
      google_url=EXCLUDED.google_url,location=COALESCE(ref.cities.location,EXCLUDED.location),
      updated_at=clock_timestamp() RETURNING ref.cities.id INTO v_id;
  ELSIF p_entity_type='site' THEN
    INSERT INTO ref.visit_sites(city_id,name,normalized_name,google_url)
    VALUES(p_parent_id,btrim(p_name),btrim(p_normalized_name),p_google_url)
    ON CONFLICT(city_id,normalized_name) DO UPDATE SET name=EXCLUDED.name,
      google_url=EXCLUDED.google_url,updated_at=clock_timestamp()
    RETURNING ref.visit_sites.id INTO v_id;
  ELSIF p_entity_type='hotel' THEN
    INSERT INTO ref.hotels(city_id,name,normalized_name,google_url)
    VALUES(p_parent_id,btrim(p_name),btrim(p_normalized_name),p_google_url)
    ON CONFLICT(city_id,normalized_name) DO UPDATE SET name=EXCLUDED.name,
      google_url=EXCLUDED.google_url,updated_at=clock_timestamp()
    RETURNING ref.hotels.id INTO v_id;
  ELSE
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported reference entity';
  END IF;
  RETURN QUERY
  SELECT v_id,catalog.name,
    CASE WHEN p_entity_type='city' THEN public.ST_Y(city.location::public.geometry) END,
    CASE WHEN p_entity_type='city' THEN public.ST_X(city.location::public.geometry) END
  FROM (SELECT CASE p_entity_type WHEN 'country' THEN (SELECT c.name FROM ref.countries c WHERE c.id=v_id)
              WHEN 'city' THEN (SELECT c.name FROM ref.cities c WHERE c.id=v_id)
              WHEN 'site' THEN (SELECT s.name FROM ref.visit_sites s WHERE s.id=v_id)
              ELSE (SELECT h.name FROM ref.hotels h WHERE h.id=v_id) END name) catalog
  LEFT JOIN ref.cities city ON p_entity_type='city' AND city.id=v_id;
END $$;

CREATE OR REPLACE FUNCTION app.reference_content_needs_refresh_v3(
  p_job_id UUID,p_agency_id UUID,p_entity_type TEXT,p_entity_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ref,ops SET row_security=off AS $$
DECLARE v_expected TEXT[];v_count INTEGER;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.platform_jobs WHERE id=p_job_id AND agency_id=p_agency_id
    AND job_type='travel-reference.enrich' AND status='processing') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reference enrichment job not active';
  END IF;
  v_expected:=CASE WHEN p_entity_type='country' THEN ARRAY['useful_info','phrasebook','bingo']
    ELSE ARRAY['quiz','mission','game','photo_contest'] END;
  SELECT count(DISTINCT content_type) INTO v_count FROM ref.reference_contents
  WHERE ((p_entity_type='country' AND country_id=p_entity_id) OR
         (p_entity_type='city' AND city_id=p_entity_id) OR
         (p_entity_type='site' AND visit_site_id=p_entity_id))
    AND content_type=ANY(v_expected) AND locale='it-IT' AND status='approved'
    AND COALESCE(refresh_after,generated_at+interval '180 days')>clock_timestamp();
  RETURN v_count<cardinality(v_expected);
END $$;

CREATE OR REPLACE FUNCTION app.save_reference_content_v3(
  p_job_id UUID,p_agency_id UUID,p_entity_type TEXT,p_entity_id UUID,
  p_content_type TEXT,p_content JSONB,p_model TEXT,p_refresh_after TIMESTAMPTZ
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,ops SET row_security=off AS $$
DECLARE v_id UUID;v_now TIMESTAMPTZ:=clock_timestamp();
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.platform_jobs WHERE id=p_job_id AND agency_id=p_agency_id
    AND job_type='travel-reference.enrich' AND status='processing') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reference enrichment job not active';
  END IF;
  IF jsonb_typeof(p_content) NOT IN('array','object') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid reference content';
  END IF;
  SELECT content.id INTO v_id FROM ref.reference_contents content
  WHERE ((p_entity_type='country' AND content.country_id=p_entity_id) OR
         (p_entity_type='city' AND content.city_id=p_entity_id) OR
         (p_entity_type='site' AND content.visit_site_id=p_entity_id))
    AND content.content_type=p_content_type AND content.locale='it-IT' AND content.status<>'retired'
  FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO ref.reference_contents(country_id,city_id,visit_site_id,content_type,locale,
      content,status,generation_model,generated_at,approved_at,refresh_after)
    VALUES(CASE WHEN p_entity_type='country' THEN p_entity_id END,
      CASE WHEN p_entity_type='city' THEN p_entity_id END,
      CASE WHEN p_entity_type='site' THEN p_entity_id END,p_content_type,'it-IT',p_content,
      'approved',p_model,v_now,v_now,p_refresh_after) RETURNING id INTO v_id;
  ELSE
    UPDATE ref.reference_contents SET content=p_content,status='approved',generation_model=p_model,
      generated_at=v_now,approved_at=v_now,refresh_after=p_refresh_after,error_message=NULL,
      updated_at=v_now WHERE id=v_id;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.create_trip_template_v3(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_trip_deletion_assets_v3(TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.delete_trip_template_v3(TEXT,UUID,UUID,UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.upsert_reference_catalog_v3(TEXT,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reference_content_needs_refresh_v3(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_reference_content_v3(UUID,UUID,TEXT,UUID,TEXT,JSONB,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_trip_template_v3(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT),
 app.read_trip_deletion_assets_v3(TEXT,UUID,UUID),app.delete_trip_template_v3(TEXT,UUID,UUID,UUID[]),
 app.upsert_reference_catalog_v3(TEXT,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION),
 app.reference_content_needs_refresh_v3(UUID,UUID,TEXT,UUID),
 app.save_reference_content_v3(UUID,UUID,TEXT,UUID,TEXT,JSONB,TEXT,TIMESTAMPTZ) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('047_v3_trip_and_reference_write_cutover') ON CONFLICT(version) DO NOTHING;
