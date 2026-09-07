-- Agency role parity, invited-user impersonation and agency-owned country content.

ALTER TABLE ref.country_profile_agency_reviews
  ADD COLUMN IF NOT EXISTS profile_override JSONB,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES iam.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS app.read_agency_impersonation_travelers(UUID);
CREATE FUNCTION app.read_agency_impersonation_travelers(p_actor_user_id UUID)
RETURNS TABLE(
  user_id UUID,legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT,user_status TEXT,
  agency_id UUID,agency_name TEXT,departure_titles TEXT[],user_kind TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  WITH actor_agencies AS (
    SELECT membership.agency_id
    FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.status='active' AND membership.role IN('owner','admin','editor')
    JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
    WHERE actor.id=p_actor_user_id AND actor.status='active'
  ), eligible AS (
    SELECT profile.user_id,profile.agency_id,departure.title::text AS departure_title,'traveler'::text AS user_kind
    FROM travel.traveler_profiles profile
    JOIN actor_agencies scope ON scope.agency_id=profile.agency_id
    JOIN travel.party_memberships party_membership ON party_membership.agency_id=profile.agency_id
      AND party_membership.traveler_id=profile.id AND party_membership.status<>'removed'
    JOIN travel.departures departure ON departure.id=party_membership.departure_id
      AND departure.agency_id=profile.agency_id AND departure.status<>'cancelled'
    UNION ALL
    SELECT staff.user_id,staff.agency_id,NULL::text,
      CASE WHEN staff.staff_role='accompagnatore' THEN 'accompagnatore' ELSE 'guida' END
    FROM iam.agency_staff_profiles staff
    JOIN actor_agencies scope ON scope.agency_id=staff.agency_id
    WHERE staff.status='active' AND staff.staff_role IN('accompagnatore','guida')
    UNION ALL
    SELECT assignment.user_id,assignment.agency_id,departure.title::text,
      CASE WHEN assignment.role IN('accompagnatore','tour_leader') THEN 'accompagnatore' ELSE 'guida' END
    FROM travel.departure_staff_assignments assignment
    JOIN actor_agencies scope ON scope.agency_id=assignment.agency_id
    JOIN travel.departures departure ON departure.id=assignment.departure_id
      AND departure.agency_id=assignment.agency_id AND departure.status<>'cancelled'
    WHERE assignment.status='active' AND assignment.role IN('accompagnatore','tour_leader','guida')
  )
  SELECT target.id,target_map.legacy_id::text,target.display_name::text,COALESCE(target.username,'')::text,
    COALESCE(target.email,'')::text,target.status::text,agency.id,agency.name::text,
    COALESCE(array_agg(DISTINCT eligible.departure_title ORDER BY eligible.departure_title)
      FILTER(WHERE eligible.departure_title IS NOT NULL),ARRAY[]::text[]),
    CASE WHEN bool_or(eligible.user_kind='traveler') THEN 'traveler'
      WHEN bool_or(eligible.user_kind='accompagnatore') THEN 'accompagnatore' ELSE 'guida' END
  FROM eligible
  JOIN iam.users target ON target.id=eligible.user_id AND target.status IN('active','invited')
    AND target.platform_role<>'superadmin'
  JOIN iam.agencies agency ON agency.id=eligible.agency_id
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE NOT EXISTS (
    SELECT 1 FROM iam.agency_memberships excluded
    WHERE excluded.user_id=target.id AND excluded.status<>'revoked'
      AND excluded.role IN('owner','admin','editor')
  )
  GROUP BY target.id,target_map.legacy_id,agency.id,agency.name
  ORDER BY target.display_name
$$;

DROP FUNCTION IF EXISTS app.start_agency_traveler_impersonation(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT);
CREATE FUNCTION app.start_agency_traveler_impersonation(
  p_actor_user_id UUID,p_target_user_id UUID,p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,p_user_agent TEXT
)
RETURNS TABLE(target_user_id UUID,target_legacy_user_id TEXT,display_name TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN,target_kind TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
DECLARE v_kind TEXT;
BEGIN
  IF p_actor_user_id=p_target_user_id THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='cannot impersonate self';
  END IF;
  SELECT eligible.user_kind INTO v_kind
  FROM iam.users actor
  JOIN iam.agency_memberships actor_membership ON actor_membership.user_id=actor.id
    AND actor_membership.status='active' AND actor_membership.role IN('owner','admin','editor')
  JOIN iam.agencies agency ON agency.id=actor_membership.agency_id AND agency.status IN('trial','active')
  JOIN LATERAL (
    SELECT 'traveler'::text AS user_kind
    FROM travel.traveler_profiles profile
    JOIN travel.party_memberships party_membership ON party_membership.agency_id=profile.agency_id
      AND party_membership.traveler_id=profile.id AND party_membership.status<>'removed'
    JOIN travel.departures departure ON departure.id=party_membership.departure_id
      AND departure.agency_id=profile.agency_id AND departure.status<>'cancelled'
    WHERE profile.agency_id=agency.id AND profile.user_id=p_target_user_id
    UNION ALL
    SELECT CASE WHEN staff.staff_role='accompagnatore' THEN 'accompagnatore' ELSE 'guida' END
    FROM iam.agency_staff_profiles staff
    WHERE staff.agency_id=agency.id AND staff.user_id=p_target_user_id AND staff.status='active'
      AND staff.staff_role IN('accompagnatore','guida')
    UNION ALL
    SELECT CASE WHEN assignment.role IN('accompagnatore','tour_leader') THEN 'accompagnatore' ELSE 'guida' END
    FROM travel.departure_staff_assignments assignment
    JOIN travel.departures departure ON departure.id=assignment.departure_id
      AND departure.agency_id=assignment.agency_id AND departure.status<>'cancelled'
    WHERE assignment.agency_id=agency.id AND assignment.user_id=p_target_user_id
      AND assignment.status='active' AND assignment.role IN('accompagnatore','tour_leader','guida')
  ) eligible ON true
  JOIN iam.users target ON target.id=p_target_user_id AND target.status IN('active','invited')
    AND target.platform_role<>'superadmin'
  WHERE actor.id=p_actor_user_id AND actor.status='active'
    AND NOT EXISTS(SELECT 1 FROM iam.agency_memberships excluded
      WHERE excluded.user_id=target.id AND excluded.status<>'revoked'
        AND excluded.role IN('owner','admin','editor'))
  ORDER BY CASE eligible.user_kind WHEN 'traveler' THEN 0 WHEN 'accompagnatore' THEN 1 ELSE 2 END
  LIMIT 1;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency user impersonation denied';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid impersonation session';
  END IF;
  UPDATE iam.impersonation_sessions SET ended_at=clock_timestamp()
    WHERE actor_user_id=p_actor_user_id AND ended_at IS NULL;
  INSERT INTO iam.impersonation_sessions(actor_user_id,target_user_id,token_hash,reason,expires_at,user_agent)
  VALUES(p_actor_user_id,p_target_user_id,p_token_hash,'Assistenza agenzia tramite Login come',
    p_expires_at,left(COALESCE(p_user_agent,''),500));
  RETURN QUERY SELECT target.id,target_map.legacy_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,false,v_kind
  FROM iam.users target
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE target.id=p_target_user_id;
END $$;

CREATE OR REPLACE FUNCTION app.start_impersonation_v3(
  p_actor_user_id UUID,p_target_user_id UUID,p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,p_user_agent TEXT
)
RETURNS TABLE(target_user_id UUID,target_legacy_user_id TEXT,display_name TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
BEGIN
  IF p_actor_user_id=p_target_user_id THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='cannot impersonate self';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM iam.users actor WHERE actor.id=p_actor_user_id
    AND actor.status='active' AND actor.platform_role='superadmin')
    OR NOT EXISTS(SELECT 1 FROM iam.users target WHERE target.id=p_target_user_id
      AND target.status IN('active','invited') AND target.status NOT IN('disabled','anonymized')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='impersonation denied';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid impersonation session';
  END IF;
  UPDATE iam.impersonation_sessions SET ended_at=clock_timestamp()
    WHERE actor_user_id=p_actor_user_id AND ended_at IS NULL;
  INSERT INTO iam.impersonation_sessions(actor_user_id,target_user_id,token_hash,reason,expires_at,user_agent)
  VALUES(p_actor_user_id,p_target_user_id,p_token_hash,
    'Assistenza superadmin tramite funzione Login come',p_expires_at,left(COALESCE(p_user_agent,''),500));
  RETURN QUERY SELECT target.id,target_map.legacy_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
      WHERE membership.user_id=target.id AND membership.status IN('active','invited')
        AND membership.role IN('owner','admin','editor'))
  FROM iam.users target
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE target.id=p_target_user_id;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_impersonation_v3(p_actor_user_id UUID,p_token_hash TEXT)
RETURNS TABLE(target_user_id UUID,target_legacy_user_id TEXT,display_name TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN,expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT target.id,target_map.legacy_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
      WHERE membership.user_id=target.id AND membership.status IN('active','invited')
        AND membership.role IN('owner','admin','editor')),
    session.expires_at
  FROM iam.users actor
  JOIN iam.impersonation_sessions session ON session.actor_user_id=actor.id
    AND session.token_hash=p_token_hash AND session.ended_at IS NULL
    AND session.expires_at>clock_timestamp()
  JOIN iam.users target ON target.id=session.target_user_id AND target.status IN('active','invited')
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE actor.id=p_actor_user_id AND actor.status='active'
    AND (actor.platform_role='superadmin' OR EXISTS(
      SELECT 1 FROM iam.agency_memberships actor_membership
      JOIN iam.agencies actor_agency ON actor_agency.id=actor_membership.agency_id
        AND actor_agency.status IN('trial','active')
      WHERE actor_membership.user_id=actor.id AND actor_membership.status='active'
        AND actor_membership.role IN('owner','admin','editor')
        AND NOT EXISTS(SELECT 1 FROM iam.agency_memberships excluded
          WHERE excluded.user_id=target.id AND excluded.status<>'revoked'
            AND excluded.role IN('owner','admin','editor'))
        AND (EXISTS(SELECT 1 FROM travel.traveler_profiles profile
          WHERE profile.agency_id=actor_membership.agency_id AND profile.user_id=target.id)
          OR EXISTS(SELECT 1 FROM iam.agency_staff_profiles staff
            WHERE staff.agency_id=actor_membership.agency_id AND staff.user_id=target.id
              AND staff.status='active' AND staff.staff_role IN('accompagnatore','guida'))
          OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment
            WHERE assignment.agency_id=actor_membership.agency_id AND assignment.user_id=target.id
              AND assignment.status='active' AND assignment.role IN('accompagnatore','tour_leader','guida')))))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.read_verified_country_profile_v3(
  p_job_id UUID,p_agency_id UUID,p_country_id UUID
) RETURNS TABLE(profile JSONB,refresh_after TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ref,ops SET row_security=off AS $$
BEGIN
  UPDATE ref.country_verified_profiles candidate SET status='stale',updated_at=clock_timestamp()
  WHERE candidate.country_id=p_country_id AND candidate.status='verified'
    AND candidate.refresh_after<=clock_timestamp();
  RETURN QUERY SELECT COALESCE(review.profile_override,candidate.profile),candidate.refresh_after
  FROM ref.country_verified_profiles candidate
  JOIN ref.country_profile_agency_reviews review ON review.agency_id=p_agency_id
    AND review.country_id=candidate.country_id AND review.profile_version=candidate.version
    AND review.status='approved'
  WHERE candidate.country_id=p_country_id AND candidate.status='verified'
    AND candidate.refresh_after>clock_timestamp()
    AND EXISTS(SELECT 1 FROM ops.platform_jobs job WHERE job.id=p_job_id
      AND job.agency_id=p_agency_id AND job.job_type='travel-reference.enrich' AND job.status='processing');
END $$;

CREATE OR REPLACE FUNCTION app.save_country_profile_override_v3(
  p_actor UUID,p_agency UUID,p_country UUID,p_profile JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ref,travel SET row_security=off AS $$
DECLARE v_version INTEGER;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users actor
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.agency_id=p_agency AND membership.status='active'
      AND membership.role IN('owner','admin','editor')
    WHERE actor.id=p_actor AND actor.status='active' AND actor.platform_role<>'superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile edit not authorized';
  END IF;
  IF jsonb_typeof(p_profile)<>'object' OR jsonb_typeof(p_profile->'usefulInfo')<>'array'
    OR jsonb_array_length(p_profile->'usefulInfo')=0 OR length(p_profile::text)>100000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid country profile';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM travel.template_countries link
    WHERE link.agency_id=p_agency AND link.country_id=p_country) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile outside agency scope';
  END IF;
  SELECT candidate.version INTO v_version FROM ref.country_verified_profiles candidate
    WHERE candidate.country_id=p_country FOR UPDATE;
  IF v_version IS NULL THEN RETURN FALSE; END IF;
  INSERT INTO ref.country_profile_agency_reviews(
    agency_id,country_id,profile_version,status,reviewed_by,reviewed_at,profile_override,updated_by,updated_at
  ) VALUES(p_agency,p_country,v_version,'approved',p_actor,clock_timestamp(),p_profile,p_actor,clock_timestamp())
  ON CONFLICT(agency_id,country_id,profile_version) DO UPDATE SET
    status='approved',profile_override=EXCLUDED.profile_override,updated_by=EXCLUDED.updated_by,
    updated_at=clock_timestamp(),reviewed_by=EXCLUDED.reviewed_by,reviewed_at=clock_timestamp();
  RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION app.review_country_profile_v3(
  p_actor_legacy TEXT,p_agency_id UUID,p_country_id UUID,p_approve BOOLEAN
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ref,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_version INTEGER;
BEGIN
  SELECT actor.id INTO v_actor FROM ops.legacy_id_map map
  JOIN iam.users actor ON actor.id=map.target_id
  JOIN iam.agency_memberships membership ON membership.user_id=actor.id
    AND membership.agency_id=p_agency_id AND membership.status='active'
    AND membership.role IN('owner','admin','editor')
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
    AND actor.status='active' AND actor.platform_role<>'superadmin';
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile review reserved to agency';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM travel.template_countries link
    WHERE link.agency_id=p_agency_id AND link.country_id=p_country_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile outside agency scope';
  END IF;
  SELECT candidate.version INTO v_version FROM ref.country_verified_profiles candidate
    WHERE candidate.country_id=p_country_id FOR UPDATE;
  IF v_version IS NULL THEN RETURN FALSE; END IF;
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
  profile JSONB,base_profile JSONB,sources JSONB,validation_errors JSONB,grounded_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,reviewed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ref,travel,ops SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    JOIN iam.agency_memberships membership ON membership.user_id=actor.id
      AND membership.status='active' AND membership.role IN('owner','admin','editor')
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
      AND actor.status='active' AND actor.platform_role<>'superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='country profile review reserved to agency';
  END IF;
  RETURN QUERY SELECT DISTINCT membership.agency_id,candidate.country_id,country.name::text,country.iso_code::text,
    CASE WHEN candidate.status='stale' THEN 'stale' ELSE COALESCE(review.status,'review_required') END::text,
    candidate.version,COALESCE(review.profile_override,candidate.profile),candidate.profile,candidate.sources,
    candidate.validation_errors,candidate.grounded_at,candidate.refresh_after,review.reviewed_at,review.updated_at
  FROM ops.legacy_id_map map
  JOIN iam.users actor ON actor.id=map.target_id
  JOIN iam.agency_memberships membership ON membership.user_id=actor.id
    AND membership.status='active' AND membership.role IN('owner','admin','editor')
  JOIN travel.template_countries link ON link.agency_id=membership.agency_id
  JOIN ref.country_verified_profiles candidate ON candidate.country_id=link.country_id
  JOIN ref.countries country ON country.id=candidate.country_id
  LEFT JOIN ref.country_profile_agency_reviews review ON review.agency_id=membership.agency_id
    AND review.country_id=candidate.country_id AND review.profile_version=candidate.version
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
    AND actor.status='active' AND actor.platform_role<>'superadmin'
  ORDER BY 1,5,3;
END $$;

REVOKE ALL ON FUNCTION app.read_agency_impersonation_travelers(UUID),
  app.start_agency_traveler_impersonation(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT),
  app.start_impersonation_v3(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT),
  app.resolve_impersonation_v3(UUID,TEXT),
  app.save_country_profile_override_v3(UUID,UUID,UUID,JSONB),
  app.review_country_profile_v3(TEXT,UUID,UUID,BOOLEAN),
  app.read_country_profiles_for_review_v3(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_impersonation_travelers(UUID),
  app.start_agency_traveler_impersonation(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT),
  app.start_impersonation_v3(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT),
  app.resolve_impersonation_v3(UUID,TEXT),
  app.save_country_profile_override_v3(UUID,UUID,UUID,JSONB),
  app.review_country_profile_v3(TEXT,UUID,UUID,BOOLEAN),
  app.read_country_profiles_for_review_v3(TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('189_v3_role_parity_impersonation_country_overrides') ON CONFLICT(version) DO NOTHING;
