-- Audit append-only for every support impersonation session.

CREATE OR REPLACE FUNCTION app.audit_impersonation_session_v3()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;
BEGIN
  SELECT membership.agency_id INTO v_agency
  FROM iam.agency_memberships membership
  WHERE membership.user_id=NEW.target_user_id AND membership.status='active'
  ORDER BY membership.created_at LIMIT 1;
  IF v_agency IS NULL THEN
    SELECT profile.agency_id INTO v_agency
    FROM travel.traveler_profiles profile
    WHERE profile.user_id=NEW.target_user_id
    ORDER BY profile.created_at LIMIT 1;
  END IF;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,NEW.actor_user_id,'impersonation_session',NEW.id::text,'impersonation_started',
    jsonb_build_object('targetUserId',NEW.target_user_id,'reason',NEW.reason,'expiresAt',NEW.expires_at));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS impersonation_session_audit_v3 ON iam.impersonation_sessions;
CREATE TRIGGER impersonation_session_audit_v3
AFTER INSERT ON iam.impersonation_sessions
FOR EACH ROW EXECUTE FUNCTION app.audit_impersonation_session_v3();

REVOKE ALL ON FUNCTION app.audit_impersonation_session_v3() FROM PUBLIC;

INSERT INTO public.platform_schema_migrations(version)
VALUES('100_v3_impersonation_audit') ON CONFLICT(version) DO NOTHING;
