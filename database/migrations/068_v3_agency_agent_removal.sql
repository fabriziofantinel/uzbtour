-- Agency owners can remove an agent from their tenant while preserving audit history.

CREATE OR REPLACE FUNCTION app.remove_agency_agent_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_agent_legacy_user_id TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_actor UUID;v_agent UUID;v_name TEXT;
BEGIN
  v_actor:=app.require_agency_owner_v3(p_actor_legacy_user_id,p_agency_id);
  SELECT map.target_id,users.display_name INTO v_agent,v_name
  FROM ops.legacy_id_map AS map
  JOIN iam.users AS users ON users.id=map.target_id
  JOIN iam.agency_memberships AS membership ON membership.user_id=users.id
    AND membership.agency_id=p_agency_id AND membership.role='editor' AND membership.status<>'revoked'
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_agent_legacy_user_id;
  IF v_agent IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency agent not found'; END IF;
  UPDATE iam.agency_memberships SET status='revoked'
  WHERE agency_id=p_agency_id AND user_id=v_agent AND role='editor';
  DELETE FROM public.agency_memberships WHERE agency_id=p_agency_id AND user_id=p_agent_legacy_user_id;
  UPDATE iam.invitations SET used_at=COALESCE(used_at,clock_timestamp())
  WHERE agency_id=p_agency_id AND invited_user_id=v_agent;
  UPDATE public.user_invitations SET used_at=COALESCE(used_at,clock_timestamp())
  WHERE user_id=p_agent_legacy_user_id;
  IF NOT EXISTS(SELECT 1 FROM iam.agency_memberships WHERE user_id=v_agent AND status IN('invited','active'))
    AND NOT EXISTS(SELECT 1 FROM travel.traveler_profiles WHERE user_id=v_agent) THEN
    UPDATE iam.users SET status='disabled',updated_at=clock_timestamp() WHERE id=v_agent;
    UPDATE public.platform_users SET status='disabled',updated_at=clock_timestamp() WHERE id=p_agent_legacy_user_id;
  END IF;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'agency_agent',p_agent_legacy_user_id,'removed',jsonb_build_object('name',v_name));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.remove_agency_agent_v3(TEXT,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_agency_agent_v3(TEXT,UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('068_v3_agency_agent_removal') ON CONFLICT(version) DO NOTHING;
