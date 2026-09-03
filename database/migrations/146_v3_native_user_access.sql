CREATE OR REPLACE FUNCTION app.resolve_user_access_v3(
  p_actor_user_id UUID,
  p_agency_id UUID DEFAULT NULL
) RETURNS TABLE(
  is_active BOOLEAN,
  is_superadmin BOOLEAN,
  is_agency_admin BOOLEAN,
  agency_role TEXT
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam SET row_security=off AS $$
  SELECT users.status='active',
    users.status='active' AND users.platform_role='superadmin',
    users.status='active' AND EXISTS(
      SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor')
        AND (p_agency_id IS NULL OR membership.agency_id=p_agency_id)
    ),
    (
      SELECT membership.role
      FROM iam.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.status='active'
        AND (p_agency_id IS NULL OR membership.agency_id=p_agency_id)
      ORDER BY CASE membership.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
        WHEN 'editor' THEN 2 ELSE 3 END,membership.agency_id
      LIMIT 1
    )
  FROM iam.users users
  WHERE users.id=p_actor_user_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_user_access_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_user_access_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('146_v3_native_user_access') ON CONFLICT(version) DO NOTHING;
