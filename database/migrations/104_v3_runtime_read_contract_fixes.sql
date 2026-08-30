-- Runtime access remains mediated for identity data; only tenant-scoped operational
-- messages are exposed directly because the analytics transaction sets app.agency_id.
GRANT SELECT ON TABLE journey.operational_messages TO smf_app;

CREATE OR REPLACE FUNCTION app.list_traveler_change_notices_v3(
  p_actor_legacy TEXT,
  p_agency UUID,
  p_departure UUID,
  p_limit INTEGER DEFAULT 100
) RETURNS TABLE(
  id UUID,
  departure_day_id UUID,
  itinerary_item_id UUID,
  change_type VARCHAR,
  severity VARCHAR,
  title VARCHAR,
  summary TEXT,
  previous_value JSONB,
  current_value JSONB,
  published_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
  SELECT notice.id,notice.departure_day_id,notice.itinerary_item_id,
    notice.change_type,notice.severity,notice.title,notice.summary,
    notice.previous_value,notice.current_value,notice.published_at,receipt.read_at
  FROM ops.traveler_change_notices notice
  JOIN travel.party_memberships membership
    ON membership.agency_id=notice.agency_id
   AND membership.departure_id=notice.departure_id
   AND membership.status='active'
  JOIN travel.traveler_profiles profile
    ON profile.agency_id=membership.agency_id
   AND profile.id=membership.traveler_id
  JOIN ops.legacy_id_map map
    ON map.source_system='public-v2'
   AND map.entity_type='user'
   AND map.target_id=profile.user_id
   AND map.legacy_id=p_actor_legacy
  LEFT JOIN ops.traveler_change_notice_receipts receipt
    ON receipt.notice_id=notice.id
   AND receipt.traveler_id=profile.id
  WHERE notice.agency_id=p_agency AND notice.departure_id=p_departure
  ORDER BY notice.published_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),100);
$$;

REVOKE ALL ON FUNCTION app.list_traveler_change_notices_v3(TEXT,UUID,UUID,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_traveler_change_notices_v3(TEXT,UUID,UUID,INTEGER) TO smf_app;

-- The mapping table must remain private from the runtime role.
REVOKE SELECT ON TABLE ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('104_v3_runtime_read_contract_fixes') ON CONFLICT(version) DO NOTHING;
