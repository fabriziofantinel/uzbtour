-- consolidation-approval: replace runtime identity bridges with native UUIDs

CREATE OR REPLACE FUNCTION app.resolve_impersonation_v3(
  p_actor_user_id UUID,p_token_hash TEXT
)
RETURNS TABLE(
  target_user_id UUID,target_legacy_user_id TEXT,display_name TEXT,email TEXT,
  platform_role TEXT,is_agency_admin BOOLEAN,expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT target.id,target_map.legacy_id::text,target.display_name::text,
    COALESCE(target.email,'')::text,target.platform_role::text,
    EXISTS(SELECT 1 FROM iam.agency_memberships membership
      JOIN iam.agencies agency ON agency.id=membership.agency_id AND agency.status IN('trial','active')
      WHERE membership.user_id=target.id AND membership.status='active'
        AND membership.role IN('owner','admin','editor'))::boolean,
    session.expires_at::timestamptz
  FROM iam.users actor
  JOIN iam.impersonation_sessions session ON session.actor_user_id=actor.id
    AND session.token_hash=p_token_hash AND session.ended_at IS NULL
    AND session.expires_at>clock_timestamp()
  JOIN iam.users target ON target.id=session.target_user_id AND target.status='active'
  JOIN ops.legacy_id_map target_map ON target_map.target_id=target.id
    AND target_map.source_system='public-v2' AND target_map.entity_type='user'
  WHERE actor.id=p_actor_user_id AND actor.status='active'
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
      OR EXISTS(SELECT 1 FROM iam.agency_memberships actor_membership
        JOIN iam.agencies actor_agency ON actor_agency.id=actor_membership.agency_id
          AND actor_agency.status IN('trial','active')
        JOIN travel.traveler_profiles profile ON profile.agency_id=actor_membership.agency_id
          AND profile.user_id=target.id
        JOIN travel.party_memberships party_membership ON party_membership.agency_id=profile.agency_id
          AND party_membership.traveler_id=profile.id AND party_membership.status<>'removed'
        JOIN travel.departures departure ON departure.id=party_membership.departure_id
          AND departure.agency_id=actor_membership.agency_id AND departure.status<>'cancelled'
        WHERE actor_membership.user_id=actor.id AND actor_membership.status='active'
          AND actor_membership.role IN('owner','admin','editor'))
    )
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.resolve_memory_download_v3(
  p_actor_user_id UUID,p_memory_id UUID
)
RETURNS TABLE(provider TEXT,bucket TEXT,object_key TEXT,original_name TEXT,content_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,travel,journey,ops SET row_security=off AS $$
  SELECT asset.provider::text,asset.bucket,asset.object_key,asset.original_name,asset.content_type
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
    AND membership.traveler_id=profile.id AND membership.status='active'
  JOIN journey.memories memory ON memory.agency_id=membership.agency_id
    AND memory.departure_id=membership.departure_id AND memory.party_id=membership.party_id
  JOIN ops.media_assets asset ON asset.agency_id=memory.agency_id
    AND asset.departure_id=memory.departure_id AND asset.party_id=memory.party_id
    AND asset.id=memory.media_asset_id
  WHERE profile.user_id=p_actor_user_id AND memory.id=p_memory_id
    AND asset.status='ready' AND asset.deleted_at IS NULL
    AND (asset.visibility='party'
      OR (asset.visibility='private' AND memory.created_by_traveler_id=profile.id))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.resolve_travel_document_download_v3(
  p_actor_user_id UUID,p_document_id UUID
)
RETURNS TABLE(provider TEXT,bucket TEXT,object_key TEXT,original_name TEXT,content_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  SELECT asset.provider::text,asset.bucket,asset.object_key,asset.original_name,asset.content_type
  FROM ops.travel_documents document
  JOIN ops.media_assets asset ON asset.agency_id=document.agency_id AND asset.id=document.media_asset_id
  WHERE document.id=p_document_id AND document.departure_id IS NOT NULL
    AND (document.departure_item_id IS NOT NULL
      OR (document.departure_day_id IS NOT NULL AND document.party_id IS NOT NULL))
    AND document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
    AND (
      EXISTS(SELECT 1 FROM iam.agency_memberships agency_member
        WHERE agency_member.agency_id=document.agency_id AND agency_member.user_id=p_actor_user_id
          AND agency_member.status='active' AND agency_member.role IN('owner','admin','editor'))
      OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile
        JOIN travel.party_memberships party_member ON party_member.agency_id=profile.agency_id
          AND party_member.traveler_id=profile.id AND party_member.status='active'
        WHERE profile.user_id=p_actor_user_id AND party_member.agency_id=document.agency_id
          AND party_member.departure_id=document.departure_id
          AND (document.departure_item_id IS NOT NULL OR party_member.party_id=document.party_id))
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_impersonation_v3(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_memory_download_v3(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_travel_document_download_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_impersonation_v3(UUID,TEXT),
  app.resolve_memory_download_v3(UUID,UUID),
  app.resolve_travel_document_download_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('147_v3_native_private_download_identity') ON CONFLICT(version) DO NOTHING;
