-- Departure-scoped operational control: tour leaders, attendance, essential
-- assistance alerts and three distinct chat scopes. No location is collected.

CREATE TABLE IF NOT EXISTS travel.departure_staff_assignments (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  role VARCHAR(20) NOT NULL CHECK (role='tour_leader'),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  assigned_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY(agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  UNIQUE(departure_id,user_id,role)
);
CREATE INDEX IF NOT EXISTS departure_staff_assignments_scope_idx
  ON travel.departure_staff_assignments(agency_id,departure_id,status,user_id);

CREATE TABLE IF NOT EXISTS journey.departure_attendance (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('present','absent','excused')),
  operational_note TEXT NOT NULL DEFAULT '' CHECK (length(operational_note)<=500),
  recorded_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(agency_id,departure_id,departure_day_id) REFERENCES travel.departure_days(agency_id,departure_id,id) ON DELETE CASCADE,
  FOREIGN KEY(agency_id,departure_id,party_id,traveler_id) REFERENCES travel.party_memberships(agency_id,departure_id,party_id,traveler_id) ON DELETE CASCADE,
  UNIQUE(departure_day_id,traveler_id)
);
CREATE INDEX IF NOT EXISTS departure_attendance_scope_idx
  ON journey.departure_attendance(agency_id,departure_id,departure_day_id,party_id,traveler_id);

ALTER TABLE privacy.consent_records DROP CONSTRAINT IF EXISTS consent_records_consent_type_check;
ALTER TABLE privacy.consent_records ADD CONSTRAINT consent_records_consent_type_check CHECK (consent_type IN
 ('minor_image_upload','photo_contest','party_sharing','departure_sharing','agency_promotion','operational_assistance'));
ALTER TABLE privacy.consent_records DROP CONSTRAINT IF EXISTS consent_records_consent_scope_check;
ALTER TABLE privacy.consent_records ADD CONSTRAINT consent_records_consent_scope_check CHECK (consent_scope IN
 ('party','departure','agency','promotion','traveler'));

CREATE TABLE IF NOT EXISTS privacy.traveler_operational_alerts (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  consent_id UUID NOT NULL,
  alert_summary TEXT NOT NULL CHECK (length(btrim(alert_summary)) BETWEEN 3 AND 500),
  assistance_instructions TEXT NOT NULL DEFAULT '' CHECK (length(assistance_instructions)<=1000),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by_traveler_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY(agency_id,departure_id,party_id,traveler_id) REFERENCES travel.party_memberships(agency_id,departure_id,party_id,traveler_id) ON DELETE CASCADE,
  FOREIGN KEY(agency_id,departure_id,party_id,created_by_traveler_id) REFERENCES travel.party_memberships(agency_id,departure_id,party_id,traveler_id) ON DELETE RESTRICT,
  FOREIGN KEY(agency_id,departure_id,consent_id) REFERENCES privacy.consent_records(agency_id,departure_id,id) ON DELETE RESTRICT,
  UNIQUE(departure_id,traveler_id)
);
CREATE INDEX IF NOT EXISTS traveler_operational_alerts_scope_idx
 ON privacy.traveler_operational_alerts(agency_id,departure_id,party_id,status,traveler_id);

ALTER TABLE journey.operational_messages ADD COLUMN IF NOT EXISTS scope_type VARCHAR(16) NOT NULL DEFAULT 'group';
ALTER TABLE journey.operational_messages ADD COLUMN IF NOT EXISTS subject_traveler_id UUID;
ALTER TABLE journey.operational_messages ALTER COLUMN party_id DROP NOT NULL;
ALTER TABLE journey.operational_messages DROP CONSTRAINT IF EXISTS operational_messages_scope_check;
ALTER TABLE journey.operational_messages ADD CONSTRAINT operational_messages_scope_check CHECK(
 (scope_type='trip' AND party_id IS NULL AND subject_traveler_id IS NULL) OR
 (scope_type='group' AND party_id IS NOT NULL AND subject_traveler_id IS NULL) OR
 (scope_type='traveler' AND party_id IS NOT NULL AND subject_traveler_id IS NOT NULL));
ALTER TABLE journey.operational_messages DROP CONSTRAINT IF EXISTS operational_messages_subject_fk;
ALTER TABLE journey.operational_messages ADD CONSTRAINT operational_messages_subject_fk
 FOREIGN KEY(agency_id,departure_id,party_id,subject_traveler_id)
 REFERENCES travel.party_memberships(agency_id,departure_id,party_id,traveler_id) ON DELETE CASCADE;
