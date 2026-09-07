-- A suspended agency must invalidate active Cognito resolution and every active
-- impersonation session on the next application request.

CREATE OR REPLACE FUNCTION app.resolve_cognito_authenticated_user(p_subject TEXT)
RETURNS TABLE(native_user_id UUID,legacy_user_id TEXT,display_name TEXT,username TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT account.id,mapping.legacy_id::text,account.display_name::text,account.username::text,
    COALESCE(account.email,'')::text,account.platform_role::text,
    EXISTS(
      SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
      WHERE membership.user_id=account.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor')
    )::boolean
  FROM iam.user_identities identity
  JOIN iam.users account ON account.id=identity.user_id AND account.status='active'
  JOIN ops.legacy_id_map mapping ON mapping.source_system='public-v2'
    AND mapping.entity_type='user' AND mapping.target_id=account.id
  WHERE identity.provider='cognito' AND identity.subject=p_subject
    AND (
      account.platform_role='superadmin'
      OR EXISTS(
        SELECT 1 FROM iam.agency_memberships membership
        JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
        WHERE membership.user_id=account.id AND membership.status='active'
      )
      OR EXISTS(
        SELECT 1 FROM travel.traveler_profiles profile
        JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
          AND membership.traveler_id=profile.id AND membership.status='active'
        JOIN iam.agencies agency ON agency.id=profile.agency_id AND agency.status IN('trial','active')
        WHERE profile.user_id=account.id
      )
    )
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.resolve_impersonation_v3(p_actor_user_id UUID,p_token_hash TEXT)
RETURNS TABLE(target_user_id UUID,target_legacy_user_id TEXT,display_name TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN,expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT target.id,target_map.legacy_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,
    EXISTS(
      SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
      WHERE membership.user_id=target.id AND membership.status IN('active','invited')
        AND membership.role IN('owner','admin','editor')
    ),session.expires_at
  FROM iam.users actor
  JOIN iam.impersonation_sessions session ON session.actor_user_id=actor.id
    AND session.token_hash=p_token_hash AND session.ended_at IS NULL
    AND session.expires_at>clock_timestamp()
  JOIN iam.users target ON target.id=session.target_user_id AND target.status IN('active','invited')
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE actor.id=p_actor_user_id AND actor.status='active'
    AND (
      target.platform_role='superadmin'
      OR EXISTS(
        SELECT 1 FROM iam.agency_memberships target_membership
        JOIN iam.agencies target_agency ON target_agency.id=target_membership.agency_id
          AND target_agency.status IN('trial','active')
        WHERE target_membership.user_id=target.id AND target_membership.status IN('active','invited')
      )
      OR EXISTS(
        SELECT 1 FROM travel.traveler_profiles target_profile
        JOIN iam.agencies target_agency ON target_agency.id=target_profile.agency_id
          AND target_agency.status IN('trial','active')
        JOIN travel.party_memberships target_party ON target_party.agency_id=target_profile.agency_id
          AND target_party.traveler_id=target_profile.id AND target_party.status<>'removed'
        WHERE target_profile.user_id=target.id
      )
      OR EXISTS(
        SELECT 1 FROM iam.agency_staff_profiles staff
        JOIN iam.agencies target_agency ON target_agency.id=staff.agency_id
          AND target_agency.status IN('trial','active')
        WHERE staff.user_id=target.id AND staff.status='active'
      )
    )
    AND (
      actor.platform_role='superadmin'
      OR EXISTS(
        SELECT 1 FROM iam.agency_memberships actor_membership
        JOIN iam.agencies actor_agency ON actor_agency.id=actor_membership.agency_id
          AND actor_agency.status IN('trial','active')
        WHERE actor_membership.user_id=actor.id AND actor_membership.status='active'
          AND actor_membership.role IN('owner','admin','editor')
          AND NOT EXISTS(
            SELECT 1 FROM iam.agency_memberships excluded
            WHERE excluded.user_id=target.id AND excluded.status<>'revoked'
              AND excluded.role IN('owner','admin','editor')
          )
          AND (
            EXISTS(
              SELECT 1 FROM travel.traveler_profiles profile
              WHERE profile.agency_id=actor_membership.agency_id AND profile.user_id=target.id
            )
            OR EXISTS(
              SELECT 1 FROM iam.agency_staff_profiles staff
              WHERE staff.agency_id=actor_membership.agency_id AND staff.user_id=target.id
                AND staff.status='active' AND staff.staff_role IN('accompagnatore','guida')
            )
            OR EXISTS(
              SELECT 1 FROM travel.departure_staff_assignments assignment
              WHERE assignment.agency_id=actor_membership.agency_id AND assignment.user_id=target.id
                AND assignment.status='active'
                AND assignment.role IN('accompagnatore','tour_leader','guida')
            )
          )
      )
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_cognito_authenticated_user(TEXT),
  app.resolve_impersonation_v3(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_cognito_authenticated_user(TEXT),
  app.resolve_impersonation_v3(UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('197_v3_suspended_agency_session_boundary') ON CONFLICT(version) DO NOTHING;
