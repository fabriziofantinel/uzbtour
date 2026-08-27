-- Cutover del ciclo di vita degli inviti verso IAM V3.
-- L'ispezione espone solo i dati minimi necessari alla pagina pubblica;
-- l'attivazione e' atomica e mantiene V2 sincronizzato durante la convergenza.

CREATE OR REPLACE FUNCTION app.inspect_account_invitation(p_token_hash TEXT)
RETURNS TABLE(display_name TEXT,email TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,iam
SET row_security=off
AS $$
  SELECT users.display_name,users.email
  FROM iam.invitations invitation
  JOIN iam.users users ON users.id=invitation.invited_user_id
  WHERE invitation.token_hash=p_token_hash
    AND invitation.used_at IS NULL
    AND invitation.expires_at>clock_timestamp()
    AND users.status='invited'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.activate_account_invitation(
  p_token_hash TEXT,
  p_subject TEXT,
  p_email TEXT
)
RETURNS TABLE(legacy_user_id TEXT,display_name TEXT,email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public
SET row_security=off
AS $$
DECLARE
  v_invitation_id UUID;
  v_user_id UUID;
  v_display_name TEXT;
  v_email TEXT;
  v_legacy_user_id TEXT;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$'
    OR NULLIF(btrim(p_subject),'') IS NULL
    OR NULLIF(btrim(p_email),'') IS NULL THEN
    RETURN;
  END IF;

  SELECT invitation.id,users.id,users.display_name,users.email
  INTO v_invitation_id,v_user_id,v_display_name,v_email
  FROM iam.invitations invitation
  JOIN iam.users users ON users.id=invitation.invited_user_id
  WHERE invitation.token_hash=p_token_hash
    AND invitation.used_at IS NULL
    AND invitation.expires_at>clock_timestamp()
    AND users.status='invited'
  FOR UPDATE OF invitation,users;

  IF v_invitation_id IS NULL OR lower(btrim(p_email))<>lower(btrim(v_email)) THEN
    RETURN;
  END IF;
  IF EXISTS(
    SELECT 1 FROM iam.user_identities identity
    WHERE identity.provider='neon' AND identity.subject=p_subject
      AND identity.user_id<>v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='authentication subject already assigned';
  END IF;

  DELETE FROM iam.user_identities
  WHERE user_id=v_user_id AND provider='neon' AND subject<>p_subject;
  INSERT INTO iam.user_identities(user_id,provider,subject)
  VALUES(v_user_id,'neon',p_subject)
  ON CONFLICT(provider,subject) DO UPDATE SET user_id=EXCLUDED.user_id;

  UPDATE iam.users
  SET email=lower(btrim(p_email)),status='active',updated_at=clock_timestamp()
  WHERE id=v_user_id;
  UPDATE iam.invitations SET used_at=clock_timestamp() WHERE id=v_invitation_id;
  UPDATE iam.agency_memberships SET status='active'
  WHERE user_id=v_user_id AND status='invited';
  UPDATE travel.party_memberships membership SET status='active'
  FROM travel.traveler_profiles traveler
  WHERE traveler.user_id=v_user_id
    AND membership.agency_id=traveler.agency_id
    AND membership.traveler_id=traveler.id
    AND membership.status='invited';

  SELECT map.legacy_id INTO v_legacy_user_id
  FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.target_id=v_user_id
  LIMIT 1;
  IF v_legacy_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='legacy identity mapping missing';
  END IF;

  -- Compatibilita' temporanea per i moduli amministrativi ancora in migrazione.
  UPDATE public.platform_users
  SET auth_provider='neon',auth_subject=p_subject,email=lower(btrim(p_email)),
      status='active',updated_at=clock_timestamp()
  WHERE id=v_legacy_user_id;
  UPDATE public.user_invitations SET used_at=clock_timestamp()
  WHERE id=v_invitation_id AND used_at IS NULL;
  UPDATE public.party_memberships SET status='active'
  WHERE traveler_id IN(
    SELECT id FROM public.traveler_profiles WHERE user_id=v_legacy_user_id
  ) AND status='invited';

  RETURN QUERY SELECT v_legacy_user_id,v_display_name,lower(btrim(p_email));
END $$;

REVOKE ALL ON FUNCTION app.inspect_account_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.activate_account_invitation(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.inspect_account_invitation(TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.activate_account_invitation(TEXT,TEXT,TEXT) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('038_v3_invitation_activation_cutover') ON CONFLICT(version) DO NOTHING;
