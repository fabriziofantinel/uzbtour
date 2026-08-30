CREATE TABLE IF NOT EXISTS ops.product_analytics_events (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  traveler_id UUID REFERENCES travel.traveler_profiles(id) ON DELETE SET NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID,
  event_name VARCHAR(40) NOT NULL CHECK (event_name IN (
    'traveler_session','programme_view','document_list_view','document_download'
  )),
  session_id UUID NOT NULL,
  client_operation_id UUID NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(properties) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id) ON DELETE SET NULL (departure_day_id),
  UNIQUE (actor_user_id, client_operation_id)
);

CREATE INDEX IF NOT EXISTS product_analytics_tenant_period_idx
  ON ops.product_analytics_events (agency_id, occurred_at DESC, event_name, departure_id);
CREATE INDEX IF NOT EXISTS product_analytics_departure_actor_idx
  ON ops.product_analytics_events (agency_id, departure_id, actor_user_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS product_analytics_session_event_ux
  ON ops.product_analytics_events (
    actor_user_id,session_id,event_name,departure_id,
    COALESCE(departure_day_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(properties->>'documentId','')
  );

ALTER TABLE ops.product_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.product_analytics_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops.product_analytics_events FROM PUBLIC;
GRANT SELECT ON TABLE ops.product_analytics_events TO smf_app;

DROP POLICY IF EXISTS product_analytics_tenant_policy ON ops.product_analytics_events;
CREATE POLICY product_analytics_tenant_policy ON ops.product_analytics_events
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid)
  WITH CHECK (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION app.record_product_analytics_event_v3(
  p_actor_legacy TEXT,
  p_departure UUID,
  p_party UUID,
  p_day UUID,
  p_event_name TEXT,
  p_session UUID,
  p_operation UUID,
  p_properties JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops
SET row_security=off AS $$
DECLARE v_actor UUID; v_agency UUID; v_traveler UUID; v_id UUID;
BEGIN
  SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
  SELECT party.agency_id,profile.id INTO v_agency,v_traveler
  FROM travel.travel_parties party
  JOIN travel.party_memberships membership ON membership.agency_id=party.agency_id
    AND membership.departure_id=party.departure_id AND membership.party_id=party.id
    AND membership.status='active'
  JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id
    AND profile.id=membership.traveler_id AND profile.user_id=v_actor
  WHERE party.id=p_party AND party.departure_id=p_departure LIMIT 1;
  IF v_actor IS NULL OR v_agency IS NULL OR p_event_name NOT IN
    ('traveler_session','programme_view','document_list_view','document_download')
    OR jsonb_typeof(COALESCE(p_properties,'{}'::jsonb)) <> 'object'
    OR (p_day IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM travel.departure_days day WHERE day.agency_id=v_agency
        AND day.departure_id=p_departure AND day.id=p_day
    )) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='analytics event not authorized';
  END IF;
  IF (SELECT count(*) FROM ops.product_analytics_events event
      WHERE event.actor_user_id=v_actor AND event.occurred_at>=clock_timestamp()-interval '1 hour') >= 120 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='analytics event rate limit exceeded';
  END IF;
  INSERT INTO ops.product_analytics_events(
    agency_id,actor_user_id,traveler_id,departure_id,party_id,departure_day_id,
    event_name,session_id,client_operation_id,properties
  ) VALUES (
    v_agency,v_actor,v_traveler,p_departure,p_party,p_day,p_event_name,p_session,p_operation,
    COALESCE(p_properties,'{}'::jsonb)
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT event.id INTO v_id FROM ops.product_analytics_events event
    WHERE event.actor_user_id=v_actor AND (
      event.client_operation_id=p_operation OR (
        event.session_id=p_session AND event.event_name=p_event_name
        AND event.departure_id=p_departure
        AND COALESCE(event.departure_day_id,'00000000-0000-0000-0000-000000000000'::uuid)
          =COALESCE(p_day,'00000000-0000-0000-0000-000000000000'::uuid)
        AND COALESCE(event.properties->>'documentId','')=COALESCE(p_properties->>'documentId','')
      )
    ) ORDER BY event.created_at LIMIT 1;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.record_product_analytics_event_v3(TEXT,UUID,UUID,UUID,TEXT,UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_product_analytics_event_v3(TEXT,UUID,UUID,UUID,TEXT,UUID,UUID,JSONB) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('102_v3_agency_product_analytics') ON CONFLICT(version) DO NOTHING;
