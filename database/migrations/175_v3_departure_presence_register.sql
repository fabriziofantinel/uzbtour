-- A current attendance register is intentionally independent from itinerary days.
-- It is a field-operation snapshot, not a programme attendance history.

CREATE TABLE IF NOT EXISTS journey.departure_presence_register (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  is_present BOOLEAN NOT NULL DEFAULT false,
  recorded_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  FOREIGN KEY(agency_id,departure_id,party_id,traveler_id)
    REFERENCES travel.party_memberships(agency_id,departure_id,party_id,traveler_id) ON DELETE CASCADE,
  UNIQUE(departure_id,traveler_id)
);
CREATE INDEX IF NOT EXISTS departure_presence_register_scope_idx
  ON journey.departure_presence_register(agency_id,departure_id,party_id,is_present,traveler_id);

CREATE OR REPLACE FUNCTION app.set_departure_presence_v3(
  p_actor_user_id UUID,p_departure UUID,p_traveler UUID,p_is_present BOOLEAN
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey SET row_security=off AS $$
DECLARE v_agency UUID;v_party UUID;v_id UUID;
BEGIN
  SELECT agency_id INTO v_agency FROM travel.departures WHERE id=p_departure;
  IF v_agency IS NULL OR NOT app.is_departure_operator_v3(p_actor_user_id,p_departure) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='presence not authorized';
  END IF;
  SELECT party_id INTO v_party FROM travel.party_memberships
  WHERE agency_id=v_agency AND departure_id=p_departure AND traveler_id=p_traveler AND status='active';
  IF v_party IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='traveler not active on departure'; END IF;
  INSERT INTO journey.departure_presence_register(agency_id,departure_id,party_id,traveler_id,is_present,recorded_by)
  VALUES(v_agency,p_departure,v_party,p_traveler,p_is_present,p_actor_user_id)
  ON CONFLICT(departure_id,traveler_id) DO UPDATE SET is_present=EXCLUDED.is_present,
    recorded_by=EXCLUDED.recorded_by,recorded_at=clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.clear_departure_presence_v3(p_actor_user_id UUID,p_departure UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey SET row_security=off AS $$
DECLARE v_count INTEGER;
BEGIN
  IF NOT app.is_departure_operator_v3(p_actor_user_id,p_departure) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='presence not authorized';
  END IF;
  DELETE FROM journey.departure_presence_register WHERE departure_id=p_departure RETURNING 1 INTO v_count;
  RETURN COALESCE(v_count,0);
END $$;

CREATE OR REPLACE FUNCTION app.list_departure_presence_v3(p_actor_user_id UUID,p_departure UUID)
RETURNS TABLE(traveler_id UUID,party_id UUID,is_present BOOLEAN,recorded_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,journey,travel SET row_security=off AS $$
 SELECT register.traveler_id,register.party_id,register.is_present,register.recorded_at
 FROM journey.departure_presence_register register
 WHERE register.departure_id=p_departure AND app.is_departure_operator_v3(p_actor_user_id,p_departure);
$$;

REVOKE ALL ON FUNCTION app.set_departure_presence_v3(UUID,UUID,UUID,BOOLEAN),
  app.clear_departure_presence_v3(UUID,UUID),app.list_departure_presence_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_departure_presence_v3(UUID,UUID,UUID,BOOLEAN),
  app.clear_departure_presence_v3(UUID,UUID),app.list_departure_presence_v3(UUID,UUID) TO smf_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON journey.departure_presence_register TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('175_v3_departure_presence_register') ON CONFLICT(version) DO NOTHING;
