-- Invite a Tour Leader directly on a departure without creating a permanent
-- agency membership. Assignments are explicitly time bounded and revocable.

CREATE OR REPLACE FUNCTION app.assign_tour_leader_period_v3(
  p_actor_legacy TEXT,p_departure UUID,p_user_legacy TEXT,
  p_valid_from TIMESTAMPTZ,p_valid_until TIMESTAMPTZ
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_user UUID;v_agency UUID;v_id UUID;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map
 WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id INTO v_agency FROM travel.departures d
 JOIN iam.agency_memberships m ON m.agency_id=d.agency_id AND m.user_id=v_actor
  AND m.status='active' AND m.role='owner'
 WHERE d.id=p_departure;
 SELECT map.target_id INTO v_user FROM ops.legacy_id_map map JOIN iam.users u ON u.id=map.target_id
 WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_user_legacy
   AND u.status IN('invited','active') LIMIT 1;
 IF v_agency IS NULL OR v_user IS NULL OR p_valid_from IS NULL OR p_valid_until<=p_valid_from THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='tour leader assignment not authorized';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id=v_agency AND m.user_id=v_user
   AND m.status='active' AND m.role IN('admin','editor'))
   AND NOT EXISTS(SELECT 1 FROM travel.departure_staff_assignments s WHERE s.agency_id=v_agency
     AND s.user_id=v_user AND s.role='tour_leader') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='tour leader candidate not eligible';
 END IF;
 INSERT INTO travel.departure_staff_assignments
  (agency_id,departure_id,user_id,role,status,assigned_by,valid_from,valid_until)
 VALUES(v_agency,p_departure,v_user,'tour_leader','active',v_actor,p_valid_from,p_valid_until)
 ON CONFLICT(departure_id,user_id,role) DO UPDATE SET status='active',assigned_by=v_actor,
  assigned_at=clock_timestamp(),revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL,
  valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until
 RETURNING id INTO v_id;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,v_actor,'departure',p_departure::text,'tour_leader_assigned',
  jsonb_build_object('userId',v_user,'validFrom',p_valid_from,'validUntil',p_valid_until));
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.provision_departure_tour_leader_v3(
  p_actor_legacy TEXT,p_departure UUID,p_display_name TEXT,p_initials TEXT,
  p_username TEXT,p_email TEXT,p_phone TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ,
  p_valid_from TIMESTAMPTZ,p_valid_until TIMESTAMPTZ
)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN,assignment_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_user UUID;v_legacy TEXT;v_invitation UUID;v_assignment UUID;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map
 WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id INTO v_agency FROM travel.departures d
 JOIN iam.agency_memberships m ON m.agency_id=d.agency_id AND m.user_id=v_actor
  AND m.status='active' AND m.role='owner'
 WHERE d.id=p_departure;
 IF v_agency IS NULL OR btrim(p_username) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
   OR NULLIF(btrim(p_display_name),'') IS NULL OR NULLIF(btrim(p_email),'') IS NULL
   OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp()
   OR p_valid_from IS NULL OR p_valid_until<=p_valid_from THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid Tour Leader invitation';
 END IF;
 IF EXISTS(SELECT 1 FROM iam.users WHERE normalized_username=lower(btrim(p_username))) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned';
 END IF;
 INSERT INTO iam.users(username,display_name,email,phone,platform_role,status)
 VALUES(btrim(p_username),btrim(p_display_name),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'user','invited')
 RETURNING id INTO v_user;
 v_legacy:='tour-leader:'||gen_random_uuid()::text;
 INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,target_id,agency_id)
 VALUES('public-v2','user',v_legacy,v_user,v_agency);
 INSERT INTO public.platform_users(id,username,display_name,initials,email,phone,auth_provider,platform_role,status)
 VALUES(v_legacy,btrim(p_username),btrim(p_display_name),left(p_initials,8),lower(btrim(p_email)),
  NULLIF(btrim(p_phone),''),'cognito','user','invited');
 INSERT INTO iam.invitations(agency_id,invited_user_id,created_by_user_id,token_hash,expires_at)
 VALUES(v_agency,v_user,v_actor,p_token_hash,p_expires_at) RETURNING id INTO v_invitation;
 INSERT INTO public.user_invitations(id,user_id,created_by_user_id,token_hash,expires_at)
 VALUES(v_invitation,v_legacy,p_actor_legacy,p_token_hash,p_expires_at);
 INSERT INTO travel.departure_staff_assignments
  (agency_id,departure_id,user_id,role,status,assigned_by,valid_from,valid_until)
 VALUES(v_agency,p_departure,v_user,'tour_leader','active',v_actor,p_valid_from,p_valid_until)
 RETURNING id INTO v_assignment;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,v_actor,'departure',p_departure::text,'tour_leader_invited',
  jsonb_build_object('userId',v_user,'validFrom',p_valid_from,'validUntil',p_valid_until));
 RETURN QUERY SELECT v_legacy,true,v_assignment;
