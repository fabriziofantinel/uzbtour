-- Native UUID contracts for the Tour Leader flow. Migration 142 introduced
-- the feature; this ratchet removes its temporary legacy actor signatures.

DROP FUNCTION IF EXISTS app.assign_tour_leader_period_v3(TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ);
DROP FUNCTION IF EXISTS app.provision_departure_tour_leader_v3(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ);
DROP FUNCTION IF EXISTS app.list_departure_tour_leaders_v3(TEXT,UUID);
DROP FUNCTION IF EXISTS app.list_my_tour_leader_departures_v3(TEXT);
DROP FUNCTION IF EXISTS app.revoke_tour_leader_v3(TEXT,UUID,UUID,TEXT);

DROP FUNCTION app.resolve_cognito_authenticated_user(TEXT);
CREATE FUNCTION app.resolve_cognito_authenticated_user(p_subject TEXT)
RETURNS TABLE(native_user_id UUID,legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT,platform_role TEXT,is_agency_admin BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
 SELECT users.id,map.legacy_id::text,users.display_name::text,users.username::text,
  COALESCE(users.email,'')::text,users.platform_role::text,
  EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.user_id=users.id
    AND membership.status='active' AND membership.role IN('owner','admin','editor'))::boolean
 FROM iam.user_identities identity JOIN iam.users users ON users.id=identity.user_id AND users.status='active'
 JOIN ops.legacy_id_map map ON map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=users.id
 WHERE identity.provider='cognito' AND identity.subject=p_subject LIMIT 1;
$$;

CREATE FUNCTION app.assign_tour_leader_period_v3(
 p_actor_user_id UUID,p_departure UUID,p_user_id UUID,p_valid_from TIMESTAMPTZ,p_valid_until TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_id UUID;
BEGIN
 SELECT d.agency_id INTO v_agency FROM travel.departures d JOIN iam.agency_memberships m
  ON m.agency_id=d.agency_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.role='owner'
 WHERE d.id=p_departure;
 IF v_agency IS NULL OR p_valid_from IS NULL OR p_valid_until<=p_valid_from OR NOT EXISTS(
  SELECT 1 FROM iam.users u WHERE u.id=p_user_id AND u.status IN('invited','active') AND (
   EXISTS(SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id=v_agency AND m.user_id=u.id
    AND m.status='active' AND m.role IN('admin','editor')) OR
   EXISTS(SELECT 1 FROM travel.departure_staff_assignments s WHERE s.agency_id=v_agency AND s.user_id=u.id AND s.role='tour_leader')))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='tour leader assignment not authorized';END IF;
 INSERT INTO travel.departure_staff_assignments(agency_id,departure_id,user_id,role,status,assigned_by,valid_from,valid_until)
 VALUES(v_agency,p_departure,p_user_id,'tour_leader','active',p_actor_user_id,p_valid_from,p_valid_until)
 ON CONFLICT(departure_id,user_id,role) DO UPDATE SET status='active',assigned_by=p_actor_user_id,
  assigned_at=clock_timestamp(),revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL,
  valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until RETURNING id INTO v_id;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,p_actor_user_id,'departure',p_departure::text,'tour_leader_assigned',
  jsonb_build_object('userId',p_user_id,'validFrom',p_valid_from,'validUntil',p_valid_until));
 RETURN v_id;
END $$;

CREATE FUNCTION app.provision_departure_tour_leader_v3(
 p_actor_user_id UUID,p_departure UUID,p_display_name TEXT,p_initials TEXT,p_username TEXT,p_email TEXT,p_phone TEXT,
 p_token_hash TEXT,p_expires_at TIMESTAMPTZ,p_valid_from TIMESTAMPTZ,p_valid_until TIMESTAMPTZ)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN,assignment_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_agency UUID;v_user UUID;v_legacy TEXT;v_invitation UUID;v_assignment UUID;v_actor_legacy TEXT;
BEGIN
 SELECT d.agency_id INTO v_agency FROM travel.departures d JOIN iam.agency_memberships m
  ON m.agency_id=d.agency_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.role='owner'
 WHERE d.id=p_departure;
 SELECT map.legacy_id INTO v_actor_legacy FROM ops.legacy_id_map map WHERE map.source_system='public-v2'
  AND map.entity_type='user' AND map.target_id=p_actor_user_id LIMIT 1;
 IF v_agency IS NULL OR v_actor_legacy IS NULL OR btrim(p_username) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
  OR NULLIF(btrim(p_display_name),'') IS NULL OR NULLIF(btrim(p_email),'') IS NULL
  OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp()
  OR p_valid_from IS NULL OR p_valid_until<=p_valid_from THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid Tour Leader invitation';END IF;
 IF EXISTS(SELECT 1 FROM iam.users WHERE normalized_username=lower(btrim(p_username))) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned';END IF;
 INSERT INTO iam.users(username,display_name,email,phone,platform_role,status)
 VALUES(btrim(p_username),btrim(p_display_name),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'user','invited') RETURNING id INTO v_user;
 v_legacy:='tour-leader:'||gen_random_uuid()::text;
 INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,target_id,agency_id) VALUES('public-v2','user',v_legacy,v_user,v_agency);
 INSERT INTO public.platform_users(id,username,display_name,initials,email,phone,auth_provider,platform_role,status)
 VALUES(v_legacy,btrim(p_username),btrim(p_display_name),left(p_initials,8),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'cognito','user','invited');
 INSERT INTO iam.invitations(agency_id,invited_user_id,created_by_user_id,token_hash,expires_at)
 VALUES(v_agency,v_user,p_actor_user_id,p_token_hash,p_expires_at) RETURNING id INTO v_invitation;
 INSERT INTO public.user_invitations(id,user_id,created_by_user_id,token_hash,expires_at)
 VALUES(v_invitation,v_legacy,v_actor_legacy,p_token_hash,p_expires_at);
 INSERT INTO travel.departure_staff_assignments(agency_id,departure_id,user_id,role,status,assigned_by,valid_from,valid_until)
 VALUES(v_agency,p_departure,v_user,'tour_leader','active',p_actor_user_id,p_valid_from,p_valid_until) RETURNING id INTO v_assignment;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,p_actor_user_id,'departure',p_departure::text,'tour_leader_invited',
  jsonb_build_object('userId',v_user,'validFrom',p_valid_from,'validUntil',p_valid_until));
 RETURN QUERY SELECT v_legacy,true,v_assignment;
