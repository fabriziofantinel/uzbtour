-- Destination-aware traveler finance and a strict two-photo contest limit.
INSERT INTO ref.currencies(code,name,minor_unit)
VALUES('VND','Vietnamese dong',0)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,minor_unit=EXCLUDED.minor_unit;

CREATE OR REPLACE FUNCTION app.add_photo_contest_entry_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,
  p_template_day_id UUID,p_activity_item_id UUID,p_media_asset_id UUID,p_client_operation_id UUID)
RETURNS TABLE(id UUID,participant_slot SMALLINT,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,content,journey,ops
SET row_security=off AS $$
DECLARE v_actor UUID;v_traveler UUID;v_version UUID;v_activity UUID;v_slot SMALLINT;v_id UUID;
BEGIN
  v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,p_agency_id);
  SELECT profile.id,departure.template_version_id,item.activity_id
    INTO v_traveler,v_version,v_activity
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
    AND membership.traveler_id=profile.id AND membership.departure_id=p_departure_id
    AND membership.party_id=p_party_id AND membership.status='active'
  JOIN travel.departures departure ON departure.agency_id=membership.agency_id
    AND departure.id=membership.departure_id
  JOIN content.activity_items item ON item.agency_id=departure.agency_id
    AND item.template_version_id=departure.template_version_id AND item.id=p_activity_item_id
  JOIN content.activities activity ON activity.agency_id=item.agency_id
    AND activity.template_version_id=item.template_version_id AND activity.id=item.activity_id
    AND activity.template_day_id=p_template_day_id AND activity.activity_type='photo_contest'
    AND activity.status='approved'
  WHERE profile.agency_id=p_agency_id AND profile.user_id=v_actor;
  IF v_traveler IS NULL OR NOT EXISTS(SELECT 1 FROM ops.media_assets asset
    WHERE asset.agency_id=p_agency_id AND asset.departure_id=p_departure_id
      AND asset.party_id=p_party_id AND asset.id=p_media_asset_id
      AND asset.uploaded_by_user_id=v_actor AND asset.status='ready') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='contest entry is outside traveler scope';
  END IF;
  SELECT candidate INTO v_slot FROM generate_series(1,2) candidate
  WHERE NOT EXISTS(SELECT 1 FROM journey.photo_contest_entries entry
    WHERE entry.party_id=p_party_id AND entry.traveler_id=v_traveler
      AND entry.activity_id=v_activity AND entry.participant_slot=candidate)
  ORDER BY candidate LIMIT 1;
  IF v_slot IS NULL THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='contest entry limit reached'; END IF;
  INSERT INTO journey.photo_contest_entries(agency_id,departure_id,template_version_id,
    party_id,traveler_id,activity_id,media_asset_id,participant_slot,client_operation_id)
  VALUES(p_agency_id,p_departure_id,v_version,p_party_id,v_traveler,v_activity,
    p_media_asset_id,v_slot,p_client_operation_id) RETURNING journey.photo_contest_entries.id INTO v_id;
  RETURN QUERY SELECT v_id,v_slot,'submitted'::text;
END $$;

UPDATE content.activities SET max_entries=2
WHERE activity_type='photo_contest' AND max_entries IS DISTINCT FROM 2;

REVOKE ALL ON FUNCTION app.add_photo_contest_entry_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.add_photo_contest_entry_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('085_v3_destination_currency_and_photo_limit') ON CONFLICT(version) DO NOTHING;
