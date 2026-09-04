-- Agency staff directory and explicit day coverage for operational personnel.
-- Existing tour-leader assignments remain valid and are treated as Accompagnatore
-- until the agency assigns a more specific staff role.

CREATE TABLE IF NOT EXISTS iam.agency_staff_profiles (
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  staff_role TEXT NOT NULL CHECK (staff_role IN ('agent','accompagnatore','guida')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES iam.users(id) ON DELETE RESTRICT,
  PRIMARY KEY(agency_id,user_id),
  CHECK ((status='active' AND revoked_at IS NULL AND revoked_by IS NULL) OR
         (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS agency_staff_profiles_directory_idx
  ON iam.agency_staff_profiles(agency_id,status,staff_role,user_id);

-- Preserve the existing agency agents in the new personnel directory.
INSERT INTO iam.agency_staff_profiles(agency_id,user_id,staff_role,status,created_by)
SELECT membership.agency_id,membership.user_id,'agent','active',membership.user_id
FROM iam.agency_memberships membership
WHERE membership.role='editor' AND membership.status IN ('active','invited')
ON CONFLICT(agency_id,user_id) DO NOTHING;

ALTER TABLE travel.departure_staff_assignments
  DROP CONSTRAINT IF EXISTS departure_staff_assignments_role_check,
  ADD CONSTRAINT departure_staff_assignments_role_check
    CHECK (role IN ('tour_leader','agent','accompagnatore','guida'));

CREATE TABLE IF NOT EXISTS travel.departure_staff_day_assignments (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  staff_assignment_id UUID NOT NULL REFERENCES travel.departure_staff_assignments(id) ON DELETE CASCADE,
  departure_day_id UUID NOT NULL,
  assigned_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(staff_assignment_id,departure_day_id),
  FOREIGN KEY(agency_id,departure_id,departure_day_id)
    REFERENCES travel.departure_days(agency_id,departure_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS departure_staff_day_assignments_lookup_idx
  ON travel.departure_staff_day_assignments(agency_id,departure_id,departure_day_id,staff_assignment_id);

CREATE OR REPLACE FUNCTION app.is_departure_operator_v3(p_actor_user_id UUID,p_departure UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
 SELECT EXISTS(
   SELECT 1 FROM travel.departures departure
   WHERE departure.id=p_departure AND (
     EXISTS(SELECT 1 FROM iam.agency_memberships membership
       WHERE membership.agency_id=departure.agency_id AND membership.user_id=p_actor_user_id
         AND membership.status='active' AND membership.role IN ('owner','admin','editor'))
     OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment
       WHERE assignment.agency_id=departure.agency_id AND assignment.departure_id=p_departure
         AND assignment.user_id=p_actor_user_id AND assignment.role IN ('tour_leader','agent','accompagnatore','guida')
         AND assignment.status='active' AND clock_timestamp()>=assignment.valid_from
         AND clock_timestamp()<assignment.valid_until)
   )
 );
$$;

CREATE OR REPLACE FUNCTION app.read_agency_staff_v3(p_actor_user_id UUID,p_agency_id UUID)
RETURNS TABLE(legacy_user_id TEXT,user_id UUID,name TEXT,username TEXT,email TEXT,phone TEXT,staff_role TEXT,status TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
BEGIN
  PERFORM app.require_agency_owner_v3(p_actor_user_id,p_agency_id);
  RETURN QUERY
  SELECT legacy.legacy_id::text,staff.user_id,account.display_name::text,account.username::text,
    COALESCE(account.email,'')::text,COALESCE(account.phone,'')::text,staff.staff_role::text,
    CASE WHEN membership.status='invited' THEN 'invited' ELSE staff.status END::text,staff.created_at
  FROM iam.agency_staff_profiles staff
  JOIN iam.users account ON account.id=staff.user_id
  LEFT JOIN iam.agency_memberships membership ON membership.agency_id=staff.agency_id
    AND membership.user_id=staff.user_id AND membership.status IN ('active','invited')
  JOIN ops.legacy_id_map legacy ON legacy.target_id=staff.user_id AND legacy.agency_id=staff.agency_id
    AND legacy.source_system='public-v2' AND legacy.entity_type='user'
  WHERE staff.agency_id=p_agency_id
  ORDER BY staff.staff_role,account.display_name;
END $$;

CREATE OR REPLACE FUNCTION app.provision_agency_staff_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_staff_role TEXT,p_display_name TEXT,p_initials TEXT,
  p_username TEXT,p_email TEXT,p_phone TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
) RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public SET row_security=off AS $$
DECLARE v_actor_legacy TEXT;v_user UUID;v_legacy TEXT;v_invitation UUID;v_membership_role TEXT;
BEGIN
  PERFORM app.require_agency_owner_v3(p_actor_user_id,p_agency_id);
  SELECT legacy_id INTO v_actor_legacy FROM ops.legacy_id_map
   WHERE source_system='public-v2' AND entity_type='user' AND target_id=p_actor_user_id ORDER BY created_at LIMIT 1;
  IF v_actor_legacy IS NULL OR p_staff_role NOT IN ('agent','accompagnatore','guida')
    OR btrim(p_username) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
    OR NULLIF(btrim(p_display_name),'') IS NULL OR NULLIF(btrim(p_email),'') IS NULL
    OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid agency staff provisioning request';
  END IF;
  IF EXISTS(SELECT 1 FROM iam.users WHERE normalized_username=lower(btrim(p_username))) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned';
  END IF;
  v_membership_role:=CASE WHEN p_staff_role='agent' THEN 'editor' ELSE 'viewer' END;
  INSERT INTO iam.users(username,display_name,email,phone,platform_role,status)
  VALUES(btrim(p_username),btrim(p_display_name),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'user','invited')
  RETURNING id INTO v_user;
  v_legacy:='staff:'||gen_random_uuid()::text;
  INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,target_id,agency_id)
  VALUES('public-v2','user',v_legacy,v_user,p_agency_id);
  INSERT INTO public.platform_users(id,username,display_name,initials,email,phone,auth_provider,platform_role,status)
  VALUES(v_legacy,btrim(p_username),btrim(p_display_name),left(p_initials,8),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'cognito','user','invited');
  INSERT INTO iam.agency_memberships(agency_id,user_id,role,status)
  VALUES(p_agency_id,v_user,v_membership_role,'invited');
  INSERT INTO public.agency_memberships(agency_id,user_id,role)
  VALUES(p_agency_id,v_legacy,v_membership_role);
  INSERT INTO iam.agency_staff_profiles(agency_id,user_id,staff_role,status,created_by)
  VALUES(p_agency_id,v_user,p_staff_role,'active',p_actor_user_id);
  INSERT INTO iam.invitations(agency_id,invited_user_id,created_by_user_id,token_hash,expires_at)
  VALUES(p_agency_id,v_user,p_actor_user_id,p_token_hash,p_expires_at) RETURNING id INTO v_invitation;
  INSERT INTO public.user_invitations(id,user_id,created_by_user_id,token_hash,expires_at)
  VALUES(v_invitation,v_legacy,v_actor_legacy,p_token_hash,p_expires_at);
  RETURN QUERY SELECT v_legacy,true;
END $$;

CREATE OR REPLACE FUNCTION app.assign_departure_staff_days_v3(
  p_actor_user_id UUID,p_departure UUID,p_user_id UUID,p_role TEXT,p_day_ids UUID[]
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_assignment UUID;v_from TIMESTAMPTZ;v_until TIMESTAMPTZ;
BEGIN
  SELECT departure.agency_id,departure.starts_on::timestamptz,(departure.ends_on+1)::timestamptz
  INTO v_agency,v_from,v_until FROM travel.departures departure
  JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id
    AND membership.user_id=p_actor_user_id AND membership.status='active' AND membership.role='owner'
  WHERE departure.id=p_departure;
  IF v_agency IS NULL OR p_role NOT IN ('agent','accompagnatore','guida')
    OR cardinality(p_day_ids) IS NULL OR cardinality(p_day_ids)=0
    OR NOT EXISTS(SELECT 1 FROM iam.agency_staff_profiles profile WHERE profile.agency_id=v_agency
       AND profile.user_id=p_user_id AND profile.staff_role=p_role AND profile.status='active')
    OR (SELECT count(*) FROM travel.departure_days day WHERE day.agency_id=v_agency AND day.departure_id=p_departure AND day.id=ANY(p_day_ids))<>cardinality(p_day_ids)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='departure staff assignment not authorized'; END IF;
  INSERT INTO travel.departure_staff_assignments(agency_id,departure_id,user_id,role,status,assigned_by,valid_from,valid_until)
  VALUES(v_agency,p_departure,p_user_id,p_role,'active',p_actor_user_id,v_from,v_until)
  ON CONFLICT(departure_id,user_id,role) DO UPDATE SET status='active',assigned_by=EXCLUDED.assigned_by,
    assigned_at=clock_timestamp(),revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL,
    valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until RETURNING id INTO v_assignment;
  DELETE FROM travel.departure_staff_day_assignments WHERE staff_assignment_id=v_assignment;
  INSERT INTO travel.departure_staff_day_assignments(agency_id,departure_id,staff_assignment_id,departure_day_id,assigned_by)
  SELECT v_agency,p_departure,v_assignment,day_id,p_actor_user_id FROM unnest(p_day_ids) day_id;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,p_actor_user_id,'departure',p_departure::text,'staff_days_assigned',
    jsonb_build_object('userId',p_user_id,'role',p_role,'dayIds',p_day_ids));
  RETURN v_assignment;
END $$;

CREATE OR REPLACE FUNCTION app.remove_agency_staff_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_staff_legacy_user_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public SET row_security=off AS $$
DECLARE v_user UUID;v_actor_legacy TEXT;
BEGIN
  PERFORM app.require_agency_owner_v3(p_actor_user_id,p_agency_id);
  SELECT mapping.target_id INTO v_user FROM ops.legacy_id_map mapping
  JOIN iam.agency_staff_profiles profile ON profile.agency_id=mapping.agency_id AND profile.user_id=mapping.target_id
  WHERE mapping.source_system='public-v2' AND mapping.entity_type='user' AND mapping.agency_id=p_agency_id
    AND mapping.legacy_id=p_staff_legacy_user_id AND profile.status='active';
  IF v_user IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency staff not found'; END IF;
  UPDATE iam.agency_staff_profiles SET status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id
  WHERE agency_id=p_agency_id AND user_id=v_user;
  UPDATE iam.agency_memberships SET status='revoked' WHERE agency_id=p_agency_id AND user_id=v_user AND status<>'revoked';
  DELETE FROM public.agency_memberships WHERE agency_id=p_agency_id AND user_id=p_staff_legacy_user_id;
  UPDATE iam.invitations SET used_at=COALESCE(used_at,clock_timestamp()) WHERE agency_id=p_agency_id AND invited_user_id=v_user;
  UPDATE public.user_invitations SET used_at=COALESCE(used_at,clock_timestamp()) WHERE user_id=p_staff_legacy_user_id;
  UPDATE travel.departure_staff_assignments SET status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,
    revocation_reason='personale rimosso dall’agenzia'
  WHERE agency_id=p_agency_id AND user_id=v_user AND status='active';
  IF NOT EXISTS(SELECT 1 FROM iam.agency_memberships WHERE user_id=v_user AND status IN ('active','invited'))
     AND NOT EXISTS(SELECT 1 FROM travel.traveler_profiles WHERE user_id=v_user) THEN
    UPDATE iam.users SET status='disabled',updated_at=clock_timestamp() WHERE id=v_user;
    UPDATE public.platform_users SET status='disabled',updated_at=clock_timestamp() WHERE id=p_staff_legacy_user_id;
  END IF;
  SELECT legacy_id INTO v_actor_legacy FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user'
    AND target_id=p_actor_user_id ORDER BY created_at LIMIT 1;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,p_actor_user_id,'agency_staff',p_staff_legacy_user_id,'removed',jsonb_build_object('actorLegacyId',v_actor_legacy));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.list_departure_operations_v3(
  p_actor_user_id UUID,p_departure UUID
) RETURNS TABLE(kind TEXT,id UUID,name TEXT,detail TEXT,status TEXT,day_id UUID,party_id UUID,traveler_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey SET row_security=off AS $$
DECLARE v_agency UUID;v_owner BOOLEAN;
BEGIN
  SELECT departure.agency_id,EXISTS(SELECT 1 FROM iam.agency_memberships membership
    WHERE membership.agency_id=departure.agency_id AND membership.user_id=p_actor_user_id
      AND membership.status='active' AND membership.role='owner')
  INTO v_agency,v_owner FROM travel.departures departure WHERE departure.id=p_departure;
  IF v_agency IS NULL OR NOT app.is_departure_operator_v3(p_actor_user_id,p_departure) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='departure operations not authorized';
  END IF;
  RETURN QUERY
    SELECT 'staff'::text,assignment.id,account.display_name::text,
      CASE WHEN assignment.role='tour_leader' THEN 'accompagnatore' ELSE assignment.role END::text,
      assignment.status::text,NULL::uuid,NULL::uuid,assignment.user_id
    FROM travel.departure_staff_assignments assignment JOIN iam.users account ON account.id=assignment.user_id
    WHERE assignment.agency_id=v_agency AND assignment.departure_id=p_departure AND assignment.status='active'
    UNION ALL
    SELECT 'eligible_staff'::text,profile.user_id,account.display_name::text,profile.staff_role::text,
      'active'::text,NULL::uuid,NULL::uuid,NULL::uuid
    FROM iam.agency_staff_profiles profile JOIN iam.users account ON account.id=profile.user_id
    WHERE v_owner AND profile.agency_id=v_agency AND profile.status='active' AND account.status IN ('active','invited')
    UNION ALL
    SELECT 'staff_day'::text,assignment.staff_assignment_id,day.service_date::text,'coverage'::text,
      'active'::text,assignment.departure_day_id,NULL::uuid,NULL::uuid
    FROM travel.departure_staff_day_assignments assignment JOIN travel.departure_days day ON day.id=assignment.departure_day_id
    WHERE assignment.agency_id=v_agency AND assignment.departure_id=p_departure
    UNION ALL
    SELECT 'day'::text,day.id,to_char(day.service_date,'DD/MM/YYYY'),' '::text,'active'::text,day.id,NULL::uuid,NULL::uuid
    FROM travel.departure_days day WHERE day.agency_id=v_agency AND day.departure_id=p_departure
    UNION ALL
    SELECT 'traveler'::text,membership.traveler_id,profile.display_name::text,party.name::text,membership.status::text,
      NULL::uuid,membership.party_id,membership.traveler_id
    FROM travel.party_memberships membership JOIN travel.traveler_profiles profile ON profile.id=membership.traveler_id AND profile.agency_id=membership.agency_id
    JOIN travel.travel_parties party ON party.id=membership.party_id AND party.agency_id=membership.agency_id
    WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure AND membership.status='active'
    UNION ALL
    SELECT 'attendance'::text,attendance.id,profile.display_name::text,attendance.operational_note::text,attendance.status::text,
      attendance.departure_day_id,attendance.party_id,attendance.traveler_id
    FROM journey.departure_attendance attendance JOIN travel.traveler_profiles profile ON profile.id=attendance.traveler_id AND profile.agency_id=attendance.agency_id
    WHERE attendance.agency_id=v_agency AND attendance.departure_id=p_departure
    ORDER BY 1,3;
END $$;

CREATE OR REPLACE FUNCTION app.list_my_departure_staff_v3(p_actor_user_id UUID)
RETURNS TABLE(departure_id UUID,title TEXT,agency_name TEXT,starts_on DATE,ends_on DATE,staff_role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
 SELECT departure.id,departure.title::text,agency.name::text,departure.starts_on,departure.ends_on,
   CASE WHEN assignment.role='tour_leader' THEN 'accompagnatore' ELSE assignment.role END::text
 FROM travel.departure_staff_assignments assignment
 JOIN travel.departures departure ON departure.id=assignment.departure_id AND departure.agency_id=assignment.agency_id
 JOIN iam.agencies agency ON agency.id=departure.agency_id
 WHERE assignment.user_id=p_actor_user_id AND assignment.status='active'
   AND assignment.role IN ('tour_leader','agent','accompagnatore','guida')
   AND clock_timestamp()>=assignment.valid_from AND clock_timestamp()<assignment.valid_until
   AND departure.ends_on>=current_date
 ORDER BY departure.starts_on,departure.title;
$$;

REVOKE ALL ON FUNCTION app.read_agency_staff_v3(UUID,UUID),
  app.provision_agency_staff_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.assign_departure_staff_days_v3(UUID,UUID,UUID,TEXT,UUID[]),app.remove_agency_staff_v3(UUID,UUID,TEXT),
  app.list_my_departure_staff_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_staff_v3(UUID,UUID),
  app.provision_agency_staff_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.assign_departure_staff_days_v3(UUID,UUID,UUID,TEXT,UUID[]),app.remove_agency_staff_v3(UUID,UUID,TEXT),
  app.list_my_departure_staff_v3(UUID) TO smf_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON iam.agency_staff_profiles,travel.departure_staff_day_assignments TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('174_v3_agency_staff_and_day_assignments') ON CONFLICT(version) DO NOTHING;