END $$;

CREATE OR REPLACE FUNCTION app.list_departure_tour_leaders_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS TABLE(id UUID,user_id UUID,name TEXT,email TEXT,status TEXT,valid_from TIMESTAMPTZ,valid_until TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map
 WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id INTO v_agency FROM travel.departures d WHERE d.id=p_departure;
 IF NOT EXISTS(SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id=v_agency AND m.user_id=v_actor
   AND m.status='active' AND m.role='owner') AND NOT app.is_departure_operator_v3(p_actor_legacy,p_departure) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='departure staff not authorized';
 END IF;
 RETURN QUERY SELECT s.id,s.user_id,u.display_name::text,COALESCE(u.email,'')::text,s.status::text,
  s.valid_from,s.valid_until FROM travel.departure_staff_assignments s
 JOIN iam.users u ON u.id=s.user_id WHERE s.agency_id=v_agency AND s.departure_id=p_departure
 ORDER BY s.status,s.valid_from DESC;
END $$;

CREATE OR REPLACE FUNCTION app.list_my_tour_leader_departures_v3(p_actor_legacy TEXT)
RETURNS TABLE(departure_id UUID,title TEXT,agency_name TEXT,starts_on DATE,ends_on DATE,valid_from TIMESTAMPTZ,valid_until TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
 SELECT d.id,d.title::text,a.name::text,d.starts_on,d.ends_on,s.valid_from,s.valid_until
 FROM ops.legacy_id_map map
 JOIN travel.departure_staff_assignments s ON s.user_id=map.target_id AND s.role='tour_leader' AND s.status='active'
 JOIN travel.departures d ON d.id=s.departure_id AND d.agency_id=s.agency_id
 JOIN iam.agencies a ON a.id=d.agency_id
 WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
   AND clock_timestamp()>=s.valid_from AND clock_timestamp()<s.valid_until
 ORDER BY d.starts_on,d.title;
$$;

CREATE OR REPLACE FUNCTION app.revoke_tour_leader_v3(p_actor_legacy TEXT,p_departure UUID,p_assignment UUID,p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_user UUID;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map
 WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id INTO v_agency FROM travel.departures d JOIN iam.agency_memberships m
  ON m.agency_id=d.agency_id AND m.user_id=v_actor AND m.status='active' AND m.role='owner'
 WHERE d.id=p_departure;
 IF v_agency IS NULL OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 300 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='tour leader revocation not authorized';
 END IF;
 UPDATE travel.departure_staff_assignments SET status='revoked',revoked_at=clock_timestamp(),
  revoked_by=v_actor,revocation_reason=btrim(p_reason)
 WHERE id=p_assignment AND agency_id=v_agency AND departure_id=p_departure AND status='active'
 RETURNING user_id INTO v_user;
 IF v_user IS NULL THEN RETURN false; END IF;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,v_actor,'departure',p_departure::text,'tour_leader_revoked',
  jsonb_build_object('assignmentId',p_assignment,'userId',v_user,'reason',btrim(p_reason)));
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.assign_tour_leader_period_v3(TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ),
 app.provision_departure_tour_leader_v3(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ),
 app.list_departure_tour_leaders_v3(TEXT,UUID),app.list_my_tour_leader_departures_v3(TEXT),
 app.revoke_tour_leader_v3(TEXT,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assign_tour_leader_period_v3(TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ),
 app.provision_departure_tour_leader_v3(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ),
 app.list_departure_tour_leaders_v3(TEXT,UUID),app.list_my_tour_leader_departures_v3(TEXT),
 app.revoke_tour_leader_v3(TEXT,UUID,UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('142_v3_freelance_tour_leader_invitation') ON CONFLICT(version) DO NOTHING;
