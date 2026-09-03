CREATE OR REPLACE FUNCTION app.require_agency_owner_v3(p_actor_user_id UUID,p_agency_id UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM iam.users AS actor
    JOIN iam.agency_memberships AS membership ON membership.user_id=actor.id
      AND membership.agency_id=p_agency_id AND membership.role='owner' AND membership.status='active'
    JOIN iam.agencies AS agency ON agency.id=membership.agency_id AND agency.status IN('active','trial')
    WHERE actor.id=p_actor_user_id AND actor.status='active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner access denied';
  END IF;
  RETURN p_actor_user_id;
END $$;

CREATE OR REPLACE FUNCTION app.provision_agency_agent_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_display_name TEXT,p_initials TEXT,
  p_username TEXT,p_email TEXT,p_phone TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public SET row_security=off AS $$
DECLARE v_actor UUID;v_actor_legacy TEXT;v_user UUID;v_legacy TEXT;v_invitation UUID;
BEGIN
  v_actor:=app.require_agency_owner_v3(p_actor_user_id,p_agency_id);
  SELECT map.legacy_id INTO v_actor_legacy FROM ops.legacy_id_map AS map
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=v_actor
  ORDER BY map.created_at LIMIT 1;
  IF v_actor_legacy IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='agency owner compatibility identity missing';
  END IF;
  IF btrim(p_username) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
    OR NULLIF(btrim(p_display_name),'') IS NULL OR NULLIF(btrim(p_email),'') IS NULL
    OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid agency agent provisioning request';
  END IF;
  IF EXISTS(SELECT 1 FROM iam.users WHERE normalized_username=lower(btrim(p_username))) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned';
  END IF;
  INSERT INTO iam.users(username,display_name,email,phone,platform_role,status)
  VALUES(btrim(p_username),btrim(p_display_name),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'user','invited')
  RETURNING iam.users.id INTO v_user;
  v_legacy:='agent:'||gen_random_uuid()::text;
  INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,target_id,agency_id)
  VALUES('public-v2','user',v_legacy,v_user,p_agency_id);
  INSERT INTO public.platform_users(id,username,display_name,initials,email,phone,auth_provider,platform_role,status)
  VALUES(v_legacy,btrim(p_username),btrim(p_display_name),left(p_initials,8),lower(btrim(p_email)),
    NULLIF(btrim(p_phone),''),'cognito','user','invited');
  INSERT INTO iam.agency_memberships(agency_id,user_id,role,status)
  VALUES(p_agency_id,v_user,'editor','invited');
  INSERT INTO public.agency_memberships(agency_id,user_id,role)
  VALUES(p_agency_id,v_legacy,'editor');
  INSERT INTO iam.invitations(agency_id,invited_user_id,created_by_user_id,token_hash,expires_at)
  VALUES(p_agency_id,v_user,v_actor,p_token_hash,p_expires_at) RETURNING id INTO v_invitation;
  INSERT INTO public.user_invitations(id,user_id,created_by_user_id,token_hash,expires_at)
  VALUES(v_invitation,v_legacy,v_actor_legacy,p_token_hash,p_expires_at);
  RETURN QUERY SELECT v_legacy,true;
END $$;

CREATE OR REPLACE FUNCTION app.remove_agency_agent_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_agent_legacy_user_id TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_actor UUID;v_agent UUID;v_name TEXT;
BEGIN
  v_actor:=app.require_agency_owner_v3(p_actor_user_id,p_agency_id);
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

REVOKE ALL ON FUNCTION app.require_agency_owner_v3(TEXT,UUID) FROM smf_app;
REVOKE ALL ON FUNCTION app.provision_agency_agent_v3(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM smf_app;
REVOKE ALL ON FUNCTION app.remove_agency_agent_v3(TEXT,UUID,TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.require_agency_owner_v3(UUID,UUID),
  app.provision_agency_agent_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.remove_agency_agent_v3(UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.require_agency_owner_v3(UUID,UUID),
  app.provision_agency_agent_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.remove_agency_agent_v3(UUID,UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('155_v3_native_agency_agent_mutations') ON CONFLICT(version) DO NOTHING;
