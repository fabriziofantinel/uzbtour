CREATE TABLE IF NOT EXISTS ops.staff_departure_communications (
 id UUID PRIMARY KEY DEFAULT uuidv7(),agency_id UUID NOT NULL,departure_id UUID NOT NULL,
 staff_role TEXT NOT NULL CHECK(staff_role IN ('accompagnatore','guida')),title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 180),
 summary TEXT NOT NULL CHECK(length(summary) BETWEEN 2 AND 5000),severity TEXT NOT NULL CHECK(severity IN ('information','important','urgent')),
 requires_acknowledgement BOOLEAN NOT NULL DEFAULT false,acknowledge_by TIMESTAMPTZ,created_by UUID NOT NULL REFERENCES iam.users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),client_operation_id UUID NOT NULL,
 FOREIGN KEY(agency_id,departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,UNIQUE(departure_id,staff_role,client_operation_id)
);
CREATE INDEX IF NOT EXISTS staff_departure_communications_scope_idx ON ops.staff_departure_communications(agency_id,departure_id,staff_role,created_at DESC);
CREATE OR REPLACE FUNCTION app.publish_staff_departure_communication_v3(p_actor UUID,p_departure UUID,p_role TEXT,p_title TEXT,p_summary TEXT,p_severity TEXT,p_requires_ack BOOLEAN,p_ack_by TIMESTAMPTZ,p_operation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel,ops AS $$
DECLARE v_agency UUID;v_id UUID;
BEGIN
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id AND membership.user_id=p_actor AND membership.status='active' AND membership.role IN ('owner','admin','editor') WHERE departure.id=p_departure AND departure.status NOT IN('cancelled','archived');
 IF v_agency IS NULL OR p_role NOT IN('accompagnatore','guida') OR length(btrim(COALESCE(p_title,''))) NOT BETWEEN 2 AND 180 OR length(btrim(COALESCE(p_summary,''))) NOT BETWEEN 2 AND 5000 OR p_severity NOT IN('information','important','urgent') OR (p_requires_ack AND p_ack_by IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid staff communication';END IF;
 IF NOT EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment WHERE assignment.agency_id=v_agency AND assignment.departure_id=p_departure AND assignment.status='active' AND assignment.role IN(p_role,CASE WHEN p_role='accompagnatore' THEN 'tour_leader' ELSE p_role END)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='no assigned staff recipient';END IF;
 INSERT INTO ops.staff_departure_communications(agency_id,departure_id,staff_role,title,summary,severity,requires_acknowledgement,acknowledge_by,created_by,client_operation_id)
 VALUES(v_agency,p_departure,p_role,btrim(p_title),btrim(p_summary),p_severity,p_requires_ack,p_ack_by,p_actor,p_operation)
 ON CONFLICT(departure_id,staff_role,client_operation_id) DO UPDATE SET title=ops.staff_departure_communications.title RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.publish_staff_departure_communication_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_staff_departure_communication_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID) TO smf_app;
GRANT SELECT,INSERT,UPDATE ON ops.staff_departure_communications TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('178_v3_staff_communication_audience') ON CONFLICT(version) DO NOTHING;
