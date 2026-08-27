-- Agency owners can list and invite agents for their own tenant.

CREATE OR REPLACE FUNCTION app.require_agency_owner_v3(p_actor_legacy_user_id TEXT,p_agency_id UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
DECLARE v_actor UUID;
BEGIN
  SELECT map.target_id INTO v_actor FROM ops.legacy_id_map AS map
  JOIN iam.users AS actor ON actor.id=map.target_id AND actor.status='active'
  JOIN iam.agency_memberships AS membership ON membership.user_id=actor.id
    AND membership.agency_id=p_agency_id AND membership.role='owner' AND membership.status='active'
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy_user_id;
  IF v_actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner access denied'; END IF;
  RETURN v_actor;
END $$;

CREATE OR REPLACE FUNCTION app.read_agency_agents_v3(p_actor_legacy_user_id TEXT,p_agency_id UUID)
RETURNS TABLE(id TEXT,name TEXT,username TEXT,email TEXT,phone TEXT,status TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
BEGIN
  PERFORM app.require_agency_owner_v3(p_actor_legacy_user_id,p_agency_id);
  RETURN QUERY SELECT map.legacy_id,users.display_name::text,users.username::text,
    users.email::text,COALESCE(users.phone,'')::text,membership.status::text,membership.created_at
  FROM iam.agency_memberships AS membership
  JOIN iam.users AS users ON users.id=membership.user_id
  JOIN ops.legacy_id_map AS map ON map.target_id=users.id
    AND map.source_system='public-v2' AND map.entity_type='user'
  WHERE membership.agency_id=p_agency_id AND membership.role='editor' AND membership.status<>'revoked'
  ORDER BY users.display_name,users.username;
END $$;

CREATE OR REPLACE FUNCTION app.provision_agency_agent_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_display_name TEXT,p_initials TEXT,
  p_username TEXT,p_email TEXT,p_phone TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public SET row_security=off AS $$
DECLARE v_actor UUID;v_user UUID;v_legacy TEXT;v_invitation UUID;
BEGIN
  v_actor:=app.require_agency_owner_v3(p_actor_legacy_user_id,p_agency_id);
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
  VALUES(v_invitation,v_legacy,p_actor_legacy_user_id,p_token_hash,p_expires_at);
  RETURN QUERY SELECT v_legacy,true;
END $$;

REVOKE ALL ON FUNCTION app.require_agency_owner_v3(TEXT,UUID),app.read_agency_agents_v3(TEXT,UUID),
  app.provision_agency_agent_v3(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.require_agency_owner_v3(TEXT,UUID),app.read_agency_agents_v3(TEXT,UUID),
  app.provision_agency_agent_v3(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('067_v3_agency_agent_self_service') ON CONFLICT(version) DO NOTHING;
