ALTER TABLE travel.departure_staff_assignments
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES iam.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

UPDATE travel.departure_staff_assignments assignment
SET valid_from=COALESCE(assignment.valid_from,assignment.assigned_at),
    valid_until=COALESCE(assignment.valid_until,(departure.ends_on+1)::timestamptz)
FROM travel.departures departure
WHERE departure.id=assignment.departure_id
  AND (assignment.valid_from IS NULL OR assignment.valid_until IS NULL);

ALTER TABLE travel.departure_staff_assignments
  ALTER COLUMN valid_from SET NOT NULL,
  ALTER COLUMN valid_from SET DEFAULT clock_timestamp(),
  ALTER COLUMN valid_until SET NOT NULL,
  DROP CONSTRAINT IF EXISTS departure_staff_assignments_validity_ck,
  ADD CONSTRAINT departure_staff_assignments_validity_ck CHECK(valid_until>valid_from),
  DROP CONSTRAINT IF EXISTS departure_staff_assignments_revocation_ck,
  ADD CONSTRAINT departure_staff_assignments_revocation_ck CHECK(
    (status='active' AND revoked_at IS NULL AND revoked_by IS NULL) OR
    (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL));

CREATE INDEX IF NOT EXISTS departure_staff_assignments_active_period_idx
  ON travel.departure_staff_assignments(departure_id,user_id,valid_from,valid_until)
  WHERE status='active';

CREATE OR REPLACE FUNCTION app.is_departure_operator_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
 WITH actor AS (SELECT target_id id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1),
 departure AS (SELECT agency_id FROM travel.departures WHERE id=p_departure)
 SELECT EXISTS(SELECT 1 FROM actor,departure WHERE
  EXISTS(SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id=departure.agency_id AND m.user_id=actor.id AND m.status='active' AND m.role='owner')
  OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments s WHERE s.agency_id=departure.agency_id AND s.departure_id=p_departure AND s.user_id=actor.id AND s.role='tour_leader' AND s.status='active' AND clock_timestamp()>=s.valid_from AND clock_timestamp()<s.valid_until));
$$;

CREATE OR REPLACE FUNCTION app.assign_tour_leader_v3(p_actor_legacy TEXT,p_departure UUID,p_user_legacy TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_user UUID;v_agency UUID;v_id UUID;v_until TIMESTAMPTZ;
BEGIN
 SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
 SELECT d.agency_id,(d.ends_on+1)::timestamptz INTO v_agency,v_until FROM travel.departures d JOIN iam.agency_memberships m ON m.agency_id=d.agency_id AND m.user_id=v_actor AND m.status='active' AND m.role='owner' WHERE d.id=p_departure;
 SELECT m.user_id INTO v_user FROM iam.agency_memberships m LEFT JOIN ops.legacy_id_map map ON map.target_id=m.user_id AND map.source_system='public-v2' AND map.entity_type='user' WHERE m.agency_id=v_agency AND m.status='active' AND m.role IN('admin','editor') AND (m.user_id::text=p_user_legacy OR map.legacy_id=p_user_legacy) LIMIT 1;
 IF v_agency IS NULL OR v_user IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='tour leader assignment not authorized';END IF;
 INSERT INTO travel.departure_staff_assignments(agency_id,departure_id,user_id,role,status,assigned_by,valid_from,valid_until)
 VALUES(v_agency,p_departure,v_user,'tour_leader','active',v_actor,clock_timestamp(),v_until)
 ON CONFLICT(departure_id,user_id,role) DO UPDATE SET status='active',assigned_by=v_actor,assigned_at=clock_timestamp(),revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL,valid_from=clock_timestamp(),valid_until=v_until
 RETURNING id INTO v_id;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,v_actor,'departure',p_departure::text,'tour_leader_assigned',jsonb_build_object('userId',v_user,'validUntil',v_until));
 RETURN v_id;
END $$;

DROP FUNCTION IF EXISTS app.revoke_tour_leader_v3(TEXT,UUID,UUID,TEXT);
CREATE OR REPLACE FUNCTION app.revoke_tour_leader_v3(p_actor_user_id UUID,p_departure UUID,p_assignment UUID,p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_user UUID;
BEGIN
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure
 JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id AND membership.user_id=p_actor_user_id AND membership.status='active' AND membership.role='owner'
 WHERE departure.id=p_departure;
 IF v_agency IS NULL OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 300 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='tour leader revocation not authorized';
 END IF;
 UPDATE travel.departure_staff_assignments SET status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,revocation_reason=btrim(p_reason)
 WHERE id=p_assignment AND agency_id=v_agency AND departure_id=p_departure AND status='active'
 RETURNING user_id INTO v_user;
 IF v_user IS NULL THEN RETURN false; END IF;
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,p_actor_user_id,'departure',p_departure::text,'tour_leader_revoked',jsonb_build_object('assignmentId',p_assignment,'userId',v_user,'reason',btrim(p_reason)));
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.revoke_tour_leader_v3(UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.revoke_tour_leader_v3(UUID,UUID,UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('140_v3_temporal_tour_leader_assignments') ON CONFLICT(version) DO NOTHING;
