-- Introduce username as the stable login identifier.
-- Email remains a contact and recovery address and is deliberately non-unique:
-- separate travelers may therefore share the same family mailbox.

ALTER TABLE iam.users
  ADD COLUMN IF NOT EXISTS username VARCHAR(80),
  ADD COLUMN IF NOT EXISTS normalized_username TEXT
    GENERATED ALWAYS AS (lower(btrim(username))) STORED;

WITH candidates AS (
  SELECT id,
    CASE
      WHEN length(regexp_replace(
        regexp_replace(lower(split_part(COALESCE(email,''),'@',1)),
          '[^a-z0-9._-]+','_','g'),
        '^[^a-z0-9]+','','g'))>=3
      THEN left(regexp_replace(
        regexp_replace(lower(split_part(email,'@',1)),'[^a-z0-9._-]+','_','g'),
        '^[^a-z0-9]+','','g'),68)
      ELSE 'user_'||substr(replace(id::text,'-',''),1,24)
    END AS base
  FROM iam.users WHERE username IS NULL
), ranked AS (
  SELECT id,base,row_number() OVER(PARTITION BY base ORDER BY id) AS occurrence
  FROM candidates
)
UPDATE iam.users users
SET username=ranked.base||CASE WHEN ranked.occurrence=1 THEN '' ELSE '_'||ranked.occurrence::text END
FROM ranked WHERE ranked.id=users.id;

ALTER TABLE iam.users
  ALTER COLUMN username SET NOT NULL;

ALTER TABLE iam.users
  DROP CONSTRAINT IF EXISTS users_normalized_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_username_uidx
  ON iam.users(normalized_username);

ALTER TABLE iam.users
  DROP CONSTRAINT IF EXISTS users_username_format_ck;
