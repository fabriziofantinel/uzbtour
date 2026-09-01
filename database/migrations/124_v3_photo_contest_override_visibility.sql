CREATE OR REPLACE FUNCTION app.has_photo_contest_access_override_v3(
  p_agency_id UUID,
  p_departure_id UUID,
  p_party_id UUID,
  p_user_id TEXT,
  p_activity_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,app,iam,travel,journey
SET row_security=off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM journey.photo_contest_access_overrides access_override
    JOIN travel.traveler_profiles traveler
      ON traveler.agency_id=access_override.agency_id
     AND traveler.id=access_override.traveler_id
    WHERE access_override.agency_id=p_agency_id
      AND access_override.departure_id=p_departure_id
      AND access_override.party_id=p_party_id
      AND access_override.activity_id=p_activity_id
      AND access_override.expires_at>clock_timestamp()
      AND traveler.user_id=app.resolve_legacy_user_id(p_user_id,p_agency_id)
  )
$$;

REVOKE ALL ON FUNCTION app.has_photo_contest_access_override_v3(UUID,UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_photo_contest_access_override_v3(UUID,UUID,UUID,TEXT,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('124_v3_photo_contest_override_visibility') ON CONFLICT(version) DO NOTHING;
