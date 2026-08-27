-- Permit contact maintenance for legacy agencies that do not yet have an owner membership.

CREATE OR REPLACE FUNCTION app.update_platform_agency_owner_contact(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_email TEXT,p_phone TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops,public SET row_security=off AS $$
DECLARE v_owner_id UUID;v_owner_legacy_id TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.legacy_id_map map JOIN iam.users actor ON actor.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user'
      AND map.legacy_id=p_actor_legacy_user_id AND actor.status='active'
      AND actor.platform_role='superadmin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency owner contact update denied';
  END IF;

  UPDATE iam.agencies SET reference_email=lower(btrim(p_email)),reference_phone=btrim(p_phone),
    updated_at=clock_timestamp() WHERE id=p_agency_id AND status NOT IN('closed','deleting');
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  UPDATE public.agencies SET reference_email=lower(btrim(p_email)),reference_phone=btrim(p_phone),
    updated_at=clock_timestamp() WHERE id=p_agency_id;

  SELECT membership.user_id INTO v_owner_id FROM iam.agency_memberships membership
  WHERE membership.agency_id=p_agency_id AND membership.role='owner' AND membership.status<>'revoked'
  ORDER BY membership.created_at DESC LIMIT 1;
  IF v_owner_id IS NOT NULL THEN
    SELECT legacy_id INTO v_owner_legacy_id FROM ops.legacy_id_map
    WHERE source_system='public-v2' AND entity_type='user' AND target_id=v_owner_id LIMIT 1;
    UPDATE iam.users SET email=lower(btrim(p_email)),phone=btrim(p_phone),updated_at=clock_timestamp()
    WHERE id=v_owner_id;
    UPDATE public.platform_users SET email=lower(btrim(p_email)),phone=btrim(p_phone),
      updated_at=clock_timestamp() WHERE id=v_owner_legacy_id;
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.update_platform_agency_owner_contact(TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_platform_agency_owner_contact(TEXT,UUID,TEXT,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('062_v3_legacy_agency_owner_contact') ON CONFLICT(version) DO NOTHING;