ALTER TABLE iam.users
  ADD CONSTRAINT users_username_format_ck
  CHECK (username = btrim(username)
    AND username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$');

-- V2 remains a read-compatible projection during cutover, but must not restore
-- the old one-account-per-email restriction.
ALTER TABLE public.platform_users
  ADD COLUMN IF NOT EXISTS username VARCHAR(80),
  ADD COLUMN IF NOT EXISTS normalized_username TEXT
    GENERATED ALWAYS AS (lower(btrim(username))) STORED;

UPDATE public.platform_users legacy
SET username = users.username
FROM ops.legacy_id_map map
JOIN iam.users users ON users.id=map.target_id
WHERE map.source_system='public-v2' AND map.entity_type='user'
  AND map.legacy_id=legacy.id AND legacy.username IS NULL;

UPDATE public.platform_users
SET username = 'legacy_' || substr(md5(id),1,24)
WHERE username IS NULL;

ALTER TABLE public.platform_users
  ALTER COLUMN username SET NOT NULL,
  DROP CONSTRAINT IF EXISTS platform_users_normalized_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS platform_users_normalized_username_uidx
  ON public.platform_users(normalized_username);

CREATE OR REPLACE FUNCTION app.provision_journey_traveler(
  p_actor_legacy_user_id TEXT,
  p_agency_id UUID,
  p_party_id UUID,
  p_display_name TEXT,
  p_initials TEXT,
  p_username TEXT,
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
  v_normalized_username TEXT:=lower(btrim(p_username));
BEGIN
  IF p_role NOT IN('organizer','member') OR NULLIF(btrim(p_display_name),'') IS NULL
    OR p_username IS NULL OR btrim(p_username) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
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
  FROM iam.users users WHERE users.normalized_username=v_normalized_username
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    INSERT INTO iam.users(username,display_name,email,phone,platform_role,status)
    VALUES(btrim(p_username),btrim(p_display_name),lower(btrim(p_email)),
      NULLIF(btrim(p_phone),''),'user','invited')
    RETURNING id,status INTO v_user_id,v_user_status;
  ELSE
    IF NOT EXISTS(
      SELECT 1 FROM iam.users users
      WHERE users.id=v_user_id AND users.normalized_email=lower(btrim(p_email))
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='username already assigned';
    END IF;
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
    (id,username,display_name,initials,email,phone,auth_provider,platform_role,status)
  VALUES(v_legacy_user_id,btrim(p_username),btrim(p_display_name),left(p_initials,8),
    lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'cognito','user',v_user_status)
  ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,
    display_name=EXCLUDED.display_name,initials=EXCLUDED.initials,email=EXCLUDED.email,
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

DROP FUNCTION app.inspect_account_invitation(TEXT);
CREATE FUNCTION app.inspect_account_invitation(p_token_hash TEXT)
RETURNS TABLE(display_name TEXT,username TEXT,email TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,iam
SET row_security=off
AS $$
  SELECT users.display_name::text,users.username::text,users.email::text
  FROM iam.invitations invitation
  JOIN iam.users users ON users.id=invitation.invited_user_id
  WHERE invitation.token_hash=p_token_hash
    AND invitation.used_at IS NULL
    AND invitation.expires_at>clock_timestamp()
    AND users.status IN('invited','active')
    AND NOT EXISTS(SELECT 1 FROM iam.user_identities identity
      WHERE identity.user_id=users.id AND identity.provider='cognito')
  LIMIT 1
$$;

-- The third parameter is now the immutable username, not the contact email.
-- The external subject must belong to the account created for this exact invite.
DROP FUNCTION app.activate_account_invitation(TEXT,TEXT,TEXT);
CREATE FUNCTION app.activate_account_invitation(
  p_token_hash TEXT,
  p_subject TEXT,
  p_username TEXT
)
RETURNS TABLE(legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public
SET row_security=off
AS $$
DECLARE
  v_invitation_id UUID;
  v_user_id UUID;
  v_display_name TEXT;
  v_username TEXT;
  v_email TEXT;
  v_legacy_user_id TEXT;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR NULLIF(btrim(p_subject),'') IS NULL
    OR NULLIF(btrim(p_username),'') IS NULL THEN RETURN; END IF;

  SELECT invitation.id,users.id,users.display_name,users.username,users.email
  INTO v_invitation_id,v_user_id,v_display_name,v_username,v_email
  FROM iam.invitations invitation
  JOIN iam.users users ON users.id=invitation.invited_user_id
  WHERE invitation.token_hash=p_token_hash AND invitation.used_at IS NULL
    AND invitation.expires_at>clock_timestamp() AND users.status IN('invited','active')
    AND NOT EXISTS(SELECT 1 FROM iam.user_identities identity
      WHERE identity.user_id=users.id AND identity.provider='cognito')
  FOR UPDATE OF invitation,users;

  IF v_invitation_id IS NULL OR lower(btrim(p_username))<>lower(btrim(v_username)) THEN
    RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM iam.user_identities identity
    WHERE identity.provider='cognito' AND identity.subject=p_subject
      AND identity.user_id<>v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='authentication subject already assigned';
  END IF;

  DELETE FROM iam.user_identities
  WHERE user_id=v_user_id AND provider='cognito' AND subject<>p_subject;
  INSERT INTO iam.user_identities(user_id,provider,subject)
  VALUES(v_user_id,'cognito',p_subject)
  ON CONFLICT(provider,subject) DO UPDATE SET user_id=EXCLUDED.user_id;
  DELETE FROM iam.user_identities
  WHERE user_id=v_user_id AND provider<>'cognito';

  UPDATE iam.users SET status='active',updated_at=clock_timestamp() WHERE id=v_user_id;
  UPDATE iam.invitations SET used_at=clock_timestamp() WHERE id=v_invitation_id;
  UPDATE iam.agency_memberships SET status='active'
  WHERE user_id=v_user_id AND status='invited';
  UPDATE travel.party_memberships membership SET status='active'
  FROM travel.traveler_profiles traveler
  WHERE traveler.user_id=v_user_id AND membership.agency_id=traveler.agency_id
    AND membership.traveler_id=traveler.id AND membership.status='invited';

  SELECT map.legacy_id INTO v_legacy_user_id FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=v_user_id
  LIMIT 1;
  IF v_legacy_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='legacy identity mapping missing';
  END IF;

  UPDATE public.platform_users SET auth_provider='cognito',auth_subject=p_subject,
    username=v_username,status='active',updated_at=clock_timestamp()
  WHERE id=v_legacy_user_id;
  UPDATE public.user_invitations SET used_at=clock_timestamp()
  WHERE id=v_invitation_id AND used_at IS NULL;
  UPDATE public.party_memberships SET status='active'
  WHERE traveler_id IN(SELECT id FROM public.traveler_profiles WHERE user_id=v_legacy_user_id)
    AND status='invited';

  RETURN QUERY SELECT v_legacy_user_id,v_display_name,v_username,v_email;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_cognito_authenticated_user(p_subject TEXT)
RETURNS TABLE(
  legacy_user_id TEXT,
  display_name TEXT,
  username TEXT,
  email TEXT,
  platform_role TEXT,
  is_agency_admin BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,iam,ops
SET row_security=off
AS $$
  SELECT map.legacy_id::text,users.display_name::text,users.username::text,
    COALESCE(users.email,'')::text,users.platform_role::text,
    EXISTS(
      SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.status='active'
        AND membership.role IN ('owner','admin','editor')
    )::boolean
  FROM iam.user_identities identity
  JOIN iam.users users ON users.id=identity.user_id AND users.status='active'
  JOIN ops.legacy_id_map map ON map.source_system='public-v2'
    AND map.entity_type='user' AND map.target_id=users.id
  WHERE identity.provider='cognito' AND identity.subject=p_subject
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
  IF v_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM iam.agencies WHERE id=p_agency_id)
    OR p_role NOT IN('admin','editor','viewer')
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

DROP FUNCTION app.read_journey_management(TEXT,UUID);
CREATE FUNCTION app.read_journey_management(p_actor_legacy_user_id TEXT,p_departure_id UUID)
RETURNS TABLE(
  departure_id UUID,agency_id UUID,title TEXT,code TEXT,starts_on DATE,ends_on DATE,
  departure_status TEXT,agency_name TEXT,destination_country TEXT,
  party_id UUID,party_name TEXT,party_code TEXT,party_status TEXT,
  traveler_id UUID,traveler_name TEXT,traveler_username TEXT,traveler_email TEXT,traveler_phone TEXT,
  membership_role TEXT,membership_status TEXT,user_status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ref,ops SET row_security=off AS $$
  SELECT departure.id,departure.agency_id,departure.title,departure.code,
    departure.starts_on,departure.ends_on,departure.status,agency.name,
    COALESCE(country.name,''),party.id,party.name,party.code,party.status,
    traveler.id,traveler.display_name,COALESCE(users.username,''),COALESCE(traveler.email,''),
    COALESCE(traveler.phone,''),membership.role,membership.status,users.status
  FROM travel.departures departure
  JOIN iam.agencies agency ON agency.id=departure.agency_id
  JOIN travel.trip_templates template ON template.id=departure.template_id AND template.agency_id=departure.agency_id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  JOIN iam.agency_memberships actor_membership ON actor_membership.agency_id=departure.agency_id
    AND actor_membership.status='active' AND actor_membership.role IN('owner','admin','editor')
  JOIN ops.legacy_id_map actor_map ON actor_map.target_id=actor_membership.user_id
    AND actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
  JOIN iam.users actor ON actor.id=actor_membership.user_id AND actor.status='active'
  LEFT JOIN travel.travel_parties party ON party.departure_id=departure.id
  LEFT JOIN travel.party_memberships membership ON membership.party_id=party.id AND membership.status<>'removed'
  LEFT JOIN travel.traveler_profiles traveler ON traveler.id=membership.traveler_id AND traveler.agency_id=departure.agency_id
  LEFT JOIN iam.users users ON users.id=traveler.user_id
  WHERE departure.id=p_departure_id
  ORDER BY party.name,membership.role,traveler.display_name
$$;

DROP FUNCTION app.read_superadmin_agency_registry(TEXT);
CREATE FUNCTION app.read_superadmin_agency_registry(p_actor_legacy_user_id TEXT)
RETURNS TABLE(
  agency_id UUID,slug TEXT,agency_name TEXT,agency_status TEXT,legal_name TEXT,
  vat_number TEXT,tax_code TEXT,registered_address TEXT,registered_city TEXT,
  registered_postal_code TEXT,registered_province TEXT,registered_country TEXT,
  pec TEXT,sdi_code TEXT,agency_phone TEXT,agency_email TEXT,website TEXT,
  reference_name TEXT,reference_email TEXT,reference_phone TEXT,branding JSONB,
  trip_count INTEGER,traveler_count INTEGER,agent_id TEXT,agent_name TEXT,
  agent_username TEXT,agent_email TEXT,agent_phone TEXT,agent_role TEXT,agent_status TEXT
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
  )
  SELECT agency.id,agency.slug,agency.name,agency.status,COALESCE(agency.legal_name,''),
    COALESCE(agency.vat_number,''),COALESCE(agency.tax_code,''),COALESCE(agency.registered_address,''),
    COALESCE(agency.registered_city,''),COALESCE(agency.registered_postal_code,''),
    COALESCE(agency.registered_province,''),COALESCE(agency.registered_country_code,''),
    COALESCE(agency.pec,''),COALESCE(agency.sdi_code,''),COALESCE(agency.phone,''),
    COALESCE(agency.email,''),COALESCE(agency.website,''),agency.reference_name,
    COALESCE(agency.reference_email,''),COALESCE(agency.reference_phone,''),agency.branding,
    COALESCE(trips.count,0),COALESCE(travelers.count,0),agent_map.legacy_id,agent.display_name,
    COALESCE(agent.username,''),COALESCE(agent.email,''),COALESCE(agent.phone,''),membership.role,agent.status
  FROM authorized CROSS JOIN iam.agencies agency
  LEFT JOIN trip_counts trips ON trips.agency_id=agency.id
  LEFT JOIN traveler_counts travelers ON travelers.agency_id=agency.id
  LEFT JOIN iam.agency_memberships membership ON membership.agency_id=agency.id AND membership.status<>'revoked'
  LEFT JOIN iam.users agent ON agent.id=membership.user_id
  LEFT JOIN ops.legacy_id_map agent_map ON agent_map.target_id=agent.id
    AND agent_map.source_system='public-v2' AND agent_map.entity_type='user'
  ORDER BY agency.name,agent.display_name
$$;

REVOKE ALL ON FUNCTION app.provision_journey_traveler(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.inspect_account_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.activate_account_invitation(TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_cognito_authenticated_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_journey_management(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_superadmin_agency_registry(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provision_journey_traveler(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;
GRANT EXECUTE ON FUNCTION app.inspect_account_invitation(TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.activate_account_invitation(TEXT,TEXT,TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.resolve_cognito_authenticated_user(TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.provision_platform_agency_agent(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;
GRANT EXECUTE ON FUNCTION app.read_journey_management(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.read_superadmin_agency_registry(TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('055_v3_username_identity_foundation') ON CONFLICT(version) DO NOTHING;
