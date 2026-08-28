-- Completa il cutover V3 di viaggiatori e documenti privati di gruppo.

CREATE OR REPLACE FUNCTION app.provision_journey_traveler(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_party_id UUID,
  p_display_name TEXT,p_initials TEXT,p_username TEXT,p_email TEXT,p_phone TEXT,
  p_birth_date DATE,p_role TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(traveler_id UUID,activation_required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE
  v_actor_id UUID;v_user_id UUID;v_legacy_user_id TEXT;v_traveler_id UUID;
  v_departure_id UUID;v_starts_on DATE;v_user_status TEXT;v_invitation_id UUID;
  v_member_type TEXT;v_normalized_username TEXT:=lower(btrim(p_username));
BEGIN
  IF p_role NOT IN('organizer','member') OR NULLIF(btrim(p_display_name),'') IS NULL
    OR p_username IS NULL OR btrim(p_username) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'
    OR NULLIF(btrim(p_email),'') IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid traveler provisioning request';
  END IF;

  v_actor_id:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  SELECT party.departure_id,departure.starts_on INTO v_departure_id,v_starts_on
  FROM travel.travel_parties party
  JOIN travel.departures departure ON departure.id=party.departure_id
    AND departure.agency_id=party.agency_id
  WHERE party.id=p_party_id AND party.agency_id=p_agency_id AND party.status<>'archived';
  IF v_departure_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey group not found';
  END IF;

  SELECT users.id,users.status INTO v_user_id,v_user_status
  FROM iam.users users WHERE users.normalized_username=v_normalized_username FOR UPDATE;
  IF v_user_id IS NULL THEN
    INSERT INTO iam.users(username,display_name,email,phone,platform_role,status)
    VALUES(btrim(p_username),btrim(p_display_name),lower(btrim(p_email)),
      NULLIF(btrim(p_phone),''),'user','invited')
    RETURNING id,status INTO v_user_id,v_user_status;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM iam.users users WHERE users.id=v_user_id
      AND users.normalized_email=lower(btrim(p_email))) THEN
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

  -- Proiezione minima ancora necessaria al resolver di sessione Cognito.
  INSERT INTO public.platform_users
    (id,username,display_name,initials,email,phone,auth_provider,platform_role,status)
  VALUES(v_legacy_user_id,btrim(p_username),btrim(p_display_name),left(p_initials,8),
    lower(btrim(p_email)),NULLIF(btrim(p_phone),''),'cognito','user',v_user_status)
  ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,
    display_name=EXCLUDED.display_name,initials=EXCLUDED.initials,email=EXCLUDED.email,
    phone=COALESCE(EXCLUDED.phone,public.platform_users.phone),updated_at=clock_timestamp();

  INSERT INTO travel.traveler_profiles(agency_id,user_id,display_name,email,phone,birth_date)
  VALUES(p_agency_id,v_user_id,btrim(p_display_name),lower(btrim(p_email)),
    NULLIF(btrim(p_phone),''),p_birth_date)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET display_name=EXCLUDED.display_name,
    email=EXCLUDED.email,phone=EXCLUDED.phone,
    birth_date=COALESCE(EXCLUDED.birth_date,travel.traveler_profiles.birth_date),
    updated_at=clock_timestamp()
  RETURNING id INTO v_traveler_id;

  v_member_type:=CASE WHEN p_role<>'organizer' AND p_birth_date IS NOT NULL
    AND p_birth_date>(v_starts_on-interval '18 years')::date
    THEN 'dependent_minor' ELSE 'adult' END;
  INSERT INTO travel.party_memberships
    (agency_id,departure_id,party_id,traveler_id,role,member_type,status)
  VALUES(p_agency_id,v_departure_id,p_party_id,v_traveler_id,p_role,v_member_type,
    CASE WHEN v_user_status='active' THEN 'active' ELSE 'invited' END)
  ON CONFLICT ON CONSTRAINT party_memberships_pkey DO UPDATE SET role=EXCLUDED.role,
    member_type=EXCLUDED.member_type,status=EXCLUDED.status;

  IF v_user_status<>'active' THEN
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

  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor_id,'traveler_profile',v_traveler_id::text,'provisioned',
    jsonb_build_object('partyId',p_party_id,'departureId',v_departure_id,'username',v_normalized_username));
  RETURN QUERY SELECT v_traveler_id,v_user_status<>'active';
END $$;

