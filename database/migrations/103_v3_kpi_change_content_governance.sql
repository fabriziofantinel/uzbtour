-- KPI definitions are data, not prose: formulas remain versioned and auditable.
CREATE TABLE IF NOT EXISTS ops.analytics_kpi_definitions (
  code VARCHAR(50) NOT NULL,
  version SMALLINT NOT NULL CHECK (version > 0),
  label VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  numerator_definition TEXT NOT NULL,
  denominator_definition TEXT,
  formula TEXT NOT NULL,
  source_events TEXT[] NOT NULL DEFAULT '{}',
  refresh_interval INTERVAL NOT NULL DEFAULT INTERVAL '15 minutes',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  effective_to TIMESTAMPTZ,
  PRIMARY KEY (code, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

INSERT INTO ops.analytics_kpi_definitions
  (code,version,label,description,numerator_definition,denominator_definition,formula,source_events)
VALUES
  ('activation_rate',1,'Tasso di attivazione','Quota di inviti consegnati che hanno completato l’attivazione.','Inviti personali usati con account attivato.','Inviti personali consegnati, esclusi annullati, scaduti prima della consegna e duplicati tecnici.','activated_accounts / delivered_invitations * 100',ARRAY['invitation_delivered','account_activated']),
  ('departure_adoption',1,'Adozione per partenza','Quota di viaggiatori abilitati che hanno avviato almeno una sessione significativa.','Viaggiatori distinti con traveler_session nel periodo.','Viaggiatori con membership attiva nella partenza.','active_travelers / enabled_travelers * 100',ARRAY['traveler_session']),
  ('programme_usage',1,'Consultazione programma','Quota di viaggiatori abilitati che hanno aperto almeno una giornata.','Viaggiatori distinti con programme_view nel periodo.','Viaggiatori con membership attiva nella partenza.','programme_users / enabled_travelers * 100',ARRAY['programme_view']),
  ('document_usage',1,'Utilizzo documenti','Quota di viaggiatori abilitati che hanno aperto almeno un documento.','Viaggiatori distinti con document_download riuscito nel periodo.','Viaggiatori con membership attiva nella partenza.','document_users / enabled_travelers * 100',ARRAY['document_download']),
  ('notification_open_rate',1,'Apertura notifiche','Quota di notifiche consegnate che hanno prodotto un’apertura tracciata.','Notifiche distinte aperte.','Notifiche consegnate dal provider.','opened_notifications / delivered_notifications * 100',ARRAY['notification_delivered','notification_opened']),
  ('engagement_rate',1,'Engagement','Quota di viaggiatori abilitati che hanno completato almeno una sfida, inviato un ricordo o registrato una spesa.','Viaggiatori distinti con almeno un’azione qualificata nel periodo.','Viaggiatori con membership attiva nella partenza.','engaged_travelers / enabled_travelers * 100',ARRAY['challenge_completed','memory_submitted','expense_created'])
ON CONFLICT (code,version) DO NOTHING;

CREATE TABLE IF NOT EXISTS ops.traveler_change_notices (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  departure_id UUID NOT NULL,
  departure_day_id UUID,
  itinerary_item_id UUID,
  change_type VARCHAR(30) NOT NULL CHECK (change_type IN ('programme','transport','hotel','document','emergency','other')),
  severity VARCHAR(15) NOT NULL DEFAULT 'information' CHECK (severity IN ('information','important','urgent')),
  title VARCHAR(180) NOT NULL,
  summary TEXT NOT NULL,
  previous_value JSONB NOT NULL DEFAULT '{}',
  current_value JSONB NOT NULL DEFAULT '{}',
  changed_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id,departure_id,departure_day_id) REFERENCES travel.departure_days(agency_id,departure_id,id) ON DELETE SET NULL (departure_day_id),
  FOREIGN KEY (agency_id,departure_id,itinerary_item_id) REFERENCES travel.departure_itinerary_items(agency_id,departure_id,id) ON DELETE SET NULL (itinerary_item_id)
);
CREATE INDEX IF NOT EXISTS traveler_change_notices_scope_idx ON ops.traveler_change_notices(agency_id,departure_id,published_at DESC);

CREATE TABLE IF NOT EXISTS ops.traveler_change_notice_receipts (
  agency_id UUID NOT NULL,
  notice_id UUID NOT NULL REFERENCES ops.traveler_change_notices(id) ON DELETE CASCADE,
  traveler_id UUID NOT NULL REFERENCES travel.traveler_profiles(id) ON DELETE RESTRICT,
  read_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  client_operation_id UUID NOT NULL,
  PRIMARY KEY (notice_id,traveler_id),
  UNIQUE (traveler_id,client_operation_id)
);
CREATE INDEX IF NOT EXISTS traveler_change_receipts_tenant_idx ON ops.traveler_change_notice_receipts(agency_id,traveler_id,read_at DESC);

ALTER TABLE ops.traveler_change_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.traveler_change_notices FORCE ROW LEVEL SECURITY;
ALTER TABLE ops.traveler_change_notice_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.traveler_change_notice_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traveler_change_notices_tenant ON ops.traveler_change_notices;
CREATE POLICY traveler_change_notices_tenant ON ops.traveler_change_notices USING (agency_id=NULLIF(current_setting('app.agency_id',true),'')::uuid);
DROP POLICY IF EXISTS traveler_change_receipts_tenant ON ops.traveler_change_notice_receipts;
CREATE POLICY traveler_change_receipts_tenant ON ops.traveler_change_notice_receipts USING (agency_id=NULLIF(current_setting('app.agency_id',true),'')::uuid);

ALTER TABLE travel.template_useful_information
  ADD COLUMN IF NOT EXISTS source_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_retrieved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review','approved','expired','rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disclaimer TEXT NOT NULL DEFAULT 'Verifica sempre le informazioni sensibili sui siti ufficiali prima della partenza.';
CREATE INDEX IF NOT EXISTS useful_information_governance_idx
  ON travel.template_useful_information(agency_id,template_version_id,review_status,expires_at);

CREATE OR REPLACE FUNCTION app.acknowledge_traveler_change_notice_v3(
  p_actor_legacy TEXT,p_notice UUID,p_operation UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_traveler UUID;
BEGIN
 SELECT target_id INTO v_actor FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 SELECT notice.agency_id,profile.id INTO v_agency,v_traveler
 FROM ops.traveler_change_notices notice
 JOIN travel.party_memberships membership ON membership.agency_id=notice.agency_id AND membership.departure_id=notice.departure_id AND membership.status='active'
 JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id AND profile.user_id=v_actor
 WHERE notice.id=p_notice LIMIT 1;
 IF v_traveler IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='change notice not authorized';END IF;
 INSERT INTO ops.traveler_change_notice_receipts(agency_id,notice_id,traveler_id,client_operation_id)
 VALUES(v_agency,p_notice,v_traveler,p_operation) ON CONFLICT(notice_id,traveler_id) DO UPDATE SET read_at=clock_timestamp();
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION app.publish_traveler_change_notice_v3(
 p_actor_legacy TEXT,p_departure UUID,p_day UUID,p_type TEXT,p_severity TEXT,p_title TEXT,p_summary TEXT,p_previous JSONB,p_current JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_notice UUID;
BEGIN
 SELECT target_id INTO v_actor FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure
 JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id AND membership.user_id=v_actor AND membership.status='active'
 WHERE departure.id=p_departure AND membership.role IN('owner','editor') LIMIT 1;
 IF v_agency IS NULL OR NOT EXISTS(SELECT 1 FROM travel.departure_days WHERE agency_id=v_agency AND departure_id=p_departure AND id=p_day) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='change notice publication not authorized';
 END IF;
 INSERT INTO ops.traveler_change_notices(agency_id,departure_id,departure_day_id,change_type,severity,title,summary,previous_value,current_value,changed_by)
 VALUES(v_agency,p_departure,p_day,p_type,p_severity,left(p_title,180),p_summary,COALESCE(p_previous,'{}'),COALESCE(p_current,'{}'),v_actor) RETURNING id INTO v_notice;
 RETURN v_notice;
END $$;

REVOKE ALL ON ops.analytics_kpi_definitions,ops.traveler_change_notices,ops.traveler_change_notice_receipts FROM PUBLIC;
GRANT SELECT ON ops.analytics_kpi_definitions,ops.traveler_change_notices,ops.traveler_change_notice_receipts TO smf_app;
REVOKE ALL ON FUNCTION app.acknowledge_traveler_change_notice_v3(TEXT,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.acknowledge_traveler_change_notice_v3(TEXT,UUID,UUID) TO smf_app;
REVOKE ALL ON FUNCTION app.publish_traveler_change_notice_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_traveler_change_notice_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) TO smf_app;

INSERT INTO public.platform_schema_migrations(version) VALUES('103_v3_kpi_change_content_governance') ON CONFLICT(version) DO NOTHING;
