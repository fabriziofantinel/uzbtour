CREATE TABLE IF NOT EXISTS journey.staff_operational_messages (
  id UUID PRIMARY KEY DEFAULT uuidv7(), agency_id UUID NOT NULL, departure_id UUID NOT NULL,
  staff_role TEXT NOT NULL CHECK(staff_role IN ('accompagnatore','guida')),
  sender_user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  sender_name TEXT NOT NULL, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  client_operation_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), deleted_at TIMESTAMPTZ,
  FOREIGN KEY(agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  UNIQUE(departure_id,staff_role,client_operation_id)
);
CREATE INDEX IF NOT EXISTS staff_operational_messages_scope_idx ON journey.staff_operational_messages(agency_id,departure_id,staff_role,created_at DESC,id DESC) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION app.staff_chat_authorized_v3(p_actor UUID,p_departure UUID,p_role TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,iam,travel AS $$
 SELECT p_role IN ('accompagnatore','guida') AND EXISTS(SELECT 1 FROM travel.departures departure WHERE departure.id=p_departure AND (
  EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.agency_id=departure.agency_id AND membership.user_id=p_actor AND membership.status='active' AND membership.role IN ('owner','admin','editor')) OR
  EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment WHERE assignment.agency_id=departure.agency_id AND assignment.departure_id=p_departure AND assignment.user_id=p_actor AND assignment.status='active' AND assignment.role IN (p_role,CASE WHEN p_role='accompagnatore' THEN 'tour_leader' ELSE p_role END) AND clock_timestamp()>=assignment.valid_from AND clock_timestamp()<assignment.valid_until)
 ));
$$;
CREATE OR REPLACE FUNCTION app.list_staff_operational_messages_v3(p_actor UUID,p_departure UUID,p_role TEXT,p_limit INTEGER DEFAULT 100)
RETURNS TABLE(id UUID,sender_name TEXT,sender_role TEXT,body TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,journey AS $$
BEGIN
 IF NOT app.staff_chat_authorized_v3(p_actor,p_departure,p_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff chat not authorized';END IF;
 RETURN QUERY SELECT message.id,message.sender_name,'agency'::text,message.body,message.created_at,message.sender_user_id=p_actor
 FROM journey.staff_operational_messages message WHERE message.departure_id=p_departure AND message.staff_role=p_role AND message.deleted_at IS NULL ORDER BY message.created_at DESC,message.id DESC LIMIT least(greatest(p_limit,1),200);
END $$;
CREATE OR REPLACE FUNCTION app.send_staff_operational_message_v3(p_actor UUID,p_departure UUID,p_role TEXT,p_body TEXT,p_operation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel,journey AS $$
DECLARE v_agency UUID;v_name TEXT;v_id UUID;
BEGIN
 IF NOT app.staff_chat_authorized_v3(p_actor,p_departure,p_role) OR length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff chat not authorized';END IF;
 SELECT departure.agency_id,account.display_name INTO v_agency,v_name FROM travel.departures departure JOIN iam.users account ON account.id=p_actor WHERE departure.id=p_departure;
 INSERT INTO journey.staff_operational_messages(agency_id,departure_id,staff_role,sender_user_id,sender_name,body,client_operation_id)
 VALUES(v_agency,p_departure,p_role,p_actor,v_name,btrim(p_body),p_operation)
 ON CONFLICT(departure_id,staff_role,client_operation_id) DO UPDATE SET body=journey.staff_operational_messages.body RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.staff_chat_authorized_v3(UUID,UUID,TEXT),app.list_staff_operational_messages_v3(UUID,UUID,TEXT,INTEGER),app.send_staff_operational_message_v3(UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.staff_chat_authorized_v3(UUID,UUID,TEXT),app.list_staff_operational_messages_v3(UUID,UUID,TEXT,INTEGER),app.send_staff_operational_message_v3(UUID,UUID,TEXT,TEXT,UUID) TO smf_app;
GRANT SELECT,INSERT,UPDATE ON journey.staff_operational_messages TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('177_v3_staff_chat_scope') ON CONFLICT(version) DO NOTHING;
