CREATE OR REPLACE FUNCTION app.claim_due_push_deliveries_v3()
RETURNS TABLE(run_id UUID,departure_id UUID,kind TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE candidate RECORD;v_run UUID;
BEGIN
  FOR candidate IN
    SELECT departure.agency_id,departure.id AS departure_id,'departure_reminder'::text AS kind,
      'departure_reminder:'||departure.starts_on::text AS event_key
    FROM travel.departures departure
    WHERE departure.status IN('open','confirmed') AND departure.starts_on=current_date+1
    UNION ALL
    SELECT departure.agency_id,departure.id,'quiz_unlock',
      'quiz_unlock:'||(clock_timestamp() AT TIME ZONE departure.timezone)::date::text
    FROM travel.departures departure
    WHERE departure.status IN('open','confirmed','in_progress')
      AND (clock_timestamp() AT TIME ZONE departure.timezone)::date BETWEEN departure.starts_on AND departure.ends_on
  LOOP
    INSERT INTO ops.push_delivery_runs(agency_id,departure_id,event_key,kind)
    VALUES(candidate.agency_id,candidate.departure_id,candidate.event_key,candidate.kind)
    ON CONFLICT ON CONSTRAINT push_delivery_runs_departure_id_event_key_key DO UPDATE SET
      status='claimed',claimed_at=clock_timestamp(),error_message=NULL
      WHERE ops.push_delivery_runs.status='failed'
        AND ops.push_delivery_runs.claimed_at<clock_timestamp()-interval '15 minutes'
    RETURNING id INTO v_run;
    IF v_run IS NOT NULL THEN RETURN QUERY SELECT v_run,candidate.departure_id,candidate.kind;END IF;
    v_run:=NULL;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION app.claim_due_push_deliveries_v3() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_due_push_deliveries_v3() TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('114_v3_scheduled_push_claim_contract') ON CONFLICT(version) DO NOTHING;
