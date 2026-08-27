-- Complete BR-019 after domain deletion by removing tenant-only identities.

CREATE OR REPLACE FUNCTION app.finalize_agency_deletion_identities_v3(p_job_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops
SET row_security=off
AS $$
DECLARE v_candidate_ids JSONB;v_deleted INTEGER:=0;
BEGIN
  SELECT COALESCE(job.cursor_state->'candidateUserIds','[]'::jsonb)
    INTO v_candidate_ids
  FROM ops.agency_deletion_jobs job
  WHERE job.id=p_job_id AND job.status='completed';
  IF v_candidate_ids IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='agency deletion is not completed';
  END IF;

  DELETE FROM iam.impersonation_sessions session
  WHERE session.target_user_id IN(
    SELECT value::uuid FROM jsonb_array_elements_text(v_candidate_ids));

  DELETE FROM iam.users user_row
  WHERE user_row.platform_role<>'superadmin'
    AND user_row.id IN(SELECT value::uuid FROM jsonb_array_elements_text(v_candidate_ids))
    AND NOT EXISTS(SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=user_row.id)
    AND NOT EXISTS(SELECT 1 FROM travel.traveler_profiles traveler
      WHERE traveler.user_id=user_row.id);
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  RETURN v_deleted;
END $$;

REVOKE ALL ON FUNCTION app.finalize_agency_deletion_identities_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finalize_agency_deletion_identities_v3(UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('059_v3_agency_deletion_identity_finalization') ON CONFLICT(version) DO NOTHING;
