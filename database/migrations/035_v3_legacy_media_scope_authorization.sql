-- Chiusura IDOR per gli endpoint media della demo storica.
-- I record restano temporaneamente nelle tabelle legacy, ma la decisione di
-- accesso viene presa usando identita, agenzie e famiglie del modello V3.

CREATE OR REPLACE FUNCTION app.legacy_users_share_media_scope(
  p_viewer_legacy_user_id TEXT,
  p_owner_legacy_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops
SET row_security=off
AS $$
  SELECT p_viewer_legacy_user_id=p_owner_legacy_user_id OR EXISTS (
    SELECT 1
    FROM ops.legacy_id_map viewer_map
    JOIN ops.legacy_id_map owner_map
      ON owner_map.source_system='public-v2'
     AND owner_map.entity_type='user'
     AND owner_map.legacy_id=p_owner_legacy_user_id
    WHERE viewer_map.source_system='public-v2'
      AND viewer_map.entity_type='user'
      AND viewer_map.legacy_id=p_viewer_legacy_user_id
      AND (
        EXISTS (
          SELECT 1
          FROM travel.traveler_profiles viewer_profile
          JOIN travel.party_memberships viewer_membership
            ON viewer_membership.agency_id=viewer_profile.agency_id
           AND viewer_membership.traveler_id=viewer_profile.id
           AND viewer_membership.status='active'
          JOIN travel.traveler_profiles owner_profile
            ON owner_profile.user_id=owner_map.target_id
           AND owner_profile.agency_id=viewer_profile.agency_id
          JOIN travel.party_memberships owner_membership
            ON owner_membership.agency_id=owner_profile.agency_id
           AND owner_membership.traveler_id=owner_profile.id
           AND owner_membership.departure_id=viewer_membership.departure_id
           AND owner_membership.party_id=viewer_membership.party_id
           AND owner_membership.status='active'
          WHERE viewer_profile.user_id=viewer_map.target_id
        )
        OR EXISTS (
          SELECT 1
          FROM iam.agency_memberships agency_membership
          JOIN travel.traveler_profiles owner_profile
            ON owner_profile.agency_id=agency_membership.agency_id
           AND owner_profile.user_id=owner_map.target_id
          WHERE agency_membership.user_id=viewer_map.target_id
            AND agency_membership.status='active'
            AND agency_membership.role IN ('owner','admin','editor','viewer')
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app.resolve_legacy_demo_media_download(
  p_viewer_legacy_user_id TEXT,
  p_media_kind TEXT,
  p_media_id BIGINT
)
RETURNS TABLE (
  object_key TEXT,
  original_name TEXT,
  content_type TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,ops,public
SET row_security=off
AS $$
  WITH media AS (
    SELECT 'photo'::text AS media_kind,photo.id,photo.pathname AS object_key,
      photo.original_name,photo.content_type,photo.uploaded_by_id AS owner_legacy_user_id
    FROM public.trip_photos photo
    WHERE p_media_kind='photo' AND photo.id=p_media_id
    UNION ALL
    SELECT 'contest',photo.id,photo.pathname,photo.original_name,photo.content_type,
      photo.uploaded_by_id
    FROM public.trip_contest_photos photo
    WHERE p_media_kind='contest' AND photo.id=p_media_id
    UNION ALL
    SELECT 'mission',evidence.id,evidence.pathname,evidence.original_name,
      coalesce(evidence.content_type,'image/jpeg'),evidence.user_id
    FROM public.trip_mission_completions evidence
    WHERE p_media_kind='mission' AND evidence.id=p_media_id AND evidence.pathname IS NOT NULL
    UNION ALL
    SELECT 'bingo',evidence.id,evidence.pathname,evidence.original_name,
      coalesce(evidence.content_type,'image/jpeg'),evidence.user_id
    FROM public.trip_bingo_completions evidence
    WHERE p_media_kind='bingo' AND evidence.id=p_media_id AND evidence.pathname IS NOT NULL
  )
  SELECT media.object_key,coalesce(media.original_name,'foto'),
    coalesce(media.content_type,'image/jpeg')
  FROM media
  WHERE media.media_kind=p_media_kind
    AND app.legacy_users_share_media_scope(
      p_viewer_legacy_user_id,media.owner_legacy_user_id
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.legacy_users_share_media_scope(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_legacy_demo_media_download(TEXT,TEXT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_demo_media_download(TEXT,TEXT,BIGINT) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('035_v3_legacy_media_scope_authorization') ON CONFLICT(version) DO NOTHING;
