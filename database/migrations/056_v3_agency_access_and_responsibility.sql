-- Agency access, responsible ownership and superadmin acceptance-test hardening.
-- This migration is additive: consolidated migrations 001-055 remain immutable.

CREATE UNIQUE INDEX IF NOT EXISTS agency_memberships_single_owner_uidx
  ON iam.agency_memberships (agency_id)
  WHERE role='owner' AND status<>'revoked';

CREATE OR REPLACE FUNCTION app.read_username_login_state(p_username TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,iam,travel
SET row_security=off
AS $$
  WITH candidate AS (
    SELECT users.id,users.status,users.platform_role,
      EXISTS(SELECT 1 FROM iam.user_identities identity
        WHERE identity.user_id=users.id AND identity.provider='cognito') AS has_identity
    FROM iam.users users
    WHERE users.normalized_username=lower(btrim(p_username))
  ),scoped_agencies AS (
    SELECT membership.agency_id
    FROM candidate JOIN iam.agency_memberships membership ON membership.user_id=candidate.id
    WHERE membership.status IN('invited','active')
    UNION
    SELECT profile.agency_id
    FROM candidate
    JOIN travel.traveler_profiles profile ON profile.user_id=candidate.id
    JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
      AND membership.traveler_id=profile.id AND membership.status IN('invited','active')
  )
  SELECT CASE
    WHEN NOT EXISTS(SELECT 1 FROM candidate) THEN 'unknown'
    WHEN EXISTS(SELECT 1 FROM candidate WHERE status='invited' OR NOT has_identity) THEN 'invited'
    WHEN EXISTS(SELECT 1 FROM candidate WHERE status IN('disabled','anonymized')) THEN 'disabled'
    WHEN EXISTS(SELECT 1 FROM candidate WHERE platform_role='superadmin' AND status='active') THEN 'active'
    WHEN EXISTS(SELECT 1 FROM scoped_agencies scope
      JOIN iam.agencies agency ON agency.id=scope.agency_id
      WHERE agency.status IN('trial','active')) THEN 'active'
    WHEN EXISTS(SELECT 1 FROM scoped_agencies) THEN 'disabled_agency'
    ELSE 'unassigned'
  END
$$;

CREATE OR REPLACE FUNCTION app.resolve_cognito_authenticated_user(p_subject TEXT)
RETURNS TABLE(
  legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops
SET row_security=off
AS $$
  SELECT map.legacy_id::text,users.display_name::text,users.username::text,
    COALESCE(users.email,'')::text,users.platform_role::text,
    EXISTS(
      SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id
        AND agency.status IN('trial','active')
      WHERE membership.user_id=users.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor')
    )::boolean
  FROM iam.user_identities identity
  JOIN iam.users users ON users.id=identity.user_id AND users.status='active'
  JOIN ops.legacy_id_map map ON map.source_system='public-v2'
    AND map.entity_type='user' AND map.target_id=users.id
  WHERE identity.provider='cognito' AND identity.subject=p_subject
    AND (
      users.platform_role='superadmin'
      OR EXISTS(
        SELECT 1 FROM iam.agency_memberships membership
        JOIN iam.agencies agency ON agency.id=membership.agency_id
          AND agency.status IN('trial','active')
        WHERE membership.user_id=users.id AND membership.status='active'
      )
      OR EXISTS(
        SELECT 1 FROM travel.traveler_profiles profile
        JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
          AND membership.traveler_id=profile.id AND membership.status='active'
        JOIN iam.agencies agency ON agency.id=profile.agency_id
          AND agency.status IN('trial','active')
        WHERE profile.user_id=users.id
      )
    )
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.provision_platform_agency_agent(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_display_name TEXT,p_initials TEXT,
  p_username TEXT,p_email TEXT,p_phone TEXT,p_role TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public
SET row_security=off
AS $$
DECLARE
  v_actor_id UUID;v_user_id UUID;v_legacy_user_id TEXT;v_status TEXT;v_invitation_id UUID;
BEGIN
  SELECT map.target_id INTO v_actor_id FROM ops.legacy_id_map map
  JOIN iam.users actor ON actor.id=map.target_id
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=p_actor_legacy_user_id AND actor.status='active'
    AND actor.platform_role='superadmin';
  IF v_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM iam.agencies
      WHERE id=p_agency_id AND status IN('trial','active','suspended'))
    OR p_role NOT IN('owner','admin','editor','viewer')
    OR btrim(p_username) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
    OR NULLIF(btrim(p_email),'') IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid agency agent provisioning request';
  END IF;

  SELECT id,status INTO v_user_id,v_status FROM iam.users
  WHERE normalized_username=lower(btrim(p_username)) FOR UPDATE;
  IF v_user_id IS NULL THEN
    INSERT INTO iam.users(username,display_name,email,phone,platform_role,status)
    VALUES(btrim(p_username),btrim(p_display_name),lower(btrim(p_email)),
      NULLIF(btrim(p_phone),''),'user','invited')
    RETURNING id,status INTO v_user_id,v_status;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=v_user_id
      AND normalized_email=lower(btrim(p_email))) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned';
    END IF;
    UPDATE iam.users SET display_name=btrim(p_display_name),
      phone=COALESCE(NULLIF(btrim(p_phone),''),phone),updated_at=clock_timestamp()
    WHERE id=v_user_id;
  END IF;

  SELECT map.legacy_id INTO v_legacy_user_id FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=v_user_id;
  IF v_legacy_user_id IS NULL THEN
    v_legacy_user_id:='agent:'||gen_random_uuid()::text;
    INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,target_id,agency_id)
    VALUES('public-v2','user',v_legacy_user_id,v_user_id,p_agency_id);
  END IF;

  INSERT INTO public.platform_users(id,username,display_name,initials,email,phone,auth_provider,platform_role,status)
  VALUES(v_legacy_user_id,btrim(p_username),btrim(p_display_name),left(p_initials,8),
    lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'cognito','user',v_status)
  ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,
    initials=EXCLUDED.initials,email=EXCLUDED.email,
    phone=COALESCE(EXCLUDED.phone,public.platform_users.phone),updated_at=clock_timestamp();
  INSERT INTO iam.agency_memberships(agency_id,user_id,role,status)
  VALUES(p_agency_id,v_user_id,p_role,CASE WHEN v_status='active' THEN 'active' ELSE 'invited' END)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status;
  INSERT INTO public.agency_memberships(agency_id,user_id,role)
  VALUES(p_agency_id,v_legacy_user_id,p_role)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET role=EXCLUDED.role;

  IF v_status<>'active' THEN
    UPDATE iam.invitations SET used_at=clock_timestamp()
    WHERE invited_user_id=v_user_id AND used_at IS NULL;
    UPDATE public.user_invitations SET used_at=clock_timestamp()
    WHERE user_id=v_legacy_user_id AND used_at IS NULL;
    INSERT INTO iam.invitations(agency_id,invited_user_id,created_by_user_id,token_hash,expires_at)
    VALUES(p_agency_id,v_user_id,v_actor_id,p_token_hash,p_expires_at)
    RETURNING id INTO v_invitation_id;
    INSERT INTO public.user_invitations(id,user_id,created_by_user_id,token_hash,expires_at)
    VALUES(v_invitation_id,v_legacy_user_id,p_actor_legacy_user_id,p_token_hash,p_expires_at);
  END IF;
  RETURN QUERY SELECT v_legacy_user_id,v_status<>'active';
