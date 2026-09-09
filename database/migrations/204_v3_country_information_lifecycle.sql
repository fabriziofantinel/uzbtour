-- Country information has one shared AI-generated source profile and one independently
-- approved/editable view per agency. A refreshed shared version invalidates approvals,
-- while preserving each agency's previous override as a draft for the new version.

ALTER TABLE ref.country_profile_agency_reviews
  DROP CONSTRAINT IF EXISTS country_profile_agency_reviews_status_check;
ALTER TABLE ref.country_profile_agency_reviews
  ADD CONSTRAINT country_profile_agency_reviews_status_check
  CHECK(status IN ('review_required','approved','rejected'));

CREATE OR REPLACE FUNCTION app.read_verified_country_profile_v3(
  p_job_id UUID,p_agency_id UUID,p_country_id UUID
) RETURNS TABLE(profile JSONB,refresh_after TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,ops SET row_security=off AS $$
BEGIN
  UPDATE ref.country_verified_profiles candidate
  SET status='stale',updated_at=clock_timestamp()
  WHERE candidate.country_id=p_country_id
    AND candidate.status IN('verified','review_required')
    AND candidate.refresh_after<=clock_timestamp();

  RETURN QUERY
  SELECT candidate.profile,candidate.refresh_after
  FROM ref.country_verified_profiles candidate
  WHERE candidate.country_id=p_country_id
    AND candidate.status IN('verified','review_required')
    AND candidate.refresh_after>clock_timestamp()
    AND EXISTS(
      SELECT 1 FROM ops.platform_jobs job
      WHERE job.id=p_job_id AND job.agency_id=p_agency_id
        AND job.job_type='travel-reference.enrich' AND job.status='processing'
    );
END
$$;

CREATE OR REPLACE FUNCTION app.save_country_profile_candidate_v3(
  p_job_id UUID,p_agency_id UUID,p_country_id UUID,p_profile JSONB,p_sources JSONB,
  p_errors JSONB,p_generation_model TEXT,p_grounding_model TEXT,p_refresh_after TIMESTAMPTZ
) RETURNS TABLE(status TEXT,version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,ops SET row_security=off AS $$
DECLARE
  v_status TEXT;
  v_version INTEGER;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM ops.platform_jobs job
    WHERE job.id=p_job_id AND job.agency_id=p_agency_id
      AND job.job_type='travel-reference.enrich' AND job.status='processing'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reference enrichment job not active';
  END IF;
  IF jsonb_typeof(p_profile)<>'object' OR jsonb_typeof(p_sources)<>'array'
    OR jsonb_typeof(p_errors)<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid country profile candidate';
  END IF;

  v_status:=CASE WHEN jsonb_array_length(p_errors)=0 THEN 'verified' ELSE 'review_required' END;
  SELECT COALESCE(current.version,0)+1 INTO v_version
  FROM ref.country_verified_profiles current
  WHERE current.country_id=p_country_id FOR UPDATE;
  v_version:=COALESCE(v_version,1);

  INSERT INTO ref.country_verified_profile_revisions(
    country_id,version,status,profile,sources,validation_errors,generation_model,grounding_model
  ) VALUES(
    p_country_id,v_version,v_status,p_profile,p_sources,p_errors,p_generation_model,p_grounding_model
  );

  INSERT INTO ref.country_verified_profiles(
    country_id,version,status,profile,sources,validation_errors,generation_model,grounding_model,
    verified_at,refresh_after
  ) VALUES(
    p_country_id,v_version,v_status,p_profile,p_sources,p_errors,p_generation_model,p_grounding_model,
    CASE WHEN v_status='verified' THEN clock_timestamp() END,p_refresh_after
  )
  ON CONFLICT(country_id) DO UPDATE SET
    version=EXCLUDED.version,status=EXCLUDED.status,profile=EXCLUDED.profile,sources=EXCLUDED.sources,
    validation_errors=EXCLUDED.validation_errors,generation_model=EXCLUDED.generation_model,
    grounding_model=EXCLUDED.grounding_model,grounded_at=clock_timestamp(),
    verified_at=EXCLUDED.verified_at,verified_by=NULL,refresh_after=EXCLUDED.refresh_after,
    updated_at=clock_timestamp();

  -- Keep agency-owned corrections, but require an explicit review for the refreshed source version.
  INSERT INTO ref.country_profile_agency_reviews(
    agency_id,country_id,profile_version,status,reviewed_by,reviewed_at,
    profile_override,updated_by,updated_at
  )
  SELECT DISTINCT ON (previous.agency_id)
    previous.agency_id,p_country_id,v_version,'review_required',previous.reviewed_by,
    clock_timestamp(),previous.profile_override,COALESCE(previous.updated_by,previous.reviewed_by),
    clock_timestamp()
  FROM ref.country_profile_agency_reviews previous
  WHERE previous.country_id=p_country_id
    AND previous.profile_version<v_version
    AND previous.profile_override IS NOT NULL
  ORDER BY previous.agency_id,previous.profile_version DESC
  ON CONFLICT(agency_id,country_id,profile_version) DO NOTHING;

  RETURN QUERY SELECT v_status,v_version;
END
$$;

CREATE OR REPLACE FUNCTION app.save_country_profile_override_v3(
  p_actor UUID,p_agency UUID,p_country UUID,p_profile JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ref,travel SET row_security=off AS $$
DECLARE v_version INTEGER;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.agency_id=p_agency AND membership.status='active'
      AND membership.role IN('owner','admin','editor')
    WHERE actor.id=p_actor AND actor.status='active' AND actor.platform_role<>'superadmin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile edit not authorized';
  END IF;
  IF jsonb_typeof(p_profile)<>'object' OR jsonb_typeof(p_profile->'usefulInfo')<>'array'
    OR jsonb_array_length(p_profile->'usefulInfo')=0 OR length(p_profile::text)>100000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid country profile';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM travel.template_countries link
    WHERE link.agency_id=p_agency AND link.country_id=p_country
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile outside agency scope';
  END IF;

  SELECT candidate.version INTO v_version
  FROM ref.country_verified_profiles candidate
  WHERE candidate.country_id=p_country FOR UPDATE;
  IF v_version IS NULL THEN RETURN FALSE; END IF;

  INSERT INTO ref.country_profile_agency_reviews(
    agency_id,country_id,profile_version,status,reviewed_by,reviewed_at,
    profile_override,updated_by,updated_at
  ) VALUES(
    p_agency,p_country,v_version,'approved',p_actor,clock_timestamp(),p_profile,p_actor,clock_timestamp()
  )
  ON CONFLICT(agency_id,country_id,profile_version) DO UPDATE SET
    status='approved',profile_override=EXCLUDED.profile_override,updated_by=EXCLUDED.updated_by,
    updated_at=clock_timestamp(),reviewed_by=EXCLUDED.reviewed_by,reviewed_at=clock_timestamp();
  RETURN TRUE;
END
$$;

CREATE OR REPLACE FUNCTION app.review_country_profile_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_country_id UUID,p_approve BOOLEAN
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ref,travel SET row_security=off AS $$
DECLARE v_version INTEGER;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.agency_id=p_agency_id AND membership.status='active'
      AND membership.role IN('owner','admin','editor')
    WHERE actor.id=p_actor_user_id AND actor.status='active' AND actor.platform_role<>'superadmin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile review reserved to agency';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM travel.template_countries link
    WHERE link.agency_id=p_agency_id AND link.country_id=p_country_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile outside agency scope';
  END IF;

  SELECT candidate.version INTO v_version
  FROM ref.country_verified_profiles candidate
  WHERE candidate.country_id=p_country_id FOR UPDATE;
  IF v_version IS NULL THEN RETURN FALSE; END IF;

  INSERT INTO ref.country_profile_agency_reviews(
    agency_id,country_id,profile_version,status,reviewed_by,reviewed_at,updated_by,updated_at
  ) VALUES(
    p_agency_id,p_country_id,v_version,CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    p_actor_user_id,clock_timestamp(),p_actor_user_id,clock_timestamp()
  )
  ON CONFLICT(agency_id,country_id,profile_version) DO UPDATE SET
    status=EXCLUDED.status,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=clock_timestamp(),
    updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
  RETURN TRUE;
END
$$;

CREATE OR REPLACE FUNCTION app.read_country_profiles_for_review_v3(p_actor_user_id UUID)
RETURNS TABLE(
  agency_id UUID,country_id UUID,country_name TEXT,iso2 TEXT,status TEXT,version INTEGER,
  profile JSONB,base_profile JSONB,sources JSONB,validation_errors JSONB,
  grounded_at TIMESTAMPTZ,refresh_after TIMESTAMPTZ,reviewed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ref,travel SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.status='active' AND membership.role IN('owner','admin','editor')
    WHERE actor.id=p_actor_user_id AND actor.status='active' AND actor.platform_role<>'superadmin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile review reserved to agency';
  END IF;

  RETURN QUERY
  SELECT DISTINCT membership.agency_id,candidate.country_id,country.name::text,country.iso_code::text,
    CASE
      WHEN candidate.status='stale' OR candidate.refresh_after<=clock_timestamp() THEN 'stale'
      ELSE COALESCE(review.status,'review_required')
    END::text,
    candidate.version,COALESCE(review.profile_override,candidate.profile),candidate.profile,
    candidate.sources,candidate.validation_errors,candidate.grounded_at,candidate.refresh_after,
    review.reviewed_at,review.updated_at
  FROM iam.users actor
  JOIN iam.agency_memberships membership ON membership.user_id=actor.id
    AND membership.status='active' AND membership.role IN('owner','admin','editor')
  JOIN travel.template_countries link ON link.agency_id=membership.agency_id
  JOIN ref.country_verified_profiles candidate ON candidate.country_id=link.country_id
  JOIN ref.countries country ON country.id=candidate.country_id
  LEFT JOIN ref.country_profile_agency_reviews review ON review.agency_id=membership.agency_id
    AND review.country_id=candidate.country_id AND review.profile_version=candidate.version
  WHERE actor.id=p_actor_user_id AND actor.status='active' AND actor.platform_role<>'superadmin'
  ORDER BY 1,5,3;
END
$$;

CREATE OR REPLACE FUNCTION app.read_traveler_destination_profile_v3(
  p_actor_user_id UUID,p_departure_id UUID
) RETURNS TABLE(currency_code TEXT,time_zone TEXT,profile_version INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ref,travel SET row_security=off AS $$
  SELECT NULLIF(COALESCE(review.profile_override,candidate.profile)->>'currencyCode',''),
    COALESCE(NULLIF(COALESCE(review.profile_override,candidate.profile)->'timeZones'->>0,''),departure.timezone),
    candidate.version
  FROM travel.traveler_profiles traveler
  JOIN travel.party_memberships membership ON membership.agency_id=traveler.agency_id
    AND membership.traveler_id=traveler.id AND membership.status='active'
  JOIN travel.departures departure ON departure.agency_id=membership.agency_id
    AND departure.id=membership.departure_id AND departure.id=p_departure_id
  JOIN travel.trip_templates template ON template.agency_id=departure.agency_id
    AND template.id=departure.template_id
  JOIN ref.country_verified_profiles candidate ON candidate.country_id=template.primary_country_id
    AND candidate.status IN('verified','review_required') AND candidate.refresh_after>clock_timestamp()
  JOIN ref.country_profile_agency_reviews review ON review.agency_id=departure.agency_id
    AND review.country_id=candidate.country_id AND review.profile_version=candidate.version
    AND review.status='approved'
  WHERE traveler.user_id=p_actor_user_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.read_verified_country_profile_v3(UUID,UUID,UUID),
  app.save_country_profile_candidate_v3(UUID,UUID,UUID,JSONB,JSONB,JSONB,TEXT,TEXT,TIMESTAMPTZ),
  app.save_country_profile_override_v3(UUID,UUID,UUID,JSONB),
  app.review_country_profile_v3(UUID,UUID,UUID,BOOLEAN),
  app.read_country_profiles_for_review_v3(UUID),
  app.read_traveler_destination_profile_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_verified_country_profile_v3(UUID,UUID,UUID),
  app.save_country_profile_candidate_v3(UUID,UUID,UUID,JSONB,JSONB,JSONB,TEXT,TEXT,TIMESTAMPTZ),
  app.save_country_profile_override_v3(UUID,UUID,UUID,JSONB),
  app.review_country_profile_v3(UUID,UUID,UUID,BOOLEAN),
  app.read_country_profiles_for_review_v3(UUID),
  app.read_traveler_destination_profile_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('204_v3_country_information_lifecycle') ON CONFLICT(version) DO NOTHING;
