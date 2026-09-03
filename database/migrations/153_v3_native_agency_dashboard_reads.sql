CREATE OR REPLACE FUNCTION app.read_agency_recent_imports_v3(p_actor_user_id UUID)
RETURNS TABLE(id UUID,agency_id UUID,template_id UUID,trip_title TEXT,file_name TEXT,
  status TEXT,created_at TIMESTAMPTZ,error_message TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT import_job.id,import_job.agency_id,import_job.template_id,template.title,
    media.original_name,import_job.status::text,import_job.created_at,import_job.error_message
  FROM ops.import_jobs import_job
  JOIN iam.users actor ON actor.id=p_actor_user_id AND actor.status='active'
  JOIN iam.agency_memberships membership ON membership.agency_id=import_job.agency_id
    AND membership.user_id=actor.id AND membership.status='active'
    AND membership.role IN('owner','admin','editor')
  JOIN travel.trip_templates template ON template.id=import_job.template_id
    AND template.agency_id=import_job.agency_id
  JOIN ops.travel_documents document ON document.id=import_job.source_document_id
    AND document.agency_id=import_job.agency_id
  JOIN ops.media_assets media ON media.id=document.media_asset_id AND media.agency_id=import_job.agency_id
  ORDER BY import_job.created_at DESC LIMIT 12
$$;

CREATE OR REPLACE FUNCTION app.read_agency_reference_contents_v3(p_actor_user_id UUID)
RETURNS TABLE(template_id UUID,entity_type TEXT,entity_id UUID,content_type TEXT,status TEXT,content JSONB)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ref,ops SET row_security=off AS $$
  WITH accessible_templates AS (
    SELECT template.id,template.agency_id
    FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.status='active' AND membership.role IN('owner','admin','editor')
    JOIN travel.trip_templates template ON template.agency_id=membership.agency_id
    WHERE actor.id=p_actor_user_id AND actor.status='active'
  ), latest_versions AS (
    SELECT DISTINCT ON(version.template_id) version.id,version.template_id,version.agency_id
    FROM travel.trip_template_versions version
    JOIN accessible_templates template ON template.id=version.template_id AND template.agency_id=version.agency_id
    ORDER BY version.template_id,version.version_number DESC
  ), entities AS (
    SELECT template.id template_id,'country'::text entity_type,country.country_id entity_id
    FROM accessible_templates template
    JOIN travel.template_countries country ON country.agency_id=template.agency_id AND country.template_id=template.id
    UNION
    SELECT version.template_id,'city',city.city_id
    FROM latest_versions version JOIN travel.template_days day
      ON day.agency_id=version.agency_id AND day.template_version_id=version.id
    JOIN travel.template_day_cities city ON city.agency_id=day.agency_id
      AND city.template_version_id=day.template_version_id AND city.template_day_id=day.id
    UNION
    SELECT version.template_id,'site',site.visit_site_id
    FROM latest_versions version JOIN travel.template_days day
      ON day.agency_id=version.agency_id AND day.template_version_id=version.id
    JOIN travel.template_day_sites site ON site.agency_id=day.agency_id
      AND site.template_version_id=day.template_version_id AND site.template_day_id=day.id
  )
  SELECT entity.template_id,entity.entity_type,entity.entity_id,reference.content_type::text,
    CASE WHEN reference.status='approved' THEN 'ready' ELSE reference.status::text END,reference.content
  FROM entities entity
  LEFT JOIN ref.reference_contents reference ON
    (entity.entity_type='country' AND reference.country_id=entity.entity_id) OR
    (entity.entity_type='city' AND reference.city_id=entity.entity_id) OR
    (entity.entity_type='site' AND reference.visit_site_id=entity.entity_id)
  WHERE reference.id IS NULL OR (reference.locale='it-IT' AND reference.status<>'retired')
$$;

CREATE OR REPLACE FUNCTION app.read_agency_enrichment_jobs_v3(p_actor_user_id UUID)
RETURNS TABLE(template_id UUID,status TEXT,error_message TEXT,updated_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
  WITH resolved AS (
    SELECT COALESCE(NULLIF(job.payload->>'templateId','')::uuid,import_job.template_id) template_id,
      job.status::text,job.error_message,job.updated_at,job.created_at
    FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.status='active' AND membership.role IN('owner','admin','editor')
    JOIN ops.platform_jobs job ON job.agency_id=membership.agency_id AND job.job_type='travel-reference.enrich'
    LEFT JOIN ops.import_jobs import_job ON import_job.id=job.import_job_id AND import_job.agency_id=job.agency_id
    WHERE actor.id=p_actor_user_id AND actor.status='active'
  )
  SELECT DISTINCT ON(resolved.template_id) resolved.template_id,resolved.status,
    resolved.error_message,resolved.updated_at FROM resolved
  WHERE resolved.template_id IS NOT NULL ORDER BY resolved.template_id,resolved.created_at DESC
$$;

REVOKE ALL ON FUNCTION app.read_agency_recent_imports_v3(TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.read_agency_reference_contents_v3(TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.read_agency_enrichment_jobs_v3(TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.read_agency_recent_imports_v3(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agency_reference_contents_v3(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agency_enrichment_jobs_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_recent_imports_v3(UUID),
  app.read_agency_reference_contents_v3(UUID),app.read_agency_enrichment_jobs_v3(UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('153_v3_native_agency_dashboard_reads') ON CONFLICT(version) DO NOTHING;
