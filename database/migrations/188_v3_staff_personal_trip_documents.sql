CREATE OR REPLACE FUNCTION app.list_staff_personal_trip_documents_v3(p_actor UUID,p_departure UUID)
RETURNS TABLE(
  id UUID,day_id UUID,staff_role TEXT,staff_user_ids UUID[],title TEXT,description TEXT,
  content_type TEXT,size_bytes BIGINT,created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
  WITH assignment AS (
    SELECT assigned.agency_id,assigned.role
    FROM travel.departure_staff_assignments assigned
    WHERE assigned.departure_id=p_departure AND assigned.user_id=p_actor AND assigned.status='active'
    ORDER BY assigned.assigned_at DESC
    LIMIT 1
  )
  SELECT document.id,document.departure_day_id,document.staff_role,document.staff_user_ids,
    document.title,COALESCE(document.description,''),asset.content_type,asset.size_bytes,document.created_at
  FROM assignment
  JOIN ops.travel_documents document ON document.agency_id=assignment.agency_id
    AND document.departure_id=p_departure AND document.departure_day_id IS NOT NULL
  JOIN ops.media_assets asset ON asset.id=document.media_asset_id AND asset.agency_id=document.agency_id
  WHERE document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
    AND (
      (document.staff_role IS NULL AND document.party_id IS NULL AND document.traveler_id IS NULL)
      OR (
        document.staff_role IN(assignment.role,CASE WHEN assignment.role='tour_leader' THEN 'accompagnatore' ELSE assignment.role END)
        AND (document.staff_user_ids IS NULL OR p_actor=ANY(document.staff_user_ids))
      )
    )
  ORDER BY document.created_at DESC
$$;

CREATE OR REPLACE FUNCTION app.resolve_travel_document_download_v3(p_actor_user_id UUID,p_document_id UUID)
RETURNS TABLE(provider TEXT,bucket TEXT,object_key TEXT,original_name TEXT,content_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
 SELECT asset.provider::text,asset.bucket,asset.object_key,asset.original_name,asset.content_type
 FROM ops.travel_documents document
 JOIN ops.media_assets asset ON asset.agency_id=document.agency_id AND asset.id=document.media_asset_id
 WHERE document.id=p_document_id AND document.departure_id IS NOT NULL AND document.status='ready'
   AND asset.status='ready' AND asset.deleted_at IS NULL
   AND (
     EXISTS(SELECT 1 FROM iam.agency_memberships member WHERE member.agency_id=document.agency_id
       AND member.user_id=p_actor_user_id AND member.status='active' AND member.role IN('owner','admin','editor'))
     OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile JOIN travel.party_memberships membership
       ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id AND membership.status='active'
       WHERE profile.user_id=p_actor_user_id AND membership.agency_id=document.agency_id
         AND membership.departure_id=document.departure_id AND document.staff_role IS NULL
         AND (document.party_id IS NULL OR membership.party_id=document.party_id)
         AND (document.traveler_id IS NULL OR profile.id=document.traveler_id))
     OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment
       WHERE assignment.agency_id=document.agency_id AND assignment.departure_id=document.departure_id
         AND assignment.user_id=p_actor_user_id AND assignment.status='active'
         AND (
           (document.staff_role IS NULL AND document.party_id IS NULL AND document.traveler_id IS NULL)
           OR (
             document.staff_role IS NOT NULL
             AND (document.staff_user_ids IS NULL OR p_actor_user_id=ANY(document.staff_user_ids))
             AND assignment.role IN(document.staff_role,CASE WHEN document.staff_role='accompagnatore' THEN 'tour_leader' ELSE document.staff_role END)
           )
         ))
   )
 LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.list_staff_personal_trip_documents_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_staff_personal_trip_documents_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('188_v3_staff_personal_trip_documents') ON CONFLICT(version) DO NOTHING;