ALTER TABLE journey.operational_messages DROP CONSTRAINT IF EXISTS operational_messages_party_id_client_operation_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS operational_messages_operation_scope_uidx
 ON journey.operational_messages(departure_id,scope_type,COALESCE(party_id,'00000000-0000-0000-0000-000000000000'::uuid),
 COALESCE(subject_traveler_id,'00000000-0000-0000-0000-000000000000'::uuid),client_operation_id);

ALTER TABLE travel.departure_staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel.departure_staff_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE journey.departure_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.departure_attendance FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy.traveler_operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy.traveler_operational_alerts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON travel.departure_staff_assignments,journey.departure_attendance,privacy.traveler_operational_alerts FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.is_departure_operator_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
 WITH actor AS (SELECT target_id id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1),
 departure AS (SELECT agency_id FROM travel.departures WHERE id=p_departure)
 SELECT EXISTS(SELECT 1 FROM actor,departure WHERE
  EXISTS(SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id=departure.agency_id AND m.user_id=actor.id AND m.status='active' AND m.role='owner')
  OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments s WHERE s.agency_id=departure.agency_id AND s.departure_id=p_departure AND s.user_id=actor.id AND s.role='tour_leader' AND s.status='active'));
$$;

CREATE OR REPLACE FUNCTION app.assign_tour_leader_v3(p_actor_legacy TEXT,p_departure UUID,p_user_legacy TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_user UUID;v_agency UUID;v_id UUID;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id INTO v_agency FROM travel.departures d JOIN iam.agency_memberships m ON m.agency_id=d.agency_id AND m.user_id=v_actor AND m.status='active' AND m.role='owner' WHERE d.id=p_departure;
 SELECT m.user_id INTO v_user FROM iam.agency_memberships m LEFT JOIN ops.legacy_id_map map ON map.target_id=m.user_id AND map.source_system='public-v2' AND map.entity_type='user' WHERE m.agency_id=v_agency AND m.status='active' AND m.role IN('admin','editor') AND (m.user_id::text=p_user_legacy OR map.legacy_id=p_user_legacy) LIMIT 1;
 IF v_agency IS NULL OR v_user IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='tour leader assignment not authorized';END IF;
 INSERT INTO travel.departure_staff_assignments(agency_id,departure_id,user_id,role,status,assigned_by)
 VALUES(v_agency,p_departure,v_user,'tour_leader','active',v_actor)
 ON CONFLICT(departure_id,user_id,role) DO UPDATE SET status='active',assigned_by=v_actor,assigned_at=clock_timestamp(),revoked_at=NULL
 RETURNING id INTO v_id;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,v_actor,'departure',p_departure::text,'tour_leader_assigned',jsonb_build_object('userId',v_user));
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.record_departure_attendance_v3(p_actor_legacy TEXT,p_day UUID,p_traveler UUID,p_status TEXT,p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_departure UUID;v_party UUID;v_id UUID;
BEGIN
 SELECT d.agency_id,d.departure_id INTO v_agency,v_departure FROM travel.departure_days d WHERE d.id=p_day;
 IF NOT app.is_departure_operator_v3(p_actor_legacy,v_departure) OR p_status NOT IN('present','absent','excused') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='attendance not authorized';END IF;
 SELECT m.party_id INTO v_party FROM travel.party_memberships m WHERE m.agency_id=v_agency AND m.departure_id=v_departure AND m.traveler_id=p_traveler AND m.status='active';
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 IF v_party IS NULL OR length(COALESCE(p_note,''))>500 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid attendance';END IF;
 INSERT INTO journey.departure_attendance(agency_id,departure_id,departure_day_id,party_id,traveler_id,status,operational_note,recorded_by)
 VALUES(v_agency,v_departure,p_day,v_party,p_traveler,p_status,btrim(COALESCE(p_note,'')),v_actor)
 ON CONFLICT(departure_day_id,traveler_id) DO UPDATE SET status=EXCLUDED.status,operational_note=EXCLUDED.operational_note,recorded_by=EXCLUDED.recorded_by,recorded_at=clock_timestamp()
 RETURNING id INTO v_id; RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.save_operational_alert_v3(p_actor_legacy TEXT,p_departure UUID,p_subject UUID,p_summary TEXT,p_instructions TEXT,p_granted BOOLEAN)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,privacy,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_decider UUID;v_agency UUID;v_party UUID;v_type TEXT;v_end DATE;v_consent UUID;v_alert UUID;v_previous UUID;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT m.agency_id,m.party_id,m.member_type,d.ends_on INTO v_agency,v_party,v_type,v_end FROM travel.party_memberships m JOIN travel.departures d ON d.id=m.departure_id AND d.agency_id=m.agency_id WHERE m.departure_id=p_departure AND m.traveler_id=p_subject AND m.status='active';
 SELECT p.id INTO v_decider FROM travel.traveler_profiles p JOIN travel.party_memberships m ON m.agency_id=p.agency_id AND m.traveler_id=p.id AND m.departure_id=p_departure AND m.party_id=v_party AND m.status='active' WHERE p.user_id=v_actor AND (p.id=p_subject OR (m.role='organizer' AND v_type='dependent_minor')) LIMIT 1;
 IF v_decider IS NULL OR NOT p_granted OR length(btrim(COALESCE(p_summary,''))) NOT BETWEEN 3 AND 500 OR length(COALESCE(p_instructions,''))>1000 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='explicit operational assistance consent required';END IF;
 IF v_type='dependent_minor' AND NOT EXISTS(SELECT 1 FROM travel.traveler_guardianships g WHERE g.agency_id=v_agency AND g.departure_id=p_departure AND g.party_id=v_party AND g.minor_traveler_id=p_subject AND g.guardian_traveler_id=v_decider AND g.status='active') THEN
  INSERT INTO travel.traveler_guardianships(agency_id,departure_id,party_id,minor_traveler_id,guardian_traveler_id,relationship,status,effective_from)
  VALUES(v_agency,p_departure,v_party,p_subject,v_decider,'group_leader_guardian','active',current_date) ON CONFLICT(party_id,minor_traveler_id,guardian_traveler_id) DO UPDATE SET status='active',effective_until=NULL;
 END IF;
 SELECT id INTO v_previous FROM privacy.consent_records WHERE agency_id=v_agency AND departure_id=p_departure AND subject_traveler_id=p_subject AND consent_type='operational_assistance' ORDER BY effective_at DESC LIMIT 1;
 INSERT INTO privacy.consent_records(agency_id,departure_id,party_id,subject_traveler_id,decided_by_traveler_id,consent_type,consent_scope,decision,policy_version,supersedes_consent_id,captured_by_user_id,capture_method,expires_at)
 VALUES(v_agency,p_departure,v_party,p_subject,v_decider,'operational_assistance','traveler','granted','smf-operational-assistance-v1',NULL,v_actor,'digital',(v_end+31)::timestamptz) RETURNING id INTO v_consent;
 INSERT INTO privacy.traveler_operational_alerts(agency_id,departure_id,party_id,traveler_id,consent_id,alert_summary,assistance_instructions,expires_at,created_by_traveler_id)
 VALUES(v_agency,p_departure,v_party,p_subject,v_consent,btrim(p_summary),btrim(COALESCE(p_instructions,'')),(v_end+31)::timestamptz,v_decider)
 ON CONFLICT(departure_id,traveler_id) DO UPDATE SET consent_id=v_consent,alert_summary=EXCLUDED.alert_summary,assistance_instructions=EXCLUDED.assistance_instructions,status='active',expires_at=EXCLUDED.expires_at,updated_at=clock_timestamp(),deleted_at=NULL RETURNING id INTO v_alert;
 RETURN v_alert;
END $$;

CREATE OR REPLACE FUNCTION app.purge_expired_operational_alerts_v3()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,privacy SET row_security=off AS $$
DECLARE v_count INTEGER;BEGIN UPDATE privacy.traveler_operational_alerts SET alert_summary='Dati eliminati per scadenza conservazione',assistance_instructions='',status='expired',deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE status='active' AND expires_at<=clock_timestamp();GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;END $$;

CREATE OR REPLACE FUNCTION app.list_operational_alerts_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS TABLE(id UUID,traveler_id UUID,traveler_name TEXT,party_id UUID,alert_summary TEXT,assistance_instructions TEXT,expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,travel,privacy SET row_security=off AS $$
BEGIN
 IF NOT app.is_departure_operator_v3(p_actor_legacy,p_departure) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='operational alerts not authorized';END IF;
 PERFORM app.purge_expired_operational_alerts_v3();
 RETURN QUERY SELECT a.id,a.traveler_id,p.display_name,a.party_id,a.alert_summary,a.assistance_instructions,a.expires_at FROM privacy.traveler_operational_alerts a JOIN travel.traveler_profiles p ON p.id=a.traveler_id AND p.agency_id=a.agency_id WHERE a.departure_id=p_departure AND a.status='active' AND a.deleted_at IS NULL ORDER BY p.display_name;
END $$;

CREATE OR REPLACE FUNCTION app.list_departure_operations_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS TABLE(kind TEXT,id UUID,name TEXT,detail TEXT,status TEXT,day_id UUID,party_id UUID,traveler_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_owner BOOLEAN;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id,EXISTS(SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id=d.agency_id AND m.user_id=v_actor AND m.status='active' AND m.role='owner') INTO v_agency,v_owner FROM travel.departures d WHERE d.id=p_departure;
 IF NOT COALESCE(v_owner,false) AND NOT app.is_departure_operator_v3(p_actor_legacy,p_departure) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='departure operations not authorized';END IF;
 RETURN QUERY SELECT 'staff',s.id,u.display_name,'Tour Leader',s.status,NULL::uuid,NULL::uuid,NULL::uuid FROM travel.departure_staff_assignments s JOIN iam.users u ON u.id=s.user_id WHERE s.agency_id=v_agency AND s.departure_id=p_departure AND s.status='active'
 UNION ALL SELECT 'eligible_staff',u.id,u.display_name,COALESCE(u.email,''),'active',NULL,NULL,NULL FROM iam.agency_memberships m JOIN iam.users u ON u.id=m.user_id WHERE v_owner AND m.agency_id=v_agency AND m.status='active' AND m.role IN('admin','editor')
 UNION ALL SELECT 'day',d.id,to_char(d.service_date,'DD/MM/YYYY'),'','active',d.id,NULL,NULL FROM travel.departure_days d WHERE d.agency_id=v_agency AND d.departure_id=p_departure
 UNION ALL SELECT 'traveler',m.traveler_id,p.display_name,party.name,m.status,NULL,m.party_id,m.traveler_id FROM travel.party_memberships m JOIN travel.traveler_profiles p ON p.id=m.traveler_id AND p.agency_id=m.agency_id JOIN travel.travel_parties party ON party.id=m.party_id AND party.agency_id=m.agency_id WHERE m.agency_id=v_agency AND m.departure_id=p_departure AND m.status='active'
 UNION ALL SELECT 'attendance',a.id,p.display_name,a.operational_note,a.status,a.departure_day_id,a.party_id,a.traveler_id FROM journey.departure_attendance a JOIN travel.traveler_profiles p ON p.id=a.traveler_id AND p.agency_id=a.agency_id WHERE a.agency_id=v_agency AND a.departure_id=p_departure
 ORDER BY 1,3;
END $$;

CREATE OR REPLACE FUNCTION app.list_operational_messages_scoped_v3(p_actor_legacy TEXT,p_departure UUID,p_scope TEXT,p_party UUID,p_traveler UUID,p_limit INTEGER DEFAULT 100)
RETURNS TABLE(id UUID,sender_name TEXT,sender_role TEXT,body TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_own_traveler UUID;v_own_party UUID;v_staff BOOLEAN;
BEGIN
 IF p_scope NOT IN('trip','group','traveler') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid chat scope';END IF;
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id INTO v_agency FROM travel.departures d WHERE d.id=p_departure;
 SELECT profile.id,m.party_id INTO v_own_traveler,v_own_party FROM travel.traveler_profiles profile JOIN travel.party_memberships m ON m.agency_id=profile.agency_id AND m.traveler_id=profile.id WHERE profile.user_id=v_actor AND m.departure_id=p_departure AND m.status='active' LIMIT 1;
 v_staff:=app.is_departure_operator_v3(p_actor_legacy,p_departure);
 IF NOT v_staff AND v_own_traveler IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='chat not authorized';END IF;
 IF p_scope='group' AND (p_party IS NULL OR (NOT v_staff AND p_party<>v_own_party)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='group chat not authorized';END IF;
 IF p_scope='traveler' AND (p_party IS NULL OR p_traveler IS NULL OR (NOT v_staff AND p_traveler<>v_own_traveler)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler chat not authorized';END IF;
 RETURN QUERY SELECT m.id,m.sender_name,m.sender_role::text,m.body,m.created_at,m.sender_user_id=v_actor FROM journey.operational_messages m WHERE m.agency_id=v_agency AND m.departure_id=p_departure AND m.scope_type=p_scope AND m.party_id IS NOT DISTINCT FROM CASE WHEN p_scope='trip' THEN NULL ELSE p_party END AND m.subject_traveler_id IS NOT DISTINCT FROM CASE WHEN p_scope='traveler' THEN p_traveler ELSE NULL END AND m.deleted_at IS NULL ORDER BY m.created_at DESC,m.id DESC LIMIT least(greatest(p_limit,1),200);
END $$;

CREATE OR REPLACE FUNCTION app.send_operational_message_scoped_v3(p_actor_legacy TEXT,p_departure UUID,p_scope TEXT,p_party UUID,p_traveler UUID,p_body TEXT,p_operation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_sender_traveler UUID;v_sender_party UUID;v_name TEXT;v_role TEXT;v_staff BOOLEAN;v_id UUID;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id INTO v_agency FROM travel.departures d WHERE d.id=p_departure;
 SELECT profile.id,m.party_id,profile.display_name INTO v_sender_traveler,v_sender_party,v_name FROM travel.traveler_profiles profile JOIN travel.party_memberships m ON m.agency_id=profile.agency_id AND m.traveler_id=profile.id WHERE profile.user_id=v_actor AND m.departure_id=p_departure AND m.status='active' LIMIT 1;
 v_staff:=app.is_departure_operator_v3(p_actor_legacy,p_departure);
 IF v_staff THEN SELECT u.display_name INTO v_name FROM iam.users u WHERE u.id=v_actor;v_role:='agency';ELSE v_role:='traveler';END IF;
 IF p_scope NOT IN('trip','group','traveler') OR (NOT v_staff AND v_sender_traveler IS NULL) OR length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='chat message not authorized';END IF;
 IF p_scope='group' AND (p_party IS NULL OR (NOT v_staff AND p_party<>v_sender_party)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='group chat not authorized';END IF;
 IF p_scope='traveler' AND (p_party IS NULL OR p_traveler IS NULL OR (NOT v_staff AND p_traveler<>v_sender_traveler)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler chat not authorized';END IF;
 INSERT INTO journey.operational_messages(agency_id,departure_id,party_id,subject_traveler_id,scope_type,sender_user_id,sender_traveler_id,sender_name,sender_role,body,client_operation_id)
 VALUES(v_agency,p_departure,CASE WHEN p_scope='trip' THEN NULL ELSE p_party END,CASE WHEN p_scope='traveler' THEN p_traveler ELSE NULL END,p_scope,v_actor,v_sender_traveler,v_name,v_role,btrim(p_body),p_operation)
 ON CONFLICT(departure_id,scope_type,COALESCE(party_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(subject_traveler_id,'00000000-0000-0000-0000-000000000000'::uuid),client_operation_id) DO UPDATE SET body=journey.operational_messages.body RETURNING id INTO v_id;
 RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.is_departure_operator_v3(TEXT,UUID),app.assign_tour_leader_v3(TEXT,UUID,TEXT),app.record_departure_attendance_v3(TEXT,UUID,UUID,TEXT,TEXT),app.save_operational_alert_v3(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN),app.purge_expired_operational_alerts_v3(),app.list_operational_alerts_v3(TEXT,UUID),app.list_departure_operations_v3(TEXT,UUID),app.list_operational_messages_scoped_v3(TEXT,UUID,TEXT,UUID,UUID,INTEGER),app.send_operational_message_scoped_v3(TEXT,UUID,TEXT,UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_departure_operator_v3(TEXT,UUID),app.assign_tour_leader_v3(TEXT,UUID,TEXT),app.record_departure_attendance_v3(TEXT,UUID,UUID,TEXT,TEXT),app.save_operational_alert_v3(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN),app.list_operational_alerts_v3(TEXT,UUID),app.list_departure_operations_v3(TEXT,UUID),app.list_operational_messages_scoped_v3(TEXT,UUID,TEXT,UUID,UUID,INTEGER),app.send_operational_message_scoped_v3(TEXT,UUID,TEXT,UUID,UUID,TEXT,UUID) TO smf_app;
GRANT SELECT ON travel.departure_staff_assignments,journey.departure_attendance,privacy.traveler_operational_alerts TO smf_app;

INSERT INTO public.platform_schema_migrations(version) VALUES('135_v3_tour_leader_operational_control') ON CONFLICT(version) DO NOTHING;
