CREATE TABLE IF NOT EXISTS ref.country_profile_agency_reviews (
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE CASCADE,
  country_id UUID NOT NULL REFERENCES ref.countries(id) ON DELETE CASCADE,
  profile_version INTEGER NOT NULL CHECK(profile_version > 0),
  status VARCHAR(20) NOT NULL CHECK(status IN ('approved','rejected')),
  reviewed_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(agency_id,country_id,profile_version)
);
CREATE INDEX IF NOT EXISTS country_profile_agency_reviews_country_idx
  ON ref.country_profile_agency_reviews(country_id,profile_version,status,agency_id);

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
    AND EXISTS(SELECT 1 FROM ref.country_profile_agency_reviews review
      WHERE review.agency_id=p_agency_id AND review.country_id=candidate.country_id
        AND review.profile_version=candidate.version AND review.status='approved')
    AND EXISTS(SELECT 1 FROM ops.platform_jobs job WHERE job.id=p_job_id
      AND job.agency_id=p_agency_id AND job.job_type='travel-reference.enrich'
      AND job.status='processing');
END
$$;

DROP FUNCTION IF EXISTS app.review_country_profile_v3(TEXT,UUID,BOOLEAN);
CREATE OR REPLACE FUNCTION app.review_country_profile_v3(
  p_actor_legacy TEXT,p_agency_id UUID,p_country_id UUID,p_approve BOOLEAN
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_version INTEGER;
BEGIN
  SELECT actor.id INTO v_actor FROM ops.legacy_id_map map
  JOIN iam.users actor ON actor.id=map.target_id
  JOIN iam.agency_memberships membership ON membership.user_id=actor.id
    AND membership.agency_id=p_agency_id AND membership.status='active' AND membership.role='owner'
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
    AND actor.status='active' AND actor.platform_role<>'superadmin';
  IF v_actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile review reserved to agency owner';END IF;
  IF NOT EXISTS(SELECT 1 FROM travel.template_countries link
    WHERE link.agency_id=p_agency_id AND link.country_id=p_country_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile outside agency scope';
  END IF;
  SELECT candidate.version INTO v_version FROM ref.country_verified_profiles candidate
    WHERE candidate.country_id=p_country_id FOR UPDATE;
  IF v_version IS NULL THEN RETURN FALSE;END IF;
  INSERT INTO ref.country_profile_agency_reviews(agency_id,country_id,profile_version,status,reviewed_by)
  VALUES(p_agency_id,p_country_id,v_version,CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,v_actor)
  ON CONFLICT(agency_id,country_id,profile_version) DO UPDATE SET
    status=EXCLUDED.status,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=clock_timestamp();
  IF p_approve THEN
    UPDATE ref.country_verified_profiles SET status='verified',verified_at=clock_timestamp(),
      verified_by=v_actor,updated_at=clock_timestamp() WHERE country_id=p_country_id;
  END IF;
  RETURN TRUE;
END $$;

DROP FUNCTION IF EXISTS app.read_country_profiles_for_review_v3(TEXT);
CREATE FUNCTION app.read_country_profiles_for_review_v3(p_actor_legacy TEXT)
RETURNS TABLE(agency_id UUID,country_id UUID,country_name TEXT,iso2 TEXT,status TEXT,version INTEGER,
  profile JSONB,sources JSONB,validation_errors JSONB,grounded_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,reviewed_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,travel,ops SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.status='active' AND membership.role='owner'
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
      AND actor.status='active' AND actor.platform_role<>'superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile review reserved to agency owner';
  END IF;
  RETURN QUERY
  SELECT DISTINCT membership.agency_id,candidate.country_id,country.name::TEXT,country.iso_code::TEXT,
    CASE WHEN candidate.status='stale' THEN 'stale'
      ELSE COALESCE(review.status,'review_required') END::TEXT,candidate.version,candidate.profile,
    candidate.sources,candidate.validation_errors,candidate.grounded_at,candidate.refresh_after,
    review.reviewed_at
  FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
  JOIN iam.agency_memberships membership ON membership.user_id=actor.id
    AND membership.status='active' AND membership.role='owner'
  JOIN travel.template_countries link ON link.agency_id=membership.agency_id
  JOIN ref.country_verified_profiles candidate ON candidate.country_id=link.country_id
  JOIN ref.countries country ON country.id=candidate.country_id
  LEFT JOIN ref.country_profile_agency_reviews review ON review.agency_id=membership.agency_id
    AND review.country_id=candidate.country_id AND review.profile_version=candidate.version
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
    AND actor.status='active' AND actor.platform_role<>'superadmin'
  ORDER BY 1,5,3;
END $$;

REVOKE ALL ON ref.country_profile_agency_reviews FROM PUBLIC;
REVOKE ALL ON FUNCTION app.review_country_profile_v3(TEXT,UUID,UUID,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.review_country_profile_v3(TEXT,UUID,UUID,BOOLEAN) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('128_v3_agency_country_profile_review') ON CONFLICT(version) DO NOTHING;