ALTER TABLE ops.travel_documents ADD COLUMN IF NOT EXISTS party_id UUID;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='ops.travel_documents'::regclass AND conname='travel_documents_party_fk') THEN
    ALTER TABLE ops.travel_documents ADD CONSTRAINT travel_documents_party_fk
      FOREIGN KEY(agency_id,departure_id,party_id)
      REFERENCES travel.travel_parties(agency_id,departure_id,id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='ops.travel_documents'::regclass AND conname='travel_documents_day_requires_party_ck') THEN
    ALTER TABLE ops.travel_documents ADD CONSTRAINT travel_documents_day_requires_party_ck
      CHECK(departure_day_id IS NULL OR party_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS travel_documents_party_day_ready_idx
  ON ops.travel_documents(agency_id,departure_id,party_id,departure_day_id,created_at DESC,id)
  WHERE status='ready' AND party_id IS NOT NULL AND departure_day_id IS NOT NULL;

DROP FUNCTION IF EXISTS app.register_departure_day_document(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT);
CREATE FUNCTION app.register_departure_day_document(
  p_actor_legacy_user_id TEXT,p_departure_id UUID,p_day_id UUID,p_party_id UUID,
  p_media_id UUID,p_document_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,
  p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT,p_description TEXT
)
RETURNS TABLE(document_id UUID,title TEXT,description TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_actor UUID;v_prefix TEXT;v_description TEXT;
BEGIN
  SELECT day.agency_id INTO v_agency FROM travel.departure_days day
  JOIN travel.travel_parties party ON party.agency_id=day.agency_id
    AND party.departure_id=day.departure_id AND party.id=p_party_id AND party.status<>'archived'
  WHERE day.id=p_day_id AND day.departure_id=p_departure_id;
  IF v_agency IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='departure day or group not found';
  END IF;
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,v_agency);
  v_description:=btrim(COALESCE(p_description,''));
  v_prefix:='agencies/'||v_agency||'/departures/'||p_departure_id||'/parties/'||p_party_id||'/days/'||p_day_id||'/documents/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN('r2','s3')
    OR p_size_bytes<=0 OR p_size_bytes>26214400 OR btrim(p_bucket)=''
    OR btrim(p_original_name)='' OR btrim(p_content_type)='' OR v_description='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid group day document metadata';
  END IF;

  INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,
    provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_media_id,v_agency,p_departure_id,p_party_id,v_actor,p_provider,p_bucket,p_object_key,
    p_original_name,p_content_type,p_size_bytes,'other','party','ready');

  RETURN QUERY INSERT INTO ops.travel_documents(id,agency_id,departure_id,departure_day_id,
    party_id,media_asset_id,document_type,title,description,status)
  VALUES(p_document_id,v_agency,p_departure_id,p_day_id,p_party_id,p_media_id,'other',
    p_original_name,v_description,'ready')
  RETURNING ops.travel_documents.id,ops.travel_documents.title,
    ops.travel_documents.description,ops.travel_documents.created_at;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_travel_document_download(p_legacy_user_id TEXT,p_document_id UUID)
RETURNS TABLE(provider TEXT,bucket TEXT,object_key TEXT,original_name TEXT,content_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
  SELECT asset.provider::text,asset.bucket,asset.object_key,asset.original_name,asset.content_type
  FROM ops.travel_documents document
  JOIN ops.media_assets asset ON asset.agency_id=document.agency_id AND asset.id=document.media_asset_id
  WHERE document.id=p_document_id AND document.departure_id IS NOT NULL
    AND (document.departure_item_id IS NOT NULL OR
      (document.departure_day_id IS NOT NULL AND document.party_id IS NOT NULL))
    AND document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM ops.legacy_id_map map
      WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_legacy_user_id
        AND (EXISTS(SELECT 1 FROM iam.agency_memberships agency_member
          WHERE agency_member.agency_id=document.agency_id AND agency_member.user_id=map.target_id
            AND agency_member.status='active' AND agency_member.role IN('owner','admin','editor'))
        OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile
          JOIN travel.party_memberships party_member ON party_member.agency_id=profile.agency_id
            AND party_member.traveler_id=profile.id AND party_member.status='active'
          WHERE profile.user_id=map.target_id AND party_member.agency_id=document.agency_id
            AND party_member.departure_id=document.departure_id
            AND (document.departure_item_id IS NOT NULL OR party_member.party_id=document.party_id))))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.provision_journey_traveler(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provision_journey_traveler(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;
REVOKE ALL ON FUNCTION app.register_departure_day_document(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_departure_day_document(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT) TO smf_app;
REVOKE ALL ON FUNCTION app.resolve_legacy_travel_document_download(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_travel_document_download(TEXT,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('082_v3_traveler_and_group_documents') ON CONFLICT(version) DO NOTHING;
