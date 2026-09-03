-- Qualify IAM columns that overlap with TABLE return names in the native deletion request.
CREATE OR REPLACE FUNCTION app.request_agency_deletion_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_reason TEXT
)
RETURNS TABLE(job_id UUID,agency_name TEXT,status TEXT,phase TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
DECLARE v_name TEXT;v_job UUID;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM iam.users AS actor
    WHERE actor.id=p_actor_user_id AND actor.platform_role='superadmin' AND actor.status='active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='superadmin access denied';
  END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='deletion reason required';
  END IF;
  SELECT agency.name INTO v_name
  FROM iam.agencies AS agency WHERE agency.id=p_agency_id FOR UPDATE;
  IF v_name IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  SELECT deletion.id INTO v_job FROM ops.agency_deletion_jobs AS deletion
  WHERE deletion.agency_id=p_agency_id AND deletion.status IN('queued','processing','blocked')
  ORDER BY deletion.requested_at DESC LIMIT 1;
  IF v_job IS NULL THEN
    UPDATE iam.agencies AS agency SET status='deleting',updated_at=clock_timestamp()
    WHERE agency.id=p_agency_id;
    INSERT INTO ops.agency_deletion_jobs(
      agency_id,agency_name_snapshot,requested_by_user_id,reason,cursor_state
    )
    VALUES(
      p_agency_id,v_name,p_actor_user_id,btrim(p_reason),
      jsonb_build_object('candidateUserIds',COALESCE((
        SELECT jsonb_agg(DISTINCT candidate.user_id) FROM (
          SELECT membership.user_id FROM iam.agency_memberships AS membership
          WHERE membership.agency_id=p_agency_id
          UNION
          SELECT traveler.user_id FROM travel.traveler_profiles AS traveler
          WHERE traveler.agency_id=p_agency_id AND traveler.user_id IS NOT NULL
        ) AS candidate
      ),'[]'::jsonb))
    ) RETURNING id INTO v_job;
    INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
    VALUES(
      p_agency_id,p_actor_user_id,'agency',p_agency_id::text,'deletion_requested',
      jsonb_build_object('jobId',v_job,'reason',btrim(p_reason),'rule','BR-019')
    );
  END IF;
  RETURN QUERY
  SELECT deletion.id,deletion.agency_name_snapshot,deletion.status::text,deletion.phase::text
  FROM ops.agency_deletion_jobs AS deletion WHERE deletion.id=v_job;
END $$;

REVOKE ALL ON FUNCTION app.request_agency_deletion_v3(UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_agency_deletion_v3(UUID,UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('164_v3_native_agency_deletion_request_fix') ON CONFLICT(version) DO NOTHING;
