CREATE OR REPLACE FUNCTION app.read_agency_overview_v3(p_actor_user_id UUID)
RETURNS TABLE(
  agency_id UUID,agency_slug TEXT,agency_name TEXT,agency_status TEXT,agency_role TEXT,
  template_id UUID,template_title TEXT,template_status TEXT,destination_country TEXT,
  template_starts_on TEXT,template_ends_on TEXT,departure_id UUID,departure_code TEXT,
  departure_title TEXT,starts_on TEXT,ends_on TEXT,departure_status TEXT,
  party_count BIGINT,traveler_names TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ref,ops SET row_security=off AS $$
  WITH accessible_agencies AS (
    SELECT membership.agency_id,membership.role
    FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
    WHERE actor.id=p_actor_user_id AND actor.status='active'
      AND membership.status='active' AND membership.role IN('owner','admin','editor')
  ), latest_import AS (
    SELECT DISTINCT ON(import_job.agency_id,import_job.template_id)
      import_job.agency_id,import_job.template_id,import_job.result
    FROM ops.import_jobs import_job
    JOIN accessible_agencies access ON access.agency_id=import_job.agency_id
    WHERE import_job.result IS NOT NULL AND import_job.status IN('ready_for_review','published')
    ORDER BY import_job.agency_id,import_job.template_id,import_job.created_at DESC
  ), template_dates AS (
    SELECT departure.agency_id,departure.template_id,min(departure.starts_on) starts_on,
      max(departure.ends_on) ends_on
    FROM travel.departures departure
    JOIN accessible_agencies access ON access.agency_id=departure.agency_id
    GROUP BY departure.agency_id,departure.template_id
  ), departure_summary AS (
    SELECT departure.agency_id,departure.id,departure.template_id,departure.code,
      departure.title,departure.starts_on,departure.ends_on,departure.status,
      count(DISTINCT party.id) party_count,
      string_agg(DISTINCT profile.display_name,'|' ORDER BY profile.display_name) traveler_names
    FROM travel.departures departure
    JOIN accessible_agencies access ON access.agency_id=departure.agency_id
    LEFT JOIN travel.travel_parties party ON party.agency_id=departure.agency_id
      AND party.departure_id=departure.id
    LEFT JOIN travel.party_memberships party_member ON party_member.agency_id=departure.agency_id
      AND party_member.departure_id=departure.id AND party_member.party_id=party.id
      AND party_member.status<>'removed'
    LEFT JOIN travel.traveler_profiles profile ON profile.agency_id=departure.agency_id
      AND profile.id=party_member.traveler_id
    GROUP BY departure.agency_id,departure.id,departure.template_id,departure.code,
      departure.title,departure.starts_on,departure.ends_on,departure.status
  )
  SELECT agency.id,agency.slug::text,agency.name::text,agency.status::text,access.role::text,
    template.id,template.title::text,template.status::text,country.name,
    COALESCE(NULLIF(latest.result->>'startDate',''),dates.starts_on::text),
    COALESCE(NULLIF(latest.result->>'endDate',''),dates.ends_on::text),
    departure.id,departure.code::text,departure.title::text,departure.starts_on::text,
    departure.ends_on::text,departure.status::text,COALESCE(departure.party_count,0),
    departure.traveler_names
  FROM accessible_agencies access
  JOIN iam.agencies agency ON agency.id=access.agency_id
  LEFT JOIN travel.trip_templates template ON template.agency_id=agency.id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  LEFT JOIN latest_import latest ON latest.agency_id=template.agency_id AND latest.template_id=template.id
  LEFT JOIN template_dates dates ON dates.agency_id=template.agency_id AND dates.template_id=template.id
  LEFT JOIN departure_summary departure ON departure.agency_id=template.agency_id
    AND departure.template_id=template.id
  ORDER BY agency.name,template.title NULLS LAST,departure.starts_on DESC NULLS LAST
$$;

REVOKE ALL ON FUNCTION app.read_agency_overview_v3(TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.read_agency_overview_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_overview_v3(UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('152_v3_native_agency_overview') ON CONFLICT(version) DO NOTHING;
