-- Allinea la creazione dei gruppi al contratto IAM V3 usato dalle altre
-- mutazioni di agenzia e registra l'audit direttamente nello schema V3.
CREATE OR REPLACE FUNCTION app.create_journey_party(
  p_actor_legacy_user_id TEXT,
  p_agency_id UUID,
  p_departure_id UUID,
  p_code TEXT,
  p_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public
SET row_security=off
AS $$
DECLARE v_actor_id UUID; v_party_id UUID;
BEGIN
  v_actor_id:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);

  IF NULLIF(btrim(p_name),'') IS NULL OR NULLIF(btrim(p_code),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='group name and code are required';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM travel.departures departure
    WHERE departure.id=p_departure_id AND departure.agency_id=p_agency_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='departure not found';
  END IF;

  INSERT INTO travel.travel_parties(agency_id,departure_id,code,name,status)
  VALUES(p_agency_id,p_departure_id,btrim(p_code),btrim(p_name),'invited')
  RETURNING id INTO v_party_id;

  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor_id,'travel_party',v_party_id::text,'created',
    jsonb_build_object('departureId',p_departure_id,'code',btrim(p_code)));
  RETURN v_party_id;
END $$;

REVOKE ALL ON FUNCTION app.create_journey_party(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_journey_party(TEXT,UUID,UUID,TEXT,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('081_v3_journey_party_creation_fix') ON CONFLICT(version) DO NOTHING;
