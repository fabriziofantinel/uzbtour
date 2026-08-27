-- Autorizzazione atomica dei download privati sul modello V3.
-- Le API ricevono soltanto i metadati necessari a generare una URL R2 firmata;
-- la mappa tecnica delle identita resta confinata nelle funzioni SECURITY DEFINER.

CREATE OR REPLACE FUNCTION app.resolve_legacy_memory_download(
  p_legacy_user_id TEXT,
  p_memory_id UUID
)
RETURNS TABLE (
  provider TEXT,
  bucket TEXT,
  object_key TEXT,
  original_name TEXT,
  content_type TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey,ops
SET row_security=off
AS $$
  SELECT asset.provider::text,asset.bucket,asset.object_key,
    asset.original_name,asset.content_type
  FROM ops.legacy_id_map map
  JOIN travel.traveler_profiles profile
    ON profile.user_id=map.target_id
  JOIN travel.party_memberships membership
    ON membership.agency_id=profile.agency_id
   AND membership.traveler_id=profile.id
   AND membership.status='active'
  JOIN journey.memories memory
    ON memory.agency_id=membership.agency_id
   AND memory.departure_id=membership.departure_id
   AND memory.party_id=membership.party_id
  JOIN ops.media_assets asset
    ON asset.agency_id=memory.agency_id
   AND asset.departure_id=memory.departure_id
   AND asset.party_id=memory.party_id
   AND asset.id=memory.media_asset_id
  WHERE map.source_system='public-v2'
    AND map.entity_type='user'
    AND map.legacy_id=p_legacy_user_id
    AND memory.id=p_memory_id
    AND asset.status='ready'
    AND asset.deleted_at IS NULL
    AND (
      asset.visibility='party'
      OR (asset.visibility='private' AND memory.created_by_traveler_id=profile.id)
    )
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_travel_document_download(
  p_legacy_user_id TEXT,
  p_document_id UUID
)
RETURNS TABLE (
  provider TEXT,
  bucket TEXT,
  object_key TEXT,
  original_name TEXT,
  content_type TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops
SET row_security=off
AS $$
  SELECT asset.provider::text,asset.bucket,asset.object_key,
    asset.original_name,asset.content_type
  FROM ops.travel_documents document
  JOIN ops.media_assets asset
    ON asset.agency_id=document.agency_id
   AND asset.id=document.media_asset_id
  WHERE document.id=p_document_id
    AND document.departure_id IS NOT NULL
    AND document.departure_item_id IS NOT NULL
    AND document.status='ready'
    AND asset.status='ready'
    AND asset.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM ops.legacy_id_map map
      WHERE map.source_system='public-v2'
        AND map.entity_type='user'
        AND map.legacy_id=p_legacy_user_id
        AND (
          EXISTS (
            SELECT 1
            FROM iam.agency_memberships agency_membership
            WHERE agency_membership.agency_id=document.agency_id
              AND agency_membership.user_id=map.target_id
              AND agency_membership.status='active'
              AND agency_membership.role IN ('owner','admin','editor')
          )
          OR EXISTS (
            SELECT 1
            FROM travel.traveler_profiles profile
            JOIN travel.party_memberships party_membership
              ON party_membership.agency_id=profile.agency_id
             AND party_membership.traveler_id=profile.id
             AND party_membership.status='active'
            WHERE profile.user_id=map.target_id
              AND party_membership.agency_id=document.agency_id
              AND party_membership.departure_id=document.departure_id
          )
        )
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_legacy_memory_download(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_legacy_travel_document_download(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_memory_download(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_travel_document_download(TEXT,UUID) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('034_v3_media_download_authorization') ON CONFLICT(version) DO NOTHING;
