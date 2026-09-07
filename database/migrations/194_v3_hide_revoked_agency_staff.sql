-- Removed agency staff must disappear from the active personnel directory.

CREATE OR REPLACE FUNCTION app.read_agency_staff_v3(p_actor_user_id UUID,p_agency_id UUID)
RETURNS TABLE(legacy_user_id TEXT,user_id UUID,name TEXT,username TEXT,email TEXT,phone TEXT,staff_role TEXT,status TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
BEGIN
  PERFORM app.require_agency_staff_manager_v3(p_actor_user_id,p_agency_id);
  RETURN QUERY
  SELECT legacy.legacy_id::text,staff.user_id,account.display_name::text,account.username::text,
    COALESCE(account.email,'')::text,COALESCE(account.phone,'')::text,staff.staff_role::text,
    CASE WHEN membership.status='invited' THEN 'invited' ELSE 'active' END::text,staff.created_at
  FROM iam.agency_staff_profiles staff
  JOIN iam.users account ON account.id=staff.user_id AND account.status IN('active','invited')
  JOIN iam.agency_memberships membership ON membership.agency_id=staff.agency_id
    AND membership.user_id=staff.user_id AND membership.status IN('active','invited')
  JOIN ops.legacy_id_map legacy ON legacy.target_id=staff.user_id AND legacy.agency_id=staff.agency_id
    AND legacy.source_system='public-v2' AND legacy.entity_type='user'
  WHERE staff.agency_id=p_agency_id AND staff.status='active'
  ORDER BY staff.staff_role,account.display_name;
END $$;

REVOKE ALL ON FUNCTION app.read_agency_staff_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agency_staff_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('194_v3_hide_revoked_agency_staff') ON CONFLICT(version) DO NOTHING;
