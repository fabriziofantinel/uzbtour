ALTER TABLE ops.staff_departure_communications
  ADD COLUMN IF NOT EXISTS audience_user_ids UUID[];

CREATE OR REPLACE FUNCTION app.publish_selected_staff_communication_v3(
  p_actor UUID,p_departure UUID,p_role TEXT,p_title TEXT,p_summary TEXT,p_severity TEXT,
  p_requires_ack BOOLEAN,p_ack_by TIMESTAMPTZ,p_operation UUID,p_users UUID[]
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops AS $$
DECLARE v_id UUID;
BEGIN
  IF COALESCE(cardinality(p_users),0)=0 OR cardinality(p_users)>100
    OR EXISTS (
      SELECT 1 FROM unnest(p_users) selected(user_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM travel.departure_staff_assignments assignment
        WHERE assignment.departure_id=p_departure AND assignment.user_id=selected.user_id
          AND assignment.status='active'
          AND assignment.role IN(p_role,CASE WHEN p_role='accompagnatore' THEN 'tour_leader' ELSE p_role END)
      )
    ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid assigned staff recipients';
  END IF;
  v_id:=app.publish_staff_departure_communication_v3(p_actor,p_departure,p_role,p_title,p_summary,p_severity,p_requires_ack,p_ack_by,p_operation);
  UPDATE ops.staff_departure_communications
    SET audience_user_ids=ARRAY(SELECT DISTINCT user_id FROM unnest(p_users) selected(user_id))
    WHERE id=v_id AND audience_user_ids IS NULL;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.publish_selected_staff_communication_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_selected_staff_communication_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,UUID,UUID[]) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('181_v3_selected_staff_communications') ON CONFLICT(version) DO NOTHING;
