-- DELETE RETURNING INTO a scalar fails when the register has multiple rows.
CREATE OR REPLACE FUNCTION app.clear_departure_presence_v3(p_actor_user_id UUID,p_departure UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey SET row_security=off AS $$
DECLARE v_count INTEGER;
BEGIN
  IF NOT app.is_departure_operator_v3(p_actor_user_id,p_departure) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='presence not authorized';
  END IF;
  DELETE FROM journey.departure_presence_register WHERE departure_id=p_departure;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION app.clear_departure_presence_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.clear_departure_presence_v3(UUID,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('183_v3_clear_departure_presence_fix') ON CONFLICT(version) DO NOTHING;
