-- Complete staff communication lifecycle and allow accompanying staff to communicate operationally.

CREATE TABLE IF NOT EXISTS ops.staff_departure_communication_recipients (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  communication_id UUID NOT NULL REFERENCES ops.staff_departure_communications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  read_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(communication_id,user_id),
  FOREIGN KEY(agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE
);
ALTER TABLE ops.staff_departure_communications
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES iam.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS closure_note TEXT;
CREATE INDEX IF NOT EXISTS staff_communication_recipients_user_idx
  ON ops.staff_departure_communication_recipients(user_id,departure_id,read_at,created_at DESC);

CREATE OR REPLACE FUNCTION app.publish_staff_departure_communication_v3(
  p_actor UUID,p_departure UUID,p_role TEXT,p_title TEXT,p_summary TEXT,p_severity TEXT,
  p_requires_ack BOOLEAN,p_ack_by TIMESTAMPTZ,p_operation UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_id UUID;v_manager BOOLEAN;v_actor_role TEXT;
BEGIN
  SELECT departure.agency_id INTO v_agency FROM travel.departures departure
    WHERE departure.id=p_departure AND departure.status NOT IN('cancelled','archived');
  SELECT EXISTS(SELECT 1 FROM iam.agency_memberships membership
    WHERE membership.agency_id=v_agency AND membership.user_id=p_actor
      AND membership.status='active' AND membership.role IN('owner','admin','editor')) INTO v_manager;
  v_actor_role:=app.departure_staff_role_v3(p_actor,p_departure);
  IF v_agency IS NULL OR (NOT v_manager AND (v_actor_role IS DISTINCT FROM 'accompagnatore' OR p_role<>'guida'))
    OR p_role NOT IN('accompagnatore','guida')
    OR length(btrim(COALESCE(p_title,''))) NOT BETWEEN 2 AND 180
    OR length(btrim(COALESCE(p_summary,''))) NOT BETWEEN 2 AND 5000
    OR p_severity NOT IN('information','important','urgent')
    OR (p_requires_ack AND p_ack_by IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff communication not authorized';
  END IF;
  INSERT INTO ops.staff_departure_communications(agency_id,departure_id,staff_role,title,summary,severity,
    requires_acknowledgement,acknowledge_by,created_by,client_operation_id)
  VALUES(v_agency,p_departure,p_role,btrim(p_title),btrim(p_summary),p_severity,p_requires_ack,p_ack_by,p_actor,p_operation)
  ON CONFLICT(departure_id,staff_role,client_operation_id) DO UPDATE
    SET title=ops.staff_departure_communications.title RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.publish_selected_staff_communication_v3(
  p_actor UUID,p_departure UUID,p_role TEXT,p_title TEXT,p_summary TEXT,p_severity TEXT,
  p_requires_ack BOOLEAN,p_ack_by TIMESTAMPTZ,p_operation UUID,p_users UUID[]
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_id UUID;v_agency UUID;
BEGIN
  SELECT departure.agency_id INTO v_agency FROM travel.departures departure WHERE departure.id=p_departure;
  IF COALESCE(cardinality(p_users),0)=0 OR cardinality(p_users)>100 OR EXISTS(
    SELECT 1 FROM unnest(p_users) selected(user_id) WHERE NOT EXISTS(
      SELECT 1 FROM travel.departure_staff_assignments assignment
      WHERE assignment.agency_id=v_agency AND assignment.departure_id=p_departure
        AND assignment.user_id=selected.user_id AND assignment.status='active'
        AND assignment.role IN(p_role,CASE WHEN p_role='accompagnatore' THEN 'tour_leader' ELSE p_role END))) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid assigned staff recipients';
  END IF;
  v_id:=app.publish_staff_departure_communication_v3(p_actor,p_departure,p_role,p_title,p_summary,
    p_severity,p_requires_ack,p_ack_by,p_operation);
  UPDATE ops.staff_departure_communications
    SET audience_user_ids=ARRAY(SELECT DISTINCT user_id FROM unnest(p_users) selected(user_id)) WHERE id=v_id;
  INSERT INTO ops.staff_departure_communication_recipients(agency_id,departure_id,communication_id,user_id)
    SELECT v_agency,p_departure,v_id,selected.user_id FROM unnest(p_users) selected(user_id)
    ON CONFLICT(communication_id,user_id) DO NOTHING;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.publish_departure_communication_native_v3(
  p_actor UUID,p_departure UUID,p_title TEXT,p_summary TEXT,p_severity TEXT,
  p_requires_ack BOOLEAN,p_acknowledge_by TIMESTAMPTZ,p_audience_parties UUID[],
  p_audience_travelers UUID[],p_operation UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_notice UUID;v_existing UUID;v_manager BOOLEAN;v_actor_role TEXT;
BEGIN
  SELECT departure.agency_id INTO v_agency FROM travel.departures departure
    WHERE departure.id=p_departure AND departure.status NOT IN('cancelled','archived');
  SELECT EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=v_agency
    AND membership.user_id=p_actor AND membership.status='active'
    AND membership.role IN('owner','admin','editor')) INTO v_manager;
  v_actor_role:=app.departure_staff_role_v3(p_actor,p_departure);
  IF v_agency IS NULL OR (NOT v_manager AND v_actor_role IS DISTINCT FROM 'accompagnatore') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='communication publication not authorized';
  END IF;
  IF length(btrim(COALESCE(p_title,''))) NOT BETWEEN 2 AND 180
    OR length(btrim(COALESCE(p_summary,''))) NOT BETWEEN 2 AND 5000
    OR p_severity NOT IN('information','important','urgent') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid communication';
  END IF;
  IF COALESCE(cardinality(p_audience_parties),0)>0 AND EXISTS(
    SELECT 1 FROM unnest(p_audience_parties) selected(id) WHERE NOT EXISTS(
      SELECT 1 FROM travel.travel_parties party WHERE party.agency_id=v_agency
        AND party.departure_id=p_departure AND party.id=selected.id AND party.status<>'archived')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid communication group audience';
  END IF;
  IF COALESCE(cardinality(p_audience_travelers),0)>0 AND EXISTS(
    SELECT 1 FROM unnest(p_audience_travelers) selected(id) WHERE NOT EXISTS(
      SELECT 1 FROM travel.party_memberships membership WHERE membership.agency_id=v_agency
        AND membership.departure_id=p_departure AND membership.traveler_id=selected.id
        AND membership.status='active'
        AND (cardinality(p_audience_parties)=0 OR membership.party_id=ANY(p_audience_parties)))) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid communication traveler audience';
  END IF;
  SELECT notice.id INTO v_existing FROM ops.traveler_change_notices notice
    WHERE notice.agency_id=v_agency AND notice.client_operation_id=p_operation LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  INSERT INTO ops.traveler_change_notices(agency_id,departure_id,change_type,severity,title,summary,
    changed_by,kind,requires_acknowledgement,acknowledge_by,audience_party_ids,audience_traveler_ids,
    client_operation_id)
  VALUES(v_agency,p_departure,'other',p_severity,btrim(p_title),btrim(p_summary),p_actor,'announcement',
    p_requires_ack,p_acknowledge_by,COALESCE(p_audience_parties,'{}'),COALESCE(p_audience_travelers,'{}'),p_operation)
  RETURNING id INTO v_notice;
  RETURN v_notice;
END $$;

CREATE OR REPLACE FUNCTION app.publish_traveler_change_notice_native_v3(
  p_actor UUID,p_departure UUID,p_day UUID,p_type TEXT,p_severity TEXT,p_title TEXT,p_summary TEXT,
  p_previous JSONB,p_current JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_notice UUID;
BEGIN
  SELECT departure.agency_id INTO v_agency FROM travel.departures departure
    WHERE departure.id=p_departure AND EXISTS(SELECT 1 FROM travel.departure_days day
      WHERE day.agency_id=departure.agency_id AND day.departure_id=departure.id AND day.id=p_day)
    AND (EXISTS(SELECT 1 FROM iam.agency_memberships membership
      WHERE membership.agency_id=departure.agency_id AND membership.user_id=p_actor
        AND membership.status='active' AND membership.role IN('owner','admin','editor'))
      OR app.can_edit_departure_day_v3(p_actor,p_departure,p_day));
  IF v_agency IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='change notice publication not authorized';
  END IF;
  INSERT INTO ops.traveler_change_notices(agency_id,departure_id,departure_day_id,change_type,severity,
    title,summary,previous_value,current_value,changed_by)
  VALUES(v_agency,p_departure,p_day,p_type,p_severity,left(p_title,180),p_summary,
    COALESCE(p_previous,'{}'),COALESCE(p_current,'{}'),p_actor) RETURNING id INTO v_notice;
  RETURN v_notice;
END $$;

CREATE OR REPLACE FUNCTION app.read_staff_departure_communications_v3(p_actor UUID,p_departure UUID)
RETURNS TABLE(id UUID,title TEXT,summary TEXT,severity TEXT,requires_acknowledgement BOOLEAN,
  acknowledge_by TIMESTAMPTZ,published_at TIMESTAMPTZ,recipient_count BIGINT,read_count BIGINT,
  overdue BOOLEAN,staff_role TEXT,is_recipient BOOLEAN,read_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,closure_note TEXT,can_close BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
  SELECT communication.id,communication.title,communication.summary,communication.severity,
    communication.requires_acknowledgement,communication.acknowledge_by,communication.created_at,
    count(recipient.user_id),count(recipient.read_at),
    communication.requires_acknowledgement AND communication.closed_at IS NULL
      AND communication.acknowledge_by<clock_timestamp()
      AND count(recipient.read_at)<count(recipient.user_id),communication.staff_role,
    bool_or(recipient.user_id=p_actor),max(recipient.read_at) FILTER(WHERE recipient.user_id=p_actor),
    communication.closed_at,communication.closure_note,
    communication.created_by=p_actor OR EXISTS(SELECT 1 FROM iam.agency_memberships manager
      WHERE manager.agency_id=communication.agency_id AND manager.user_id=p_actor
        AND manager.status='active' AND manager.role IN('owner','admin','editor'))
  FROM ops.staff_departure_communications communication
  LEFT JOIN ops.staff_departure_communication_recipients recipient ON recipient.communication_id=communication.id
  WHERE communication.departure_id=p_departure AND (
    communication.created_by=p_actor OR EXISTS(SELECT 1 FROM ops.staff_departure_communication_recipients mine
      WHERE mine.communication_id=communication.id AND mine.user_id=p_actor)
    OR EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=communication.agency_id
      AND membership.user_id=p_actor AND membership.status='active' AND membership.role IN('owner','admin','editor')))
  GROUP BY communication.id ORDER BY communication.created_at DESC
$$;

CREATE OR REPLACE FUNCTION app.read_staff_communication_recipients_v3(p_actor UUID,p_communication UUID)
RETURNS TABLE(user_id UUID,display_name TEXT,email TEXT,read_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
  SELECT recipient.user_id,user_account.display_name,COALESCE(user_account.email,''),recipient.read_at
  FROM ops.staff_departure_communication_recipients recipient
  JOIN ops.staff_departure_communications communication ON communication.id=recipient.communication_id
  JOIN iam.users user_account ON user_account.id=recipient.user_id
  WHERE recipient.communication_id=p_communication AND (communication.created_by=p_actor OR EXISTS(
    SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=communication.agency_id
      AND membership.user_id=p_actor AND membership.status='active' AND membership.role IN('owner','admin','editor')))
  ORDER BY recipient.read_at NULLS FIRST,user_account.display_name
$$;

CREATE OR REPLACE FUNCTION app.acknowledge_staff_communication_v3(
  p_actor UUID,p_communication UUID,p_operation UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  UPDATE ops.staff_departure_communication_recipients recipient
    SET read_at=COALESCE(recipient.read_at,clock_timestamp()),read_operation_id=COALESCE(recipient.read_operation_id,p_operation)
    WHERE recipient.communication_id=p_communication AND recipient.user_id=p_actor;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.read_departure_communications_native_v3(p_actor UUID,p_departure UUID)
RETURNS TABLE(id UUID,title TEXT,summary TEXT,severity VARCHAR,requires_acknowledgement BOOLEAN,
  acknowledge_by TIMESTAMPTZ,audience_party_ids UUID[],published_at TIMESTAMPTZ,recipient_count BIGINT,
  read_count BIGINT,unreachable_count BIGINT,overdue BOOLEAN,closed_at TIMESTAMPTZ,closure_note TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
  SELECT notice.id,notice.title,notice.summary,notice.severity,notice.requires_acknowledgement,
    notice.acknowledge_by,notice.audience_party_ids,notice.published_at,count(recipient.traveler_id),
    count(receipt.traveler_id),count(recipient.traveler_id) FILTER(WHERE NOT recipient.reachable_by_push),
    notice.requires_acknowledgement AND notice.closed_at IS NULL AND notice.acknowledge_by<clock_timestamp()
      AND count(receipt.traveler_id)<count(recipient.traveler_id),notice.closed_at,notice.closure_note
  FROM ops.traveler_change_notices notice
  LEFT JOIN ops.traveler_change_notice_recipients recipient ON recipient.notice_id=notice.id
  LEFT JOIN ops.traveler_change_notice_receipts receipt ON receipt.notice_id=notice.id
    AND receipt.traveler_id=recipient.traveler_id
  WHERE notice.departure_id=p_departure AND (
    EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=notice.agency_id
      AND membership.user_id=p_actor AND membership.status='active' AND membership.role IN('owner','admin','editor'))
    OR app.departure_staff_role_v3(p_actor,p_departure)='accompagnatore')
  GROUP BY notice.id ORDER BY notice.published_at DESC
$$;

CREATE OR REPLACE FUNCTION app.read_departure_communication_recipients_native_v3(p_actor UUID,p_notice UUID)
RETURNS TABLE(traveler_id UUID,party_id UUID,display_name TEXT,email TEXT,read_at TIMESTAMPTZ,
  reachable_by_push BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
  SELECT recipient.traveler_id,recipient.party_id,profile.display_name,COALESCE(profile.email,''),
    receipt.read_at,recipient.reachable_by_push
  FROM ops.traveler_change_notice_recipients recipient
  JOIN ops.traveler_change_notices notice ON notice.id=recipient.notice_id
  JOIN travel.traveler_profiles profile ON profile.agency_id=recipient.agency_id
    AND profile.id=recipient.traveler_id
  LEFT JOIN ops.traveler_change_notice_receipts receipt ON receipt.notice_id=recipient.notice_id
    AND receipt.traveler_id=recipient.traveler_id
  WHERE recipient.notice_id=p_notice AND (
    EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=recipient.agency_id
      AND membership.user_id=p_actor AND membership.status='active' AND membership.role IN('owner','admin','editor'))
    OR app.departure_staff_role_v3(p_actor,recipient.departure_id)='accompagnatore')
  ORDER BY receipt.read_at NULLS FIRST,profile.display_name
$$;

CREATE OR REPLACE FUNCTION app.close_departure_communication_native_v3(
  p_actor UUID,p_notice UUID,p_note TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
BEGIN
  UPDATE ops.traveler_change_notices notice
    SET closed_at=clock_timestamp(),closed_by=p_actor,closure_note=btrim(p_note)
  WHERE notice.id=p_notice AND notice.kind='announcement' AND notice.closed_at IS NULL
    AND length(btrim(COALESCE(p_note,'')))>=3 AND (
      EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=notice.agency_id
        AND membership.user_id=p_actor AND membership.status='active' AND membership.role IN('owner','admin','editor'))
      OR app.departure_staff_role_v3(p_actor,notice.departure_id)='accompagnatore');
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.close_staff_communication_v3(
  p_actor UUID,p_communication UUID,p_note TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
BEGIN
  UPDATE ops.staff_departure_communications communication
    SET closed_at=clock_timestamp(),closed_by=p_actor,closure_note=btrim(p_note)
  WHERE communication.id=p_communication AND communication.closed_at IS NULL
    AND length(btrim(COALESCE(p_note,'')))>=3 AND (
      communication.created_by=p_actor OR EXISTS(SELECT 1 FROM iam.agency_memberships membership
        WHERE membership.agency_id=communication.agency_id AND membership.user_id=p_actor
          AND membership.status='active' AND membership.role IN('owner','admin','editor')));
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.record_change_notice_reminder_native_v3(
  p_actor UUID,p_notice UUID,p_traveler UUID,p_channel TEXT,p_outcome TEXT,p_details JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_id UUID;v_departure UUID;
BEGIN
  SELECT notice.agency_id,notice.departure_id INTO v_agency,v_departure
  FROM ops.traveler_change_notices notice
  JOIN ops.traveler_change_notice_recipients recipient ON recipient.notice_id=notice.id
    AND recipient.traveler_id=p_traveler
  LEFT JOIN ops.traveler_change_notice_receipts receipt ON receipt.notice_id=notice.id
    AND receipt.traveler_id=p_traveler
  WHERE notice.id=p_notice AND receipt.traveler_id IS NULL;
  IF v_agency IS NULL OR NOT (EXISTS(SELECT 1 FROM iam.agency_memberships membership
    WHERE membership.agency_id=v_agency AND membership.user_id=p_actor AND membership.status='active'
      AND membership.role IN('owner','admin','editor'))
    OR app.departure_staff_role_v3(p_actor,v_departure)='accompagnatore') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reminder not authorized';
  END IF;
  IF p_channel NOT IN('push','email','group_leader') OR p_outcome NOT IN('sent','unreachable','failed','reported') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid reminder';
  END IF;
  IF EXISTS(SELECT 1 FROM ops.change_notice_reminders reminder WHERE reminder.agency_id=v_agency
    AND reminder.notice_id=p_notice AND reminder.traveler_id=p_traveler AND reminder.channel=p_channel
    AND reminder.sent_at>clock_timestamp()-interval '6 hours') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='reminder rate limit: wait six hours';
  END IF;
  INSERT INTO ops.change_notice_reminders(agency_id,notice_id,traveler_id,channel,outcome,actor_id,details)
  VALUES(v_agency,p_notice,p_traveler,p_channel,p_outcome,p_actor,COALESCE(p_details,'{}')) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

ALTER TABLE ops.staff_departure_communication_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.staff_departure_communication_recipients FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ops.staff_departure_communication_recipients FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON ops.staff_departure_communication_recipients TO smf_app;
REVOKE ALL ON FUNCTION app.publish_staff_departure_communication_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID),
  app.publish_selected_staff_communication_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID,UUID[]),
  app.publish_departure_communication_native_v3(UUID,UUID,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID[],UUID[],UUID),
  app.publish_traveler_change_notice_native_v3(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB),
  app.read_staff_departure_communications_v3(UUID,UUID),
  app.read_staff_communication_recipients_v3(UUID,UUID),
  app.acknowledge_staff_communication_v3(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_staff_departure_communication_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID),
  app.publish_selected_staff_communication_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID,UUID[]),
  app.publish_departure_communication_native_v3(UUID,UUID,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID[],UUID[],UUID),
  app.publish_traveler_change_notice_native_v3(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB),
  app.read_staff_departure_communications_v3(UUID,UUID),
  app.read_staff_communication_recipients_v3(UUID,UUID),
  app.acknowledge_staff_communication_v3(UUID,UUID,UUID),
  app.read_departure_communications_native_v3(UUID,UUID),
  app.read_departure_communication_recipients_native_v3(UUID,UUID),
  app.close_departure_communication_native_v3(UUID,UUID,TEXT) TO smf_app;

REVOKE ALL ON FUNCTION app.read_departure_communications_native_v3(UUID,UUID),
  app.read_departure_communication_recipients_native_v3(UUID,UUID),
  app.close_departure_communication_native_v3(UUID,UUID,TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.close_staff_communication_v3(UUID,UUID,TEXT),
  app.record_change_notice_reminder_native_v3(UUID,UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.close_staff_communication_v3(UUID,UUID,TEXT),
  app.record_change_notice_reminder_native_v3(UUID,UUID,UUID,TEXT,TEXT,JSONB) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('191_v3_staff_communication_lifecycle') ON CONFLICT(version) DO NOTHING;
