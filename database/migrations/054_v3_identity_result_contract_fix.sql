-- Corregge il contratto fisico del resolver IAM usato dopo il login Neon Auth.
-- In PL/pgSQL, RETURN QUERY richiede che VARCHAR e TEXT coincidano esattamente
-- con i tipi dichiarati da RETURNS TABLE.

CREATE OR REPLACE FUNCTION app.resolve_neon_authenticated_user(
  p_subject TEXT,
  p_email TEXT,
  p_display_name TEXT
)
RETURNS TABLE(
  legacy_user_id TEXT,
  display_name TEXT,
  email TEXT,
  platform_role TEXT,
  is_agency_admin BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops,public
SET row_security=off
AS $$
DECLARE
  v_user_id UUID;
  v_legacy_user_id TEXT;
BEGIN
  SELECT candidate.id INTO v_user_id
  FROM (
    SELECT users.id,
      CASE WHEN identity.subject=p_subject THEN 0 ELSE 1 END AS priority
    FROM iam.users users
    LEFT JOIN iam.user_identities identity
      ON identity.user_id=users.id AND identity.provider='neon'
    WHERE (identity.subject=p_subject OR users.normalized_email=lower(btrim(p_email)))
      AND users.status='active'
  ) candidate
  ORDER BY candidate.priority
  LIMIT 1;
  IF v_user_id IS NULL THEN RETURN; END IF;

  DELETE FROM iam.user_identities
  WHERE user_id=v_user_id AND provider='neon' AND subject<>p_subject;
  INSERT INTO iam.user_identities(user_id,provider,subject)
  VALUES(v_user_id,'neon',p_subject)
  ON CONFLICT(provider,subject) DO UPDATE SET user_id=EXCLUDED.user_id;

  UPDATE iam.users users
  SET email=lower(btrim(p_email)),
      display_name=COALESCE(NULLIF(btrim(users.display_name),''),NULLIF(btrim(p_display_name),''),'Utente'),
      updated_at=clock_timestamp()
  WHERE users.id=v_user_id;

  SELECT map.legacy_id INTO v_legacy_user_id
  FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.target_id=v_user_id
  LIMIT 1;
  IF v_legacy_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='legacy identity mapping missing';
  END IF;

  UPDATE public.platform_users legacy
  SET auth_provider='neon',auth_subject=p_subject,email=lower(btrim(p_email)),
      display_name=COALESCE(NULLIF(btrim(legacy.display_name),''),NULLIF(btrim(p_display_name),''),'Utente'),
      status='active',updated_at=clock_timestamp()
  WHERE legacy.id=v_legacy_user_id;

  RETURN QUERY
  SELECT v_legacy_user_id::TEXT,
    users.display_name::TEXT,
    COALESCE(users.email,'')::TEXT,
    users.platform_role::TEXT,
    EXISTS(
      SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.status='active'
        AND membership.role IN ('owner','admin','editor')
    )::BOOLEAN
  FROM iam.users users WHERE users.id=v_user_id;
END $$;

INSERT INTO public.platform_schema_migrations(version)
VALUES('054_v3_identity_result_contract_fix') ON CONFLICT(version) DO NOTHING;
