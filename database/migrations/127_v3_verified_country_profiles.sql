CREATE TABLE IF NOT EXISTS ref.country_verified_profiles (
  country_id UUID PRIMARY KEY REFERENCES ref.countries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  status VARCHAR(20) NOT NULL CHECK(status IN ('review_required','verified','stale','rejected')),
  profile JSONB NOT NULL CHECK(jsonb_typeof(profile)='object'),
  sources JSONB NOT NULL CHECK(jsonb_typeof(sources)='array'),
  validation_errors JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(validation_errors)='array'),
  generation_model TEXT NOT NULL,
  grounding_model TEXT NOT NULL,
  grounded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  refresh_after TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK((status='verified' AND verified_at IS NOT NULL) OR status<>'verified')
);
CREATE INDEX IF NOT EXISTS country_verified_profiles_refresh_idx
  ON ref.country_verified_profiles(status,refresh_after);

CREATE TABLE IF NOT EXISTS ref.country_verified_profile_revisions (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  country_id UUID NOT NULL REFERENCES ref.countries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  profile JSONB NOT NULL,
  sources JSONB NOT NULL,
  validation_errors JSONB NOT NULL,
  generation_model TEXT NOT NULL,
  grounding_model TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(country_id,version)
);

CREATE OR REPLACE FUNCTION app.read_verified_country_profile_v3(
  p_job_id UUID,p_agency_id UUID,p_country_id UUID
) RETURNS TABLE(profile JSONB,refresh_after TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,ops SET row_security=off AS $$
BEGIN
  UPDATE ref.country_verified_profiles candidate SET status='stale',updated_at=clock_timestamp()
  WHERE candidate.country_id=p_country_id AND candidate.status='verified'
    AND candidate.refresh_after<=clock_timestamp();
  RETURN QUERY SELECT candidate.profile,candidate.refresh_after
  FROM ref.country_verified_profiles candidate
  WHERE candidate.country_id=p_country_id AND candidate.status='verified'
    AND candidate.refresh_after>clock_timestamp()
    AND EXISTS(SELECT 1 FROM ops.platform_jobs job WHERE job.id=p_job_id
      AND job.agency_id=p_agency_id AND job.job_type='travel-reference.enrich'
      AND job.status='processing');
END
$$;

CREATE OR REPLACE FUNCTION app.save_country_profile_candidate_v3(
  p_job_id UUID,p_agency_id UUID,p_country_id UUID,p_profile JSONB,p_sources JSONB,
  p_errors JSONB,p_generation_model TEXT,p_grounding_model TEXT,p_refresh_after TIMESTAMPTZ
) RETURNS TABLE(status TEXT,version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,ops SET row_security=off AS $$
DECLARE v_status TEXT;v_version INTEGER;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.platform_jobs job WHERE job.id=p_job_id
    AND job.agency_id=p_agency_id AND job.job_type='travel-reference.enrich'
    AND job.status='processing') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reference enrichment job not active';
  END IF;
  IF jsonb_typeof(p_profile)<>'object' OR jsonb_typeof(p_sources)<>'array'
    OR jsonb_typeof(p_errors)<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid country profile candidate';
  END IF;
  v_status:=CASE WHEN jsonb_array_length(p_errors)=0 THEN 'verified' ELSE 'review_required' END;
  SELECT COALESCE(current.version,0)+1 INTO v_version FROM ref.country_verified_profiles current
    WHERE current.country_id=p_country_id FOR UPDATE;
  v_version:=COALESCE(v_version,1);
  INSERT INTO ref.country_verified_profile_revisions(country_id,version,status,profile,sources,
    validation_errors,generation_model,grounding_model)
  VALUES(p_country_id,v_version,v_status,p_profile,p_sources,p_errors,p_generation_model,p_grounding_model);
  INSERT INTO ref.country_verified_profiles(country_id,version,status,profile,sources,validation_errors,
    generation_model,grounding_model,verified_at,refresh_after)
  VALUES(p_country_id,v_version,v_status,p_profile,p_sources,p_errors,p_generation_model,p_grounding_model,
    CASE WHEN v_status='verified' THEN clock_timestamp() END,p_refresh_after)
  ON CONFLICT(country_id) DO UPDATE SET version=EXCLUDED.version,status=EXCLUDED.status,
    profile=EXCLUDED.profile,sources=EXCLUDED.sources,validation_errors=EXCLUDED.validation_errors,
    generation_model=EXCLUDED.generation_model,grounding_model=EXCLUDED.grounding_model,
    grounded_at=clock_timestamp(),verified_at=EXCLUDED.verified_at,verified_by=NULL,
    refresh_after=EXCLUDED.refresh_after,updated_at=clock_timestamp();
  RETURN QUERY SELECT v_status,v_version;
END $$;

CREATE OR REPLACE FUNCTION app.review_country_profile_v3(
  p_actor_legacy TEXT,p_country_id UUID,p_approve BOOLEAN
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,ops SET row_security=off AS $$
DECLARE v_actor UUID;
BEGIN
  SELECT actor.id INTO v_actor FROM ops.legacy_id_map map
  JOIN iam.users actor ON actor.id=map.target_id
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
    AND actor.status='active' AND actor.platform_role='superadmin';
  IF v_actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile review not authorized';END IF;
  UPDATE ref.country_verified_profiles SET status=CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END,
    verified_at=CASE WHEN p_approve THEN clock_timestamp() END,verified_by=v_actor,updated_at=clock_timestamp()
  WHERE country_id=p_country_id;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.read_country_profiles_for_review_v3(p_actor_legacy TEXT)
RETURNS TABLE(country_id UUID,country_name TEXT,iso2 TEXT,status TEXT,version INTEGER,
  profile JSONB,sources JSONB,validation_errors JSONB,grounded_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,ops SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
      AND actor.status='active' AND actor.platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile review not authorized';
  END IF;
  RETURN QUERY SELECT candidate.country_id,country.name::TEXT,country.iso2::TEXT,candidate.status::TEXT,
    candidate.version,candidate.profile,candidate.sources,candidate.validation_errors,
    candidate.grounded_at,candidate.refresh_after
  FROM ref.country_verified_profiles candidate JOIN ref.countries country ON country.id=candidate.country_id
  ORDER BY CASE candidate.status WHEN 'review_required' THEN 0 WHEN 'stale' THEN 1 ELSE 2 END,
    country.name;
END $$;

REVOKE ALL ON ref.country_verified_profiles,ref.country_verified_profile_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_verified_country_profile_v3(UUID,UUID,UUID),
  app.save_country_profile_candidate_v3(UUID,UUID,UUID,JSONB,JSONB,JSONB,TEXT,TEXT,TIMESTAMPTZ),
  app.review_country_profile_v3(TEXT,UUID,BOOLEAN),app.read_country_profiles_for_review_v3(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_verified_country_profile_v3(UUID,UUID,UUID),
  app.save_country_profile_candidate_v3(UUID,UUID,UUID,JSONB,JSONB,JSONB,TEXT,TEXT,TIMESTAMPTZ),
  app.review_country_profile_v3(TEXT,UUID,BOOLEAN),app.read_country_profiles_for_review_v3(TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('127_v3_verified_country_profiles') ON CONFLICT(version) DO NOTHING;
