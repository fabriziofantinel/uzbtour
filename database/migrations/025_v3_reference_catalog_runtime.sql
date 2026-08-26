-- Blocco 8: catalogo condiviso e contenuti di riferimento.

CREATE OR REPLACE FUNCTION app.sync_legacy_country()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,public SET row_security=off AS $$
DECLARE r public.countries%ROWTYPE; v_iso TEXT;
BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM ref.countries WHERE id=OLD.id; RETURN OLD; END IF;
 r:=NEW; v_iso:=COALESCE(NULLIF(upper(r.iso_code),''),CASE r.normalized_name WHEN 'uzbekistan' THEN 'UZ' WHEN 'vietnam' THEN 'VN' END);
 IF v_iso IS NULL THEN RAISE EXCEPTION 'ISO country code required for %',r.name; END IF;
 INSERT INTO ref.countries(id,iso_code,name,normalized_name,google_url,default_timezone,last_verified_at,refresh_after,created_at,updated_at)
 VALUES(r.id,v_iso,r.name,r.normalized_name,r.google_url,NULL,r.last_verified_at,r.content_refresh_after,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET iso_code=EXCLUDED.iso_code,name=EXCLUDED.name,
  normalized_name=EXCLUDED.normalized_name,google_url=EXCLUDED.google_url,
  last_verified_at=EXCLUDED.last_verified_at,refresh_after=EXCLUDED.refresh_after,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_city()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,public SET row_security=off AS $$
DECLARE r public.cities%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM ref.cities WHERE id=OLD.id; RETURN OLD; END IF; r:=NEW;
 INSERT INTO ref.cities(id,country_id,name,normalized_name,google_url,location,timezone,last_verified_at,refresh_after,created_at,updated_at)
 VALUES(r.id,r.country_id,r.name,r.normalized_name,r.google_url,
  CASE WHEN r.latitude IS NOT NULL AND r.longitude IS NOT NULL THEN ST_SetSRID(ST_MakePoint(r.longitude,r.latitude),4326)::geography END,
  NULL,r.last_verified_at,r.content_refresh_after,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET country_id=EXCLUDED.country_id,name=EXCLUDED.name,
  normalized_name=EXCLUDED.normalized_name,google_url=EXCLUDED.google_url,location=EXCLUDED.location,
  last_verified_at=EXCLUDED.last_verified_at,refresh_after=EXCLUDED.refresh_after,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_visit_site()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,public SET row_security=off AS $$
DECLARE r public.visit_sites%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM ref.visit_sites WHERE id=OLD.id; RETURN OLD; END IF; r:=NEW;
 INSERT INTO ref.visit_sites(id,city_id,name,normalized_name,google_url,official_url,location,last_verified_at,refresh_after,created_at,updated_at)
 VALUES(r.id,r.city_id,r.name,r.normalized_name,r.google_url,r.official_url,
  CASE WHEN r.latitude IS NOT NULL AND r.longitude IS NOT NULL THEN ST_SetSRID(ST_MakePoint(r.longitude,r.latitude),4326)::geography END,
  r.last_verified_at,r.content_refresh_after,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET city_id=EXCLUDED.city_id,name=EXCLUDED.name,
  normalized_name=EXCLUDED.normalized_name,google_url=EXCLUDED.google_url,
  official_url=EXCLUDED.official_url,location=EXCLUDED.location,
  last_verified_at=EXCLUDED.last_verified_at,refresh_after=EXCLUDED.refresh_after,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_hotel()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,public SET row_security=off AS $$
DECLARE r public.hotels%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM ref.hotels WHERE id=OLD.id; RETURN OLD; END IF; r:=NEW;
 INSERT INTO ref.hotels(id,city_id,name,normalized_name,google_url,website_url,location,last_verified_at,created_at,updated_at)
 VALUES(r.id,r.city_id,r.name,r.normalized_name,r.google_url,r.website_url,
  CASE WHEN r.latitude IS NOT NULL AND r.longitude IS NOT NULL THEN ST_SetSRID(ST_MakePoint(r.longitude,r.latitude),4326)::geography END,
  r.last_verified_at,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET city_id=EXCLUDED.city_id,name=EXCLUDED.name,
  normalized_name=EXCLUDED.normalized_name,google_url=EXCLUDED.google_url,
  website_url=EXCLUDED.website_url,location=EXCLUDED.location,
  last_verified_at=EXCLUDED.last_verified_at,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_reference_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,public SET row_security=off AS $$
DECLARE r public.reference_contents%ROWTYPE; v_status TEXT; v_approved TIMESTAMPTZ;
BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM ref.reference_contents WHERE id=OLD.id; RETURN OLD; END IF; r:=NEW;
 IF r.entity_type NOT IN('country','city','site') THEN RETURN NEW; END IF;
 v_status:=CASE r.status WHEN 'ready' THEN 'approved' WHEN 'pending' THEN 'draft' WHEN 'failed' THEN 'failed' ELSE 'retired' END;
 v_approved:=CASE WHEN v_status='approved' THEN COALESCE(r.refreshed_at,r.updated_at,r.created_at) END;
 INSERT INTO ref.reference_contents(id,country_id,city_id,visit_site_id,content_type,locale,content,status,
  generation_model,generated_at,approved_at,refresh_after,error_message,created_at,updated_at)
 VALUES(r.id,CASE WHEN r.entity_type='country' THEN r.entity_id END,
  CASE WHEN r.entity_type='city' THEN r.entity_id END,CASE WHEN r.entity_type='site' THEN r.entity_id END,
  r.content_type,r.locale,r.content,v_status,r.model,r.refreshed_at,v_approved,r.refresh_after,r.error_message,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET country_id=EXCLUDED.country_id,city_id=EXCLUDED.city_id,
  visit_site_id=EXCLUDED.visit_site_id,content_type=EXCLUDED.content_type,locale=EXCLUDED.locale,
  content=EXCLUDED.content,status=EXCLUDED.status,generation_model=EXCLUDED.generation_model,
  generated_at=EXCLUDED.generated_at,approved_at=EXCLUDED.approved_at,
  refresh_after=EXCLUDED.refresh_after,error_message=EXCLUDED.error_message,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_v3_country ON public.countries;
CREATE TRIGGER sync_v3_country AFTER INSERT OR UPDATE OR DELETE ON public.countries FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_country();
DROP TRIGGER IF EXISTS sync_v3_city ON public.cities;
CREATE TRIGGER sync_v3_city AFTER INSERT OR UPDATE OR DELETE ON public.cities FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_city();
DROP TRIGGER IF EXISTS sync_v3_visit_site ON public.visit_sites;
CREATE TRIGGER sync_v3_visit_site AFTER INSERT OR UPDATE OR DELETE ON public.visit_sites FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_visit_site();
DROP TRIGGER IF EXISTS sync_v3_hotel ON public.hotels;
CREATE TRIGGER sync_v3_hotel AFTER INSERT OR UPDATE OR DELETE ON public.hotels FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_hotel();
DROP TRIGGER IF EXISTS sync_v3_reference_content ON public.reference_contents;
CREATE TRIGGER sync_v3_reference_content AFTER INSERT OR UPDATE OR DELETE ON public.reference_contents FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_reference_content();

REVOKE ALL ON FUNCTION app.sync_legacy_country() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_city() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_visit_site() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_hotel() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_reference_content() FROM PUBLIC;
GRANT USAGE ON SCHEMA ref TO smf_app;
GRANT SELECT ON ref.countries,ref.cities,ref.visit_sites,ref.hotels,ref.reference_contents TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('025_v3_reference_catalog_runtime') ON CONFLICT(version) DO NOTHING;
