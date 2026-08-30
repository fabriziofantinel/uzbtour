-- Revalidate the target tenant on every impersonated request.

CREATE OR REPLACE FUNCTION app.resolve_legacy_impersonation(p_actor_legacy_user_id TEXT,p_token_hash TEXT)
RETURNS TABLE(target_legacy_user_id TEXT,display_name TEXT,email TEXT,platform_role TEXT,is_agency_admin BOOLEAN,expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT target_map.legacy_id::text,target.display_name::text,COALESCE(target.email,'')::text,
    target.platform_role::text,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
      WHERE membership.user_id=target.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor'))::boolean,
    session.expires_at::timestamptz
  FROM ops.legacy_id_map actor_map
  JOIN iam.users actor ON actor.id=actor_map.target_id AND actor.status='active'
  JOIN iam.impersonation_sessions session ON session.actor_user_id=actor.id
    AND session.token_hash=p_token_hash AND session.ended_at IS NULL
    AND session.expires_at>clock_timestamp()
  JOIN iam.users target ON target.id=session.target_user_id AND target.status='active'
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
    AND (
      target.platform_role='superadmin'
      OR EXISTS(SELECT 1 FROM iam.agency_memberships target_membership
        JOIN iam.agencies target_agency ON target_agency.id=target_membership.agency_id
          AND target_agency.status IN('trial','active')
        WHERE target_membership.user_id=target.id AND target_membership.status='active')
      OR EXISTS(SELECT 1 FROM travel.traveler_profiles target_profile
        JOIN iam.agencies target_agency ON target_agency.id=target_profile.agency_id
          AND target_agency.status IN('trial','active')
        JOIN travel.party_memberships target_party ON target_party.agency_id=target_profile.agency_id
          AND target_party.traveler_id=target_profile.id AND target_party.status='active'
        WHERE target_profile.user_id=target.id)
    )
    AND (
      actor.platform_role='superadmin'
      OR EXISTS(
        SELECT 1 FROM iam.agency_memberships actor_membership
        JOIN iam.agencies actor_agency ON actor_agency.id=actor_membership.agency_id
          AND actor_agency.status IN('trial','active')
        JOIN travel.traveler_profiles profile ON profile.agency_id=actor_membership.agency_id
          AND profile.user_id=target.id
        JOIN travel.party_memberships party_membership ON party_membership.agency_id=profile.agency_id
          AND party_membership.traveler_id=profile.id AND party_membership.status<>'removed'
        JOIN travel.departures departure ON departure.id=party_membership.departure_id
          AND departure.agency_id=actor_membership.agency_id AND departure.status<>'cancelled'
        WHERE actor_membership.user_id=actor.id AND actor_membership.status='active'
          AND actor_membership.role IN('owner','admin','editor')
      )
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_legacy_impersonation(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_impersonation(TEXT,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('101_v3_impersonation_tenant_revalidation') ON CONFLICT(version) DO NOTHING;
