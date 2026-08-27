-- Provisioning V3-first di famiglie, viaggiatori e inviti.
-- Le funzioni autorizzano l'attore su IAM e mantengono il modello V2 allineato
-- esclusivamente come contratto di compatibilita' durante il cutover.

CREATE OR REPLACE FUNCTION app.create_journey_party(
  p_actor_legacy_user_id TEXT,
  p_agency_id UUID,
  p_departure_id UUID,
  p_code TEXT,
  p_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public
SET row_security=off
AS $$
DECLARE v_actor_id UUID; v_party_id UUID;
BEGIN
  SELECT map.target_id INTO v_actor_id
  FROM ops.legacy_id_map map
  JOIN iam.users users ON users.id=map.target_id AND users.status='active'
  JOIN iam.agency_memberships membership ON membership.user_id=users.id
    AND membership.agency_id=p_agency_id AND membership.status='active'
    AND membership.role IN('owner','admin','editor')
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=p_actor_legacy_user_id;
  IF v_actor_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM travel.departures departure
    WHERE departure.id=p_departure_id AND departure.agency_id=p_agency_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='journey party provisioning denied';
  END IF;

  INSERT INTO travel.travel_parties(agency_id,departure_id,code,name,status)
  VALUES(p_agency_id,p_departure_id,p_code,btrim(p_name),'invited')
  RETURNING id INTO v_party_id;
  INSERT INTO public.travel_parties(id,agency_id,departure_id,code,name,status)
  VALUES(v_party_id,p_agency_id,p_departure_id,p_code,btrim(p_name),'invited');
  INSERT INTO public.audit_events
    (agency_id,actor_user_id,departure_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,p_actor_legacy_user_id,p_departure_id,'travel_party',
    v_party_id::text,'created','{}'::jsonb);
  RETURN v_party_id;
END $$;

CREATE OR REPLACE FUNCTION app.provision_journey_traveler(
  p_actor_legacy_user_id TEXT,
  p_agency_id UUID,
  p_party_id UUID,
  p_display_name TEXT,
  p_initials TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_birth_date DATE,
  p_role TEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(traveler_id UUID,activation_required BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public
SET row_security=off
AS $$
DECLARE
  v_actor_id UUID;
  v_user_id UUID;
  v_legacy_user_id TEXT;
  v_traveler_id UUID;
  v_legacy_traveler_id UUID;
  v_departure_id UUID;
  v_starts_on DATE;
  v_user_status TEXT;
  v_invitation_id UUID;
  v_member_type TEXT;
BEGIN
  IF p_role NOT IN('organizer','member') OR NULLIF(btrim(p_display_name),'') IS NULL
    OR NULLIF(btrim(p_email),'') IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid traveler provisioning request';
  END IF;
  SELECT map.target_id INTO v_actor_id
  FROM ops.legacy_id_map map
  JOIN iam.users users ON users.id=map.target_id AND users.status='active'
  JOIN iam.agency_memberships membership ON membership.user_id=users.id
    AND membership.agency_id=p_agency_id AND membership.status='active'
    AND membership.role IN('owner','admin','editor')
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=p_actor_legacy_user_id;
  SELECT party.departure_id,departure.starts_on INTO v_departure_id,v_starts_on
  FROM travel.travel_parties party
  JOIN travel.departures departure ON departure.id=party.departure_id
    AND departure.agency_id=party.agency_id
  WHERE party.id=p_party_id AND party.agency_id=p_agency_id;
  IF v_actor_id IS NULL OR v_departure_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler provisioning denied';
  END IF;

  SELECT users.id,users.status INTO v_user_id,v_user_status
  FROM iam.users users WHERE users.normalized_email=lower(btrim(p_email))
  FOR UPDATE;
  IF v_user_id IS NULL THEN
    INSERT INTO iam.users(display_name,email,phone,platform_role,status)
    VALUES(btrim(p_display_name),lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'user','invited')
    RETURNING id,status INTO v_user_id,v_user_status;
  ELSE
    UPDATE iam.users SET display_name=btrim(p_display_name),
      phone=COALESCE(NULLIF(btrim(p_phone),''),phone),updated_at=clock_timestamp()
    WHERE id=v_user_id;
  END IF;

  SELECT map.legacy_id INTO v_legacy_user_id FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=v_user_id;
  IF v_legacy_user_id IS NULL THEN
    v_legacy_user_id:='traveler:'||gen_random_uuid()::text;
    INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,target_id,agency_id)
    VALUES('public-v2','user',v_legacy_user_id,v_user_id,p_agency_id);
  END IF;
  INSERT INTO public.platform_users
    (id,display_name,initials,email,phone,auth_provider,platform_role,status)
  VALUES(v_legacy_user_id,btrim(p_display_name),left(p_initials,8),lower(btrim(p_email)),
    NULLIF(btrim(p_phone),''),'neon','user',v_user_status)
  ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,
    initials=EXCLUDED.initials,email=EXCLUDED.email,
    phone=COALESCE(EXCLUDED.phone,public.platform_users.phone),updated_at=clock_timestamp();

  INSERT INTO travel.traveler_profiles
    (agency_id,user_id,display_name,email,phone,birth_date)
  VALUES(p_agency_id,v_user_id,btrim(p_display_name),lower(btrim(p_email)),
    NULLIF(btrim(p_phone),''),p_birth_date)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET display_name=EXCLUDED.display_name,
    email=EXCLUDED.email,phone=EXCLUDED.phone,
    birth_date=COALESCE(EXCLUDED.birth_date,travel.traveler_profiles.birth_date),
    updated_at=clock_timestamp()
  RETURNING id INTO v_traveler_id;
  INSERT INTO public.traveler_profiles
    (id,agency_id,user_id,display_name,email,phone,birth_date)
  VALUES(v_traveler_id,p_agency_id,v_legacy_user_id,btrim(p_display_name),
    lower(btrim(p_email)),NULLIF(btrim(p_phone),''),p_birth_date)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET display_name=EXCLUDED.display_name,
    email=EXCLUDED.email,phone=EXCLUDED.phone,
    birth_date=COALESCE(EXCLUDED.birth_date,public.traveler_profiles.birth_date),
    updated_at=clock_timestamp()
  RETURNING id INTO v_legacy_traveler_id;
  IF v_legacy_traveler_id<>v_traveler_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='traveler identity drift detected';
  END IF;

  v_member_type:=CASE WHEN p_role<>'organizer' AND p_birth_date IS NOT NULL
    AND p_birth_date>(v_starts_on-interval '18 years')::date
    THEN 'dependent_minor' ELSE 'adult' END;
  INSERT INTO travel.party_memberships
    (agency_id,departure_id,party_id,traveler_id,role,member_type,status)
  VALUES(p_agency_id,v_departure_id,p_party_id,v_traveler_id,p_role,v_member_type,
    CASE WHEN v_user_status='active' THEN 'active' ELSE 'invited' END)
  ON CONFLICT(party_id,traveler_id) DO UPDATE SET role=EXCLUDED.role,
    member_type=EXCLUDED.member_type,status=EXCLUDED.status;
  INSERT INTO public.party_memberships(agency_id,party_id,traveler_id,role,status)
  VALUES(p_agency_id,p_party_id,v_traveler_id,p_role,
    CASE WHEN v_user_status='active' THEN 'active' ELSE 'invited' END)
  ON CONFLICT(party_id,traveler_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status;

  IF v_user_status<>'active' THEN
    UPDATE iam.invitations SET used_at=clock_timestamp()
    WHERE invited_user_id=v_user_id AND used_at IS NULL;
    UPDATE public.user_invitations SET used_at=clock_timestamp()
    WHERE user_id=v_legacy_user_id AND used_at IS NULL;
    INSERT INTO iam.invitations
      (agency_id,invited_user_id,created_by_user_id,token_hash,expires_at)
    VALUES(p_agency_id,v_user_id,v_actor_id,p_token_hash,p_expires_at)
    RETURNING id INTO v_invitation_id;
    INSERT INTO public.user_invitations
      (id,user_id,created_by_user_id,token_hash,expires_at)
    VALUES(v_invitation_id,v_legacy_user_id,p_actor_legacy_user_id,p_token_hash,p_expires_at);
  END IF;
  RETURN QUERY SELECT v_traveler_id,v_user_status<>'active';
END $$;

REVOKE ALL ON FUNCTION app.create_journey_party(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.provision_journey_traveler(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_journey_party(TEXT,UUID,UUID,TEXT,TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.provision_journey_traveler(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('039_v3_journey_participant_provisioning') ON CONFLICT(version) DO NOTHING;