END $$;

CREATE OR REPLACE FUNCTION app.create_platform_agency_with_owner(
  p_actor_legacy_user_id TEXT,p_payload JSONB,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(agency_id UUID,legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public SET row_security=off AS $$
DECLARE v_agency_id UUID;v_owner RECORD;
BEGIN
  v_agency_id:=app.create_platform_agency(p_actor_legacy_user_id,p_payload->>'slug',p_payload->>'name',
    COALESCE(p_payload->>'legalName',''),COALESCE(p_payload->>'vatNumber',''),COALESCE(p_payload->>'taxCode',''),
    COALESCE(p_payload->>'registeredAddress',''),COALESCE(p_payload->>'registeredCity',''),
    COALESCE(p_payload->>'registeredPostalCode',''),COALESCE(p_payload->>'registeredProvince',''),
    COALESCE(p_payload->>'registeredCountry',''),COALESCE(p_payload->>'pec',''),
    COALESCE(p_payload->>'sdiCode',''),COALESCE(p_payload->>'phone',''),COALESCE(p_payload->>'email',''),
    COALESCE(p_payload->>'website',''),p_payload->>'referenceName',p_payload->>'referenceEmail',
    p_payload->>'referencePhone',COALESCE(p_payload->'branding','{}'::jsonb));
  SELECT * INTO v_owner FROM app.provision_platform_agency_agent(p_actor_legacy_user_id,v_agency_id,
    p_payload->>'referenceName',COALESCE(p_payload->>'referenceInitials',''),p_payload->>'referenceUsername',
    p_payload->>'referenceEmail',p_payload->>'referencePhone','owner',p_token_hash,p_expires_at);
  RETURN QUERY SELECT v_agency_id,v_owner.legacy_user_id,v_owner.activation_required;
END $$;

CREATE OR REPLACE FUNCTION app.replace_platform_agency_owner(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_display_name TEXT,p_initials TEXT,
  p_username TEXT,p_email TEXT,p_phone TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(legacy_user_id TEXT,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public SET row_security=off AS $$
DECLARE v_owner RECORD;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id AND actor.status='active'
      AND actor.platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner replacement denied';
  END IF;
  UPDATE iam.agency_memberships SET status='revoked'
  WHERE agency_id=p_agency_id AND role='owner' AND status<>'revoked';
  DELETE FROM public.agency_memberships legacy
  USING ops.legacy_id_map map
  WHERE legacy.agency_id=p_agency_id AND legacy.role='owner'
    AND map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=legacy.user_id;
  UPDATE iam.agencies SET reference_name=btrim(p_display_name),reference_email=lower(btrim(p_email)),
    reference_phone=btrim(p_phone),updated_at=clock_timestamp() WHERE id=p_agency_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  UPDATE public.agencies SET reference_name=btrim(p_display_name),reference_email=lower(btrim(p_email)),
    reference_phone=btrim(p_phone),updated_at=clock_timestamp() WHERE id=p_agency_id;
  SELECT * INTO v_owner FROM app.provision_platform_agency_agent(p_actor_legacy_user_id,p_agency_id,
    p_display_name,p_initials,p_username,p_email,p_phone,'owner',p_token_hash,p_expires_at);
  RETURN QUERY SELECT v_owner.legacy_user_id,v_owner.activation_required;
END $$;

CREATE OR REPLACE FUNCTION app.update_platform_agency_status(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_status TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public SET row_security=off AS $$
BEGIN
  IF p_status NOT IN('trial','active','suspended') OR NOT EXISTS(
    SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id AND actor.status='active'
      AND actor.platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency status update denied';
  END IF;
  UPDATE iam.agencies SET status=p_status,updated_at=clock_timestamp()
  WHERE id=p_agency_id AND status NOT IN('deleting','closed');
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.agencies SET status=p_status,updated_at=clock_timestamp() WHERE id=p_agency_id;
  RETURN true;
END $$;

DROP FUNCTION app.read_superadmin_agency_registry(TEXT);
CREATE FUNCTION app.read_superadmin_agency_registry(p_actor_legacy_user_id TEXT)
RETURNS TABLE(
  agency_id UUID,slug TEXT,agency_name TEXT,agency_status TEXT,legal_name TEXT,
  vat_number TEXT,tax_code TEXT,registered_address TEXT,registered_city TEXT,
  registered_postal_code TEXT,registered_province TEXT,registered_country TEXT,
  pec TEXT,sdi_code TEXT,agency_phone TEXT,agency_email TEXT,website TEXT,
  reference_name TEXT,reference_email TEXT,reference_phone TEXT,branding JSONB,
  trip_count INTEGER,traveler_count INTEGER,ongoing_trip_count INTEGER,upcoming_trip_count INTEGER,
  agent_id TEXT,agent_name TEXT,agent_username TEXT,agent_email TEXT,agent_phone TEXT,
  agent_role TEXT,agent_status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  WITH authorized AS(
    SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id AND actor.status='active' AND actor.platform_role='superadmin'
  ),trip_counts AS(
    SELECT agency_id,count(*)::integer count FROM travel.trip_templates GROUP BY agency_id
  ),traveler_counts AS(
    SELECT agency_id,count(*)::integer count FROM travel.traveler_profiles GROUP BY agency_id
  ),departure_counts AS(
    SELECT agency_id,
      count(*) FILTER(WHERE starts_on<=current_date AND ends_on>=current_date
        AND status NOT IN('cancelled','archived'))::integer ongoing,
      count(*) FILTER(WHERE starts_on>current_date
        AND status NOT IN('cancelled','archived'))::integer upcoming
    FROM travel.departures GROUP BY agency_id
  )
  SELECT agency.id,agency.slug,agency.name,agency.status,COALESCE(agency.legal_name,''),
    COALESCE(agency.vat_number,''),COALESCE(agency.tax_code,''),COALESCE(agency.registered_address,''),
    COALESCE(agency.registered_city,''),COALESCE(agency.registered_postal_code,''),
    COALESCE(agency.registered_province,''),COALESCE(agency.registered_country_code,''),
    COALESCE(agency.pec,''),COALESCE(agency.sdi_code,''),COALESCE(agency.phone,''),
    COALESCE(agency.email,''),COALESCE(agency.website,''),agency.reference_name,
    COALESCE(agency.reference_email,''),COALESCE(agency.reference_phone,''),agency.branding,
    COALESCE(trips.count,0),COALESCE(travelers.count,0),COALESCE(departures.ongoing,0),
    COALESCE(departures.upcoming,0),agent_map.legacy_id,agent.display_name,
    COALESCE(agent.username,''),COALESCE(agent.email,''),COALESCE(agent.phone,''),membership.role,agent.status
  FROM authorized CROSS JOIN iam.agencies agency
  LEFT JOIN trip_counts trips ON trips.agency_id=agency.id
  LEFT JOIN traveler_counts travelers ON travelers.agency_id=agency.id
  LEFT JOIN departure_counts departures ON departures.agency_id=agency.id
  LEFT JOIN iam.agency_memberships membership ON membership.agency_id=agency.id AND membership.status<>'revoked'
  LEFT JOIN iam.users agent ON agent.id=membership.user_id
  LEFT JOIN ops.legacy_id_map agent_map ON agent_map.target_id=agent.id
    AND agent_map.source_system='public-v2' AND agent_map.entity_type='user'
  ORDER BY agency.name,agent.display_name
$$;

DROP FUNCTION app.read_superadmin_impersonation_users(TEXT);
CREATE FUNCTION app.read_superadmin_impersonation_users(p_actor_legacy_user_id TEXT)
RETURNS TABLE(
  legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT,phone TEXT,user_status TEXT,
  platform_role TEXT,agency_names TEXT[],agency_roles TEXT[],is_traveler BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  WITH actor_identity AS(
    SELECT actor.id FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id
      AND actor.status='active' AND actor.platform_role='superadmin'
  )
  SELECT user_map.legacy_id,users.display_name,users.username,COALESCE(users.email,''),
    COALESCE(users.phone,''),users.status,users.platform_role,
    COALESCE(array_agg(DISTINCT agency.name) FILTER(WHERE agency.id IS NOT NULL),ARRAY[]::text[]),
    COALESCE(array_agg(DISTINCT membership.role) FILTER(WHERE membership.role IS NOT NULL),ARRAY[]::text[]),
    EXISTS(SELECT 1 FROM travel.traveler_profiles traveler WHERE traveler.user_id=users.id)
  FROM actor_identity actor CROSS JOIN iam.users users
  JOIN ops.legacy_id_map user_map ON user_map.target_id=users.id
    AND user_map.source_system='public-v2' AND user_map.entity_type='user'
  LEFT JOIN iam.agency_memberships membership ON membership.user_id=users.id AND membership.status<>'revoked'
  LEFT JOIN iam.agencies agency ON agency.id=membership.agency_id
  WHERE users.id<>actor.id AND users.status NOT IN('disabled','anonymized')
  GROUP BY user_map.legacy_id,users.id
  ORDER BY users.display_name,users.username
$$;

REVOKE ALL ON FUNCTION app.read_username_login_state(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_cognito_authenticated_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_platform_agency_with_owner(TEXT,JSONB,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.replace_platform_agency_owner(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_platform_agency_status(TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_superadmin_agency_registry(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_superadmin_impersonation_users(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_username_login_state(TEXT),
  app.resolve_cognito_authenticated_user(TEXT),
  app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.create_platform_agency_with_owner(TEXT,JSONB,TEXT,TIMESTAMPTZ),
  app.replace_platform_agency_owner(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  app.update_platform_agency_status(TEXT,UUID,TEXT),
  app.read_superadmin_agency_registry(TEXT),
  app.read_superadmin_impersonation_users(TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('056_v3_agency_access_and_responsibility') ON CONFLICT(version) DO NOTHING;