END $$;

CREATE FUNCTION app.list_departure_tour_leaders_v3(p_actor_user_id UUID,p_departure UUID)
RETURNS TABLE(id UUID,user_id UUID,name TEXT,email TEXT,status TEXT,valid_from TIMESTAMPTZ,valid_until TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
DECLARE v_agency UUID;
BEGIN
 SELECT d.agency_id INTO v_agency FROM travel.departures d WHERE d.id=p_departure;
 IF NOT EXISTS(SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id=v_agency AND m.user_id=p_actor_user_id
  AND m.status='active' AND m.role='owner') AND NOT EXISTS(SELECT 1 FROM travel.departure_staff_assignments s
  WHERE s.agency_id=v_agency AND s.departure_id=p_departure AND s.user_id=p_actor_user_id AND s.role='tour_leader'
   AND s.status='active' AND clock_timestamp()>=s.valid_from AND clock_timestamp()<s.valid_until)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='departure staff not authorized';END IF;
 RETURN QUERY SELECT s.id,s.user_id,u.display_name::text,COALESCE(u.email,'')::text,s.status::text,s.valid_from,s.valid_until
 FROM travel.departure_staff_assignments s JOIN iam.users u ON u.id=s.user_id
 WHERE s.agency_id=v_agency AND s.departure_id=p_departure ORDER BY s.status,s.valid_from DESC;
END $$;

CREATE FUNCTION app.list_my_tour_leader_departures_v3(p_actor_user_id UUID)
RETURNS TABLE(departure_id UUID,title TEXT,agency_name TEXT,starts_on DATE,ends_on DATE,valid_from TIMESTAMPTZ,valid_until TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
 SELECT d.id,d.title::text,a.name::text,d.starts_on,d.ends_on,s.valid_from,s.valid_until
 FROM travel.departure_staff_assignments s JOIN travel.departures d ON d.id=s.departure_id AND d.agency_id=s.agency_id
 JOIN iam.agencies a ON a.id=d.agency_id WHERE s.user_id=p_actor_user_id AND s.role='tour_leader' AND s.status='active'
  AND clock_timestamp()>=s.valid_from AND clock_timestamp()<s.valid_until ORDER BY d.starts_on,d.title;
$$;

CREATE OR REPLACE FUNCTION app.revoke_tour_leader_v3(p_actor_user_id UUID,p_departure UUID,p_assignment UUID,p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_user UUID;
BEGIN
 SELECT d.agency_id INTO v_agency FROM travel.departures d JOIN iam.agency_memberships m
  ON m.agency_id=d.agency_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.role='owner' WHERE d.id=p_departure;
 IF v_agency IS NULL OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 300 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='tour leader revocation not authorized';END IF;
 UPDATE travel.departure_staff_assignments SET status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,
  revocation_reason=btrim(p_reason) WHERE id=p_assignment AND agency_id=v_agency AND departure_id=p_departure AND status='active'
 RETURNING user_id INTO v_user;
 IF v_user IS NULL THEN RETURN false;END IF;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,p_actor_user_id,'departure',p_departure::text,'tour_leader_revoked',
  jsonb_build_object('assignmentId',p_assignment,'userId',v_user,'reason',btrim(p_reason)));
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.resolve_cognito_authenticated_user(TEXT),
 app.assign_tour_leader_period_v3(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ),
 app.provision_departure_tour_leader_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ),
 app.list_departure_tour_leaders_v3(UUID,UUID),app.list_my_tour_leader_departures_v3(UUID),
 app.revoke_tour_leader_v3(UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_cognito_authenticated_user(TEXT),
 app.assign_tour_leader_period_v3(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ),
 app.provision_departure_tour_leader_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ),
 app.list_departure_tour_leaders_v3(UUID,UUID),app.list_my_tour_leader_departures_v3(UUID),
 app.revoke_tour_leader_v3(UUID,UUID,UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('143_v3_tour_leader_native_identity') ON CONFLICT(version) DO NOTHING;
