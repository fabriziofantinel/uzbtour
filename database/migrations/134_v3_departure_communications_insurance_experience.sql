-- Functional wave 1: official departure communications, insurance and
-- profile-aware content publication.

ALTER TABLE ops.traveler_change_notices
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'change'
    CHECK (kind IN ('change','announcement')),
  ADD COLUMN IF NOT EXISTS requires_acknowledgement BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS acknowledge_by TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audience_party_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS client_operation_id UUID,
  ADD COLUMN IF NOT EXISTS revision_of UUID REFERENCES ops.traveler_change_notices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number > 0),
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES iam.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS closure_note TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS traveler_change_notices_operation_uidx
  ON ops.traveler_change_notices(agency_id,client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops.traveler_change_notice_recipients (
  agency_id UUID NOT NULL,
  notice_id UUID NOT NULL REFERENCES ops.traveler_change_notices(id) ON DELETE CASCADE,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  reachable_by_push BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (notice_id,traveler_id),
  FOREIGN KEY (agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  FOREIGN KEY (traveler_id) REFERENCES travel.traveler_profiles(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS traveler_change_notice_recipients_scope_idx
  ON ops.traveler_change_notice_recipients(agency_id,departure_id,notice_id,party_id,traveler_id);

CREATE TABLE IF NOT EXISTS ops.change_notice_reminders (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  notice_id UUID NOT NULL REFERENCES ops.traveler_change_notices(id) ON DELETE CASCADE,
  traveler_id UUID NOT NULL REFERENCES travel.traveler_profiles(id) ON DELETE RESTRICT,
  channel VARCHAR(12) NOT NULL CHECK (channel IN ('push','email','group_leader')),
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('sent','unreachable','failed','reported')),
  actor_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  details JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX IF NOT EXISTS change_notice_reminders_rate_idx
  ON ops.change_notice_reminders(agency_id,notice_id,traveler_id,channel,sent_at DESC);

ALTER TABLE ops.traveler_change_notice_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.traveler_change_notice_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE ops.change_notice_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.change_notice_reminders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traveler_change_notice_recipients_tenant ON ops.traveler_change_notice_recipients;
CREATE POLICY traveler_change_notice_recipients_tenant ON ops.traveler_change_notice_recipients
  USING (agency_id=NULLIF(current_setting('app.agency_id',true),'')::uuid);
DROP POLICY IF EXISTS change_notice_reminders_tenant ON ops.change_notice_reminders;
CREATE POLICY change_notice_reminders_tenant ON ops.change_notice_reminders
  USING (agency_id=NULLIF(current_setting('app.agency_id',true),'')::uuid);

CREATE OR REPLACE FUNCTION app.snapshot_traveler_change_notice_recipients_v3()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey,ops SET row_security=off AS $$
BEGIN
 INSERT INTO ops.traveler_change_notice_recipients(
  agency_id,notice_id,departure_id,party_id,traveler_id,user_id,reachable_by_push)
 SELECT membership.agency_id,NEW.id,membership.departure_id,membership.party_id,membership.traveler_id,profile.user_id,
  EXISTS(SELECT 1 FROM journey.web_push_subscriptions subscription
   WHERE subscription.agency_id=membership.agency_id AND subscription.traveler_id=membership.traveler_id
    AND subscription.revoked_at IS NULL AND (subscription.expires_at IS NULL OR subscription.expires_at>clock_timestamp()))
 FROM travel.party_memberships membership JOIN travel.traveler_profiles profile
  ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
 WHERE membership.agency_id=NEW.agency_id AND membership.departure_id=NEW.departure_id AND membership.status='active'
  AND (cardinality(NEW.audience_party_ids)=0 OR membership.party_id=ANY(NEW.audience_party_ids))
 ON CONFLICT(notice_id,traveler_id) DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS snapshot_change_notice_recipients ON ops.traveler_change_notices;
CREATE TRIGGER snapshot_change_notice_recipients AFTER INSERT ON ops.traveler_change_notices
FOR EACH ROW EXECUTE FUNCTION app.snapshot_traveler_change_notice_recipients_v3();

INSERT INTO ops.traveler_change_notice_recipients(
 agency_id,notice_id,departure_id,party_id,traveler_id,user_id,reachable_by_push)
SELECT notice.agency_id,notice.id,notice.departure_id,membership.party_id,membership.traveler_id,profile.user_id,
 EXISTS(SELECT 1 FROM journey.web_push_subscriptions subscription
  WHERE subscription.agency_id=membership.agency_id AND subscription.traveler_id=membership.traveler_id
   AND subscription.revoked_at IS NULL AND (subscription.expires_at IS NULL OR subscription.expires_at>clock_timestamp()))
FROM ops.traveler_change_notices notice JOIN travel.party_memberships membership
 ON membership.agency_id=notice.agency_id AND membership.departure_id=notice.departure_id AND membership.status='active'
JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
WHERE cardinality(notice.audience_party_ids)=0 OR membership.party_id=ANY(notice.audience_party_ids)
ON CONFLICT(notice_id,traveler_id) DO NOTHING;

CREATE OR REPLACE FUNCTION app.list_traveler_change_notices_v3(
 p_actor_legacy TEXT,p_agency UUID,p_departure UUID,p_limit INTEGER DEFAULT 100
) RETURNS TABLE(id UUID,departure_day_id UUID,itinerary_item_id UUID,change_type VARCHAR,severity VARCHAR,
 title VARCHAR,summary TEXT,previous_value JSONB,current_value JSONB,published_at TIMESTAMPTZ,read_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
 SELECT notice.id,notice.departure_day_id,notice.itinerary_item_id,notice.change_type,notice.severity,
  notice.title,notice.summary,notice.previous_value,notice.current_value,notice.published_at,receipt.read_at
 FROM ops.traveler_change_notice_recipients recipient
 JOIN ops.traveler_change_notices notice ON notice.id=recipient.notice_id AND notice.agency_id=recipient.agency_id
 JOIN travel.traveler_profiles profile ON profile.agency_id=recipient.agency_id AND profile.id=recipient.traveler_id
 JOIN ops.legacy_id_map map ON map.source_system='public-v2' AND map.entity_type='user'
  AND map.target_id=profile.user_id AND map.legacy_id=p_actor_legacy
 LEFT JOIN ops.traveler_change_notice_receipts receipt ON receipt.notice_id=notice.id AND receipt.traveler_id=recipient.traveler_id
 WHERE recipient.agency_id=p_agency AND recipient.departure_id=p_departure
 ORDER BY notice.published_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),100);
$$;

CREATE OR REPLACE FUNCTION app.acknowledge_traveler_change_notice_v3(p_actor_legacy TEXT,p_notice UUID,p_operation UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_traveler UUID;
BEGIN
 SELECT target_id INTO v_actor FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 SELECT recipient.agency_id,recipient.traveler_id INTO v_agency,v_traveler
 FROM ops.traveler_change_notice_recipients recipient JOIN travel.traveler_profiles profile
  ON profile.agency_id=recipient.agency_id AND profile.id=recipient.traveler_id AND profile.user_id=v_actor
 WHERE recipient.notice_id=p_notice LIMIT 1;
 IF v_traveler IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='change notice not authorized';END IF;
 INSERT INTO ops.traveler_change_notice_receipts(agency_id,notice_id,traveler_id,client_operation_id)
 VALUES(v_agency,p_notice,v_traveler,p_operation) ON CONFLICT(notice_id,traveler_id) DO UPDATE SET read_at=clock_timestamp();
 RETURN TRUE;
END $$;

ALTER TABLE travel.trip_template_versions
  ADD COLUMN IF NOT EXISTS experience_profile VARCHAR(20) NOT NULL DEFAULT 'complete'
    CHECK (experience_profile IN ('essential','standard','complete'));
ALTER TABLE travel.departures
  ADD COLUMN IF NOT EXISTS experience_profile VARCHAR(20) NOT NULL DEFAULT 'complete'
    CHECK (experience_profile IN ('essential','standard','complete'));
ALTER TABLE ops.generation_runs
  ADD COLUMN IF NOT EXISTS experience_profile VARCHAR(20)
    CHECK (experience_profile IN ('essential','standard','complete'));

CREATE OR REPLACE FUNCTION app.set_generation_run_experience_profile_v3()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
BEGIN
 IF NEW.experience_profile IS NULL AND NEW.import_job_id IS NOT NULL THEN
  SELECT version.experience_profile INTO NEW.experience_profile
  FROM ops.import_jobs import_job JOIN travel.trip_template_versions version
   ON version.agency_id=import_job.agency_id AND version.template_id=import_job.template_id
  WHERE import_job.id=NEW.import_job_id ORDER BY version.version_number DESC LIMIT 1;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS generation_run_experience_profile ON ops.generation_runs;
CREATE TRIGGER generation_run_experience_profile BEFORE INSERT ON ops.generation_runs
FOR EACH ROW EXECUTE FUNCTION app.set_generation_run_experience_profile_v3();

ALTER TABLE ops.media_assets DROP CONSTRAINT IF EXISTS media_assets_purpose_check;
ALTER TABLE ops.media_assets ADD CONSTRAINT media_assets_purpose_check CHECK (purpose IN
 ('source_document','normalized_document','ticket','voucher','insurance','memory','challenge_evidence','contest_entry','other'));

CREATE TABLE IF NOT EXISTS travel.departure_insurance_policies (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  provider_name VARCHAR(180) NOT NULL CHECK (btrim(provider_name)<>''),
  product_name VARCHAR(180) NOT NULL DEFAULT '',
  policy_number VARCHAR(120) NOT NULL CHECK (btrim(policy_number)<>''),
  assistance_phone VARCHAR(80) NOT NULL CHECK (btrim(assistance_phone)<>''),
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  guarantees JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(guarantees)='array'),
  document_id UUID,
  version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number>0),
  status VARCHAR(20) NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','archived')),
  created_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id,document_id) REFERENCES ops.travel_documents(agency_id,id) ON DELETE SET NULL,
  UNIQUE (agency_id,departure_id,version_number),
  CHECK (valid_to>=valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS departure_insurance_current_uidx
  ON travel.departure_insurance_policies(agency_id,departure_id) WHERE status='current';
CREATE INDEX IF NOT EXISTS departure_insurance_scope_idx
  ON travel.departure_insurance_policies(agency_id,departure_id,status,version_number DESC);
ALTER TABLE travel.departure_insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel.departure_insurance_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departure_insurance_tenant ON travel.departure_insurance_policies;
CREATE POLICY departure_insurance_tenant ON travel.departure_insurance_policies
  USING (agency_id=NULLIF(current_setting('app.agency_id',true),'')::uuid);

CREATE OR REPLACE FUNCTION app.publish_departure_communication_v3(
  p_actor_legacy TEXT,p_departure UUID,p_title TEXT,p_summary TEXT,p_severity TEXT,
  p_requires_ack BOOLEAN,p_acknowledge_by TIMESTAMPTZ,p_audience UUID[],p_operation UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_notice UUID;v_existing UUID;
BEGIN
 SELECT target_id INTO v_actor FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure
 JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id
  AND membership.user_id=v_actor AND membership.status='active' AND membership.role IN('owner','admin','editor')
 WHERE departure.id=p_departure AND departure.status NOT IN('cancelled','archived') LIMIT 1;
 IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='communication publication not authorized';END IF;
 IF btrim(COALESCE(p_title,''))='' OR btrim(COALESCE(p_summary,''))='' OR p_severity NOT IN('information','important','urgent') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid communication';END IF;
 IF COALESCE(cardinality(p_audience),0)>0 AND EXISTS(
  SELECT 1 FROM unnest(p_audience) audience_id WHERE NOT EXISTS(
   SELECT 1 FROM travel.travel_parties party WHERE party.agency_id=v_agency AND party.departure_id=p_departure AND party.id=audience_id))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid communication audience';END IF;
 SELECT id INTO v_existing FROM ops.traveler_change_notices
  WHERE agency_id=v_agency AND client_operation_id=p_operation LIMIT 1;
 IF v_existing IS NOT NULL THEN RETURN v_existing;END IF;
 INSERT INTO ops.traveler_change_notices(
  agency_id,departure_id,change_type,severity,title,summary,changed_by,kind,
  requires_acknowledgement,acknowledge_by,audience_party_ids,client_operation_id)
 VALUES(v_agency,p_departure,'other',p_severity,left(btrim(p_title),180),btrim(p_summary),v_actor,'announcement',
  p_requires_ack,p_acknowledge_by,COALESCE(p_audience,'{}'),p_operation) RETURNING id INTO v_notice;
 RETURN v_notice;
END $$;

CREATE OR REPLACE FUNCTION app.read_departure_communications_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS TABLE(
 id UUID,title TEXT,summary TEXT,severity VARCHAR,requires_acknowledgement BOOLEAN,acknowledge_by TIMESTAMPTZ,
 audience_party_ids UUID[],published_at TIMESTAMPTZ,recipient_count BIGINT,read_count BIGINT,unreachable_count BIGINT,
 overdue BOOLEAN,closed_at TIMESTAMPTZ,closure_note TEXT
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
 WITH actor AS (
  SELECT target_id id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1
 ), allowed AS (
  SELECT departure.agency_id FROM travel.departures departure,actor
  JOIN iam.agency_memberships membership ON membership.user_id=actor.id AND membership.status='active'
  WHERE departure.id=p_departure AND membership.agency_id=departure.agency_id AND membership.role IN('owner','admin','editor','viewer')
 )
 SELECT notice.id,notice.title,notice.summary,notice.severity,notice.requires_acknowledgement,notice.acknowledge_by,
  notice.audience_party_ids,notice.published_at,count(recipient.traveler_id),count(receipt.traveler_id),
  count(recipient.traveler_id) FILTER(WHERE NOT recipient.reachable_by_push),
  notice.requires_acknowledgement AND notice.closed_at IS NULL AND notice.acknowledge_by<clock_timestamp()
   AND count(receipt.traveler_id)<count(recipient.traveler_id),notice.closed_at,notice.closure_note
 FROM ops.traveler_change_notices notice JOIN allowed ON allowed.agency_id=notice.agency_id
 LEFT JOIN ops.traveler_change_notice_recipients recipient ON recipient.notice_id=notice.id
 LEFT JOIN ops.traveler_change_notice_receipts receipt ON receipt.notice_id=notice.id AND receipt.traveler_id=recipient.traveler_id
 WHERE notice.departure_id=p_departure
 GROUP BY notice.id ORDER BY notice.published_at DESC;
$$;

CREATE OR REPLACE FUNCTION app.read_departure_communication_recipients_v3(p_actor_legacy TEXT,p_notice UUID)
RETURNS TABLE(traveler_id UUID,party_id UUID,display_name TEXT,email TEXT,read_at TIMESTAMPTZ,reachable_by_push BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
 WITH actor AS (
  SELECT target_id id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1
 )
 SELECT recipient.traveler_id,recipient.party_id,profile.display_name,profile.email,receipt.read_at,recipient.reachable_by_push
 FROM ops.traveler_change_notice_recipients recipient
 JOIN ops.traveler_change_notices notice ON notice.id=recipient.notice_id AND notice.agency_id=recipient.agency_id
 JOIN actor ON true JOIN iam.agency_memberships membership ON membership.agency_id=recipient.agency_id
  AND membership.user_id=actor.id AND membership.status='active' AND membership.role IN('owner','admin','editor','viewer')
 JOIN travel.traveler_profiles profile ON profile.agency_id=recipient.agency_id AND profile.id=recipient.traveler_id
 LEFT JOIN ops.traveler_change_notice_receipts receipt ON receipt.notice_id=recipient.notice_id AND receipt.traveler_id=recipient.traveler_id
 WHERE recipient.notice_id=p_notice ORDER BY receipt.read_at NULLS FIRST,profile.display_name;
$$;

CREATE OR REPLACE FUNCTION app.list_notice_branded_web_push_subscriptions_v3(p_notice UUID,p_traveler UUID DEFAULT NULL)
RETURNS TABLE(id UUID,endpoint TEXT,p256dh TEXT,auth_secret TEXT,agency_logo_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,journey,ops SET row_security=off AS $$
 SELECT DISTINCT ON(subscription.id) subscription.id,subscription.endpoint,subscription.p256dh,subscription.auth_secret,
  agency.branding->>'logoUrl'
 FROM ops.traveler_change_notice_recipients recipient
 JOIN journey.web_push_subscriptions subscription ON subscription.agency_id=recipient.agency_id
  AND subscription.traveler_id=recipient.traveler_id AND subscription.revoked_at IS NULL
  AND (subscription.expires_at IS NULL OR subscription.expires_at>clock_timestamp())
 JOIN iam.agencies agency ON agency.id=recipient.agency_id
 WHERE recipient.notice_id=p_notice AND (p_traveler IS NULL OR recipient.traveler_id=p_traveler)
 ORDER BY subscription.id,subscription.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION app.record_change_notice_reminder_v3(
 p_actor_legacy TEXT,p_notice UUID,p_traveler UUID,p_channel TEXT,p_outcome TEXT,p_details JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_id UUID;
BEGIN
 SELECT target_id INTO v_actor FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 SELECT notice.agency_id INTO v_agency FROM ops.traveler_change_notices notice
 JOIN iam.agency_memberships membership ON membership.agency_id=notice.agency_id AND membership.user_id=v_actor
  AND membership.status='active' AND membership.role IN('owner','admin','editor')
 JOIN ops.traveler_change_notice_recipients recipient ON recipient.notice_id=notice.id AND recipient.traveler_id=p_traveler
 LEFT JOIN ops.traveler_change_notice_receipts receipt ON receipt.notice_id=notice.id AND receipt.traveler_id=p_traveler
 WHERE notice.id=p_notice AND receipt.traveler_id IS NULL LIMIT 1;
 IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reminder not authorized';END IF;
 IF p_channel NOT IN('push','email','group_leader') OR p_outcome NOT IN('sent','unreachable','failed','reported')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid reminder';END IF;
 IF EXISTS(SELECT 1 FROM ops.change_notice_reminders reminder WHERE reminder.agency_id=v_agency
  AND reminder.notice_id=p_notice AND reminder.traveler_id=p_traveler AND reminder.channel=p_channel
  AND reminder.sent_at>clock_timestamp()-interval '6 hours')
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='reminder rate limit: wait six hours';END IF;
 INSERT INTO ops.change_notice_reminders(agency_id,notice_id,traveler_id,channel,outcome,actor_id,details)
 VALUES(v_agency,p_notice,p_traveler,p_channel,p_outcome,v_actor,COALESCE(p_details,'{}')) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.close_departure_communication_v3(p_actor_legacy TEXT,p_notice UUID,p_note TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
DECLARE v_actor UUID;
BEGIN
 SELECT target_id INTO v_actor FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 UPDATE ops.traveler_change_notices notice SET closed_at=clock_timestamp(),closed_by=v_actor,closure_note=btrim(p_note)
 FROM iam.agency_memberships membership WHERE notice.id=p_notice AND membership.agency_id=notice.agency_id
  AND membership.user_id=v_actor AND membership.status='active' AND membership.role IN('owner','admin','editor')
  AND notice.kind='announcement' AND notice.closed_at IS NULL AND length(btrim(COALESCE(p_note,'')))>=3;
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.save_departure_insurance_v3(
 p_actor_legacy TEXT,p_departure UUID,p_provider TEXT,p_product TEXT,p_policy_number TEXT,p_phone TEXT,
 p_valid_from DATE,p_valid_to DATE,p_guarantees JSONB,p_document UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_id UUID;v_version INTEGER;
BEGIN
 SELECT target_id INTO v_actor FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure JOIN iam.agency_memberships membership
  ON membership.agency_id=departure.agency_id AND membership.user_id=v_actor AND membership.status='active'
  AND membership.role IN('owner','admin','editor') WHERE departure.id=p_departure LIMIT 1;
 IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='insurance update not authorized';END IF;
 IF p_valid_to<p_valid_from OR jsonb_typeof(COALESCE(p_guarantees,'[]'))<>'array' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid insurance policy';END IF;
 IF p_document IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ops.travel_documents document
  WHERE document.agency_id=v_agency AND document.departure_id=p_departure AND document.id=p_document AND document.status='ready')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid insurance document';END IF;
 SELECT COALESCE(max(version_number),0)+1 INTO v_version FROM travel.departure_insurance_policies
  WHERE agency_id=v_agency AND departure_id=p_departure;
 UPDATE travel.departure_insurance_policies SET status='superseded',updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND departure_id=p_departure AND status='current';
 INSERT INTO travel.departure_insurance_policies(agency_id,departure_id,provider_name,product_name,policy_number,
  assistance_phone,valid_from,valid_to,guarantees,document_id,version_number,created_by)
 VALUES(v_agency,p_departure,btrim(p_provider),btrim(COALESCE(p_product,'')),btrim(p_policy_number),btrim(p_phone),
  p_valid_from,p_valid_to,COALESCE(p_guarantees,'[]'),p_document,v_version,v_actor) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.register_departure_insurance_document_v3(
 p_actor_legacy TEXT,p_departure UUID,p_media UUID,p_document UUID,p_provider TEXT,p_bucket TEXT,p_key TEXT,
 p_name TEXT,p_content_type TEXT,p_size BIGINT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;
BEGIN
 SELECT target_id INTO v_actor FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure JOIN iam.agency_memberships membership
  ON membership.agency_id=departure.agency_id AND membership.user_id=v_actor AND membership.status='active'
  AND membership.role IN('owner','admin','editor') WHERE departure.id=p_departure LIMIT 1;
 IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='insurance upload not authorized';END IF;
 IF p_provider NOT IN('r2','s3') OR p_content_type<>'application/pdf' OR p_size<=0 OR p_size>26214400
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid insurance document';END IF;
 INSERT INTO ops.media_assets(id,agency_id,departure_id,uploaded_by_user_id,provider,bucket,object_key,
  original_name,content_type,size_bytes,purpose,visibility,status)
 VALUES(p_media,v_agency,p_departure,v_actor,p_provider,p_bucket,p_key,left(p_name,500),p_content_type,p_size,'insurance','departure','ready');
 INSERT INTO ops.travel_documents(id,agency_id,departure_id,media_asset_id,document_type,title,status)
 VALUES(p_document,v_agency,p_departure,p_media,'insurance',left(p_name,500),'ready');
 RETURN p_document;
END $$;

CREATE OR REPLACE FUNCTION app.read_departure_insurance_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS TABLE(id UUID,agency_id UUID,provider_name VARCHAR,product_name VARCHAR,policy_number VARCHAR,
 assistance_phone VARCHAR,valid_from DATE,valid_to DATE,guarantees JSONB,document_id UUID,document_title TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
 WITH actor AS (SELECT target_id id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1),
 allowed AS (
  SELECT departure.agency_id FROM travel.departures departure,actor WHERE departure.id=p_departure AND (
   EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=departure.agency_id AND membership.user_id=actor.id AND membership.status='active')
   OR EXISTS(SELECT 1 FROM travel.party_memberships party_membership JOIN travel.traveler_profiles profile
    ON profile.agency_id=party_membership.agency_id AND profile.id=party_membership.traveler_id
    WHERE party_membership.agency_id=departure.agency_id AND party_membership.departure_id=departure.id
     AND party_membership.status='active' AND profile.user_id=actor.id)))
 SELECT policy.id,policy.agency_id,policy.provider_name,policy.product_name,policy.policy_number,
  policy.assistance_phone,policy.valid_from,policy.valid_to,policy.guarantees,policy.document_id,document.title
 FROM travel.departure_insurance_policies policy JOIN allowed ON allowed.agency_id=policy.agency_id
 LEFT JOIN ops.travel_documents document ON document.agency_id=policy.agency_id AND document.id=policy.document_id
 WHERE policy.departure_id=p_departure AND policy.status='current' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app.set_departure_experience_profile_v3(p_actor_legacy TEXT,p_departure UUID,p_profile TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,content,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_version UUID;v_previous TEXT;
BEGIN
 IF p_profile NOT IN('essential','standard','complete') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid experience profile';END IF;
 SELECT target_id INTO v_actor FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1;
 SELECT departure.agency_id,departure.template_version_id,departure.experience_profile INTO v_agency,v_version,v_previous
 FROM travel.departures departure JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id
  AND membership.user_id=v_actor AND membership.status='active' AND membership.role IN('owner','admin','editor')
 WHERE departure.id=p_departure LIMIT 1;
 IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='experience profile update not authorized';END IF;
 UPDATE travel.departures SET experience_profile=p_profile,updated_at=clock_timestamp() WHERE id=p_departure AND agency_id=v_agency;
 UPDATE travel.trip_template_versions SET experience_profile=p_profile WHERE id=v_version AND agency_id=v_agency;
 IF p_profile='essential' THEN UPDATE content.activities SET status='archived',updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND template_version_id=v_version AND status='approved';
 ELSIF p_profile='standard' THEN
  UPDATE content.activities SET status='approved',updated_at=clock_timestamp()
   WHERE agency_id=v_agency AND template_version_id=v_version AND status='archived' AND activity_type='quiz';
  UPDATE content.activities SET status='archived',updated_at=clock_timestamp()
   WHERE agency_id=v_agency AND template_version_id=v_version AND status='approved' AND activity_type<>'quiz';
 ELSIF v_previous<>p_profile THEN UPDATE content.activities SET status='approved',updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND template_version_id=v_version AND status='archived';
 END IF;
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION app.read_departure_experience_profile_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
 WITH actor AS (SELECT target_id id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1)
 SELECT departure.experience_profile FROM travel.departures departure,actor WHERE departure.id=p_departure AND (
  EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=departure.agency_id AND membership.user_id=actor.id AND membership.status='active')
  OR EXISTS(SELECT 1 FROM travel.party_memberships party_membership JOIN travel.traveler_profiles profile
   ON profile.agency_id=party_membership.agency_id AND profile.id=party_membership.traveler_id
   WHERE party_membership.agency_id=departure.agency_id AND party_membership.departure_id=departure.id
    AND party_membership.status='active' AND profile.user_id=actor.id)) LIMIT 1;
$$;

-- The gate must validate only the content promised by the selected profile.
CREATE OR REPLACE FUNCTION app.validate_template_version_publish(p_agency_id UUID,p_version_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,content,ref AS $$
DECLARE v_day RECORD;v_count INTEGER;v_item_count INTEGER;v_profile TEXT;
BEGIN
 IF p_agency_id IS DISTINCT FROM app.current_agency_id() THEN RAISE EXCEPTION 'tenant context mismatch';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_version_id::text,0));
 SELECT experience_profile INTO v_profile FROM travel.trip_template_versions
  WHERE agency_id=p_agency_id AND id=p_version_id AND status='draft' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'draft template version % not found',p_version_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM travel.template_days WHERE agency_id=p_agency_id AND template_version_id=p_version_id)
  THEN RAISE EXCEPTION 'publish gate: at least one programme day is required';END IF;
 IF v_profile IN('standard','complete') THEN
  FOR v_day IN SELECT id,day_number FROM travel.template_days WHERE agency_id=p_agency_id AND template_version_id=p_version_id LOOP
   SELECT count(*) INTO v_count FROM content.activities WHERE agency_id=p_agency_id AND template_version_id=p_version_id AND template_day_id=v_day.id AND activity_type='quiz' AND status='approved';
   SELECT count(*) INTO v_item_count FROM content.activity_items item JOIN content.activities activity ON activity.id=item.activity_id
    WHERE activity.agency_id=p_agency_id AND activity.template_version_id=p_version_id AND activity.template_day_id=v_day.id
     AND activity.activity_type='quiz' AND activity.status='approved' AND item.item_kind='question' AND item.answer_spec<>'{}';
   IF v_count<>1 OR v_item_count<>10 THEN RAISE EXCEPTION 'publish gate day %: standard profile requires one 10-question quiz',v_day.day_number;END IF;
  END LOOP;
 END IF;
 IF v_profile='complete' THEN
  FOR v_day IN SELECT id,day_number FROM travel.template_days WHERE agency_id=p_agency_id AND template_version_id=p_version_id LOOP
   SELECT count(*) INTO v_item_count FROM content.activity_items item JOIN content.activities activity ON activity.id=item.activity_id
    WHERE activity.agency_id=p_agency_id AND activity.template_version_id=p_version_id AND activity.template_day_id=v_day.id
     AND activity.activity_type='mission' AND activity.status='approved' AND item.item_kind='mission';
   IF v_item_count<>5 THEN RAISE EXCEPTION 'publish gate day %: complete profile requires 5 missions',v_day.day_number;END IF;
   SELECT count(*) INTO v_count FROM content.activities WHERE agency_id=p_agency_id AND template_version_id=p_version_id
    AND template_day_id=v_day.id AND status='approved' AND activity_type IN('word_game','order_game','puzzle');
   IF v_count<>3 THEN RAISE EXCEPTION 'publish gate day %: complete profile requires 3 games',v_day.day_number;END IF;
   SELECT count(DISTINCT contest_category) INTO v_count FROM content.activities WHERE agency_id=p_agency_id AND template_version_id=p_version_id
    AND template_day_id=v_day.id AND activity_type='photo_contest' AND status='approved' AND max_entries=2;
   IF v_count<>2 THEN RAISE EXCEPTION 'publish gate day %: complete profile requires 2 contests',v_day.day_number;END IF;
  END LOOP;
  SELECT count(*) INTO v_item_count FROM content.activity_items item JOIN content.activities activity ON activity.id=item.activity_id
   WHERE activity.agency_id=p_agency_id AND activity.template_version_id=p_version_id AND activity.template_day_id IS NULL
    AND activity.activity_type='bingo' AND activity.status='approved' AND item.item_kind='bingo_cell';
  IF v_item_count<>15 THEN RAISE EXCEPTION 'publish gate: complete profile requires 15 bingo cells';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM content.activities activity LEFT JOIN ref.reference_contents reference ON reference.id=activity.source_reference_content_id
  WHERE activity.agency_id=p_agency_id AND activity.template_version_id=p_version_id AND activity.status='approved' AND activity.source<>'manual'
   AND (reference.id IS NULL OR reference.status<>'approved' OR reference.approved_by_user_id IS NULL
    OR (reference.refresh_after IS NOT NULL AND reference.refresh_after<clock_timestamp())
    OR NOT EXISTS(SELECT 1 FROM ref.reference_content_sources source WHERE source.reference_content_id=reference.id)))
 THEN RAISE EXCEPTION 'publish gate: AI/import content requires approved, fresh and sourced reference content';END IF;
END $$;

REVOKE ALL ON ops.traveler_change_notice_recipients,ops.change_notice_reminders,travel.departure_insurance_policies FROM PUBLIC;
GRANT SELECT ON ops.traveler_change_notice_recipients,ops.change_notice_reminders,travel.departure_insurance_policies TO smf_app;
REVOKE ALL ON FUNCTION app.publish_departure_communication_v3(TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID[],UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_departure_communications_v3(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_departure_communication_recipients_v3(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_notice_branded_web_push_subscriptions_v3(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_change_notice_reminder_v3(TEXT,UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.close_departure_communication_v3(TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_departure_insurance_v3(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,DATE,DATE,JSONB,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_departure_insurance_v3(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_departure_insurance_document_v3(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.set_departure_experience_profile_v3(TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_departure_experience_profile_v3(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_departure_communication_v3(TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID[],UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.read_departure_communications_v3(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.read_departure_communication_recipients_v3(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.list_notice_branded_web_push_subscriptions_v3(UUID,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.record_change_notice_reminder_v3(TEXT,UUID,UUID,TEXT,TEXT,JSONB) TO smf_app;
GRANT EXECUTE ON FUNCTION app.close_departure_communication_v3(TEXT,UUID,TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.save_departure_insurance_v3(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,DATE,DATE,JSONB,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.read_departure_insurance_v3(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.register_departure_insurance_document_v3(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.set_departure_experience_profile_v3(TEXT,UUID,TEXT) TO smf_app;
GRANT EXECUTE ON FUNCTION app.read_departure_experience_profile_v3(TEXT,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('134_v3_departure_communications_insurance_experience') ON CONFLICT(version) DO NOTHING;
