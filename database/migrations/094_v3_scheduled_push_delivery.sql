CREATE TABLE IF NOT EXISTS ops.push_delivery_runs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  departure_id UUID NOT NULL,
  event_key TEXT NOT NULL,
  kind VARCHAR(32) NOT NULL CHECK(kind IN('quiz_unlock','departure_reminder')),
  status VARCHAR(16) NOT NULL DEFAULT 'claimed' CHECK(status IN('claimed','sent','failed')),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK(sent_count>=0),
  revoked_count INTEGER NOT NULL DEFAULT 0 CHECK(revoked_count>=0),
  error_message TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY(agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  UNIQUE(departure_id,event_key)
);
CREATE INDEX IF NOT EXISTS push_delivery_runs_tenant_status_idx
  ON ops.push_delivery_runs(agency_id,status,claimed_at DESC,departure_id);
ALTER TABLE ops.push_delivery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.push_delivery_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops.push_delivery_runs FROM PUBLIC;

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
      -- Il cron Hobby viene eseguito una volta al giorno; l'event key locale mantiene
      -- l'idempotenza anche se Vercel applica una finestra di esecuzione variabile.
  LOOP
    INSERT INTO ops.push_delivery_runs(agency_id,departure_id,event_key,kind)
    VALUES(candidate.agency_id,candidate.departure_id,candidate.event_key,candidate.kind)
    ON CONFLICT(departure_id,event_key) DO UPDATE SET
      status='claimed',claimed_at=clock_timestamp(),error_message=NULL
      WHERE ops.push_delivery_runs.status='failed'
        AND ops.push_delivery_runs.claimed_at<clock_timestamp()-interval '15 minutes'
    RETURNING id INTO v_run;
    IF v_run IS NOT NULL THEN RETURN QUERY SELECT v_run,candidate.departure_id,candidate.kind;END IF;
    v_run:=NULL;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.complete_push_delivery_v3(
  p_run_id UUID,p_success BOOLEAN,p_sent INTEGER,p_revoked INTEGER,p_error TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
  UPDATE ops.push_delivery_runs SET status=CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
    sent_count=greatest(COALESCE(p_sent,0),0),revoked_count=greatest(COALESCE(p_revoked,0),0),
    error_message=left(p_error,1000),completed_at=clock_timestamp()
  WHERE id=p_run_id AND status='claimed'
$$;
REVOKE ALL ON FUNCTION app.claim_due_push_deliveries_v3(),app.complete_push_delivery_v3(UUID,BOOLEAN,INTEGER,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_due_push_deliveries_v3(),app.complete_push_delivery_v3(UUID,BOOLEAN,INTEGER,INTEGER,TEXT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('094_v3_scheduled_push_delivery') ON CONFLICT(version) DO NOTHING;
