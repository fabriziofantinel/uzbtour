CREATE TABLE IF NOT EXISTS journey.photo_contest_access_overrides (
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE CASCADE,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT 'support_test',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (agency_id,departure_id,party_id,traveler_id,activity_id),
  FOREIGN KEY (agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id,traveler_id) REFERENCES travel.traveler_profiles(agency_id,id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id,activity_id) REFERENCES content.activities(agency_id,id) ON DELETE CASCADE
);

ALTER TABLE journey.photo_contest_access_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.photo_contest_access_overrides FORCE ROW LEVEL SECURITY;
REVOKE ALL ON journey.photo_contest_access_overrides FROM PUBLIC,smf_app;

DO $$
DECLARE v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('app.upsert_photo_contest_draft_v3(text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,smallint)'::regprocedure) INTO v_definition;
  IF v_definition NOT LIKE '%photo_contest_access_overrides%' THEN
    v_definition:=replace(v_definition,
      'IF clock_timestamp()>=((v_service_date+1)+time ''06:00'') AT TIME ZONE v_timezone THEN',
      'IF clock_timestamp()>=((v_service_date+1)+time ''06:00'') AT TIME ZONE v_timezone AND NOT EXISTS(SELECT 1 FROM journey.photo_contest_access_overrides access_override WHERE access_override.agency_id=p_agency_id AND access_override.departure_id=p_departure_id AND access_override.party_id=p_party_id AND access_override.traveler_id=v_traveler AND access_override.activity_id=v_activity AND access_override.expires_at>clock_timestamp()) THEN');
    IF v_definition NOT LIKE '%photo_contest_access_overrides%' THEN RAISE EXCEPTION 'unexpected upsert contest definition';END IF;
    EXECUTE v_definition;
  END IF;

  SELECT pg_get_functiondef('app.confirm_photo_contest_v3(text,uuid,uuid,uuid,uuid)'::regprocedure) INTO v_definition;
  IF v_definition NOT LIKE '%photo_contest_access_overrides%' THEN
    v_definition:=replace(v_definition,
      'IF clock_timestamp()>((v_service_date+1)+time ''06:00'') AT TIME ZONE v_timezone THEN',
      'IF clock_timestamp()>((v_service_date+1)+time ''06:00'') AT TIME ZONE v_timezone AND NOT EXISTS(SELECT 1 FROM journey.photo_contest_access_overrides access_override WHERE access_override.agency_id=p_agency_id AND access_override.departure_id=p_departure_id AND access_override.party_id=p_party_id AND access_override.traveler_id=v_traveler AND access_override.activity_id=v_activity AND access_override.expires_at>clock_timestamp()) THEN');
    IF v_definition NOT LIKE '%photo_contest_access_overrides%' THEN RAISE EXCEPTION 'unexpected confirm contest definition';END IF;
    EXECUTE v_definition;
  END IF;
END $$;

INSERT INTO public.platform_schema_migrations(version)
VALUES('123_v3_photo_contest_access_override') ON CONFLICT(version) DO NOTHING;
