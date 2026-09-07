-- Accompagnatori can collaborate operationally; guides retain a restricted surface.

CREATE OR REPLACE FUNCTION app.departure_staff_role_v3(p_actor UUID,p_departure UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,travel SET row_security=off AS $$
  SELECT CASE WHEN assignment.role='tour_leader' THEN 'accompagnatore' ELSE assignment.role END::text
  FROM travel.departure_staff_assignments assignment
  WHERE assignment.user_id=p_actor AND assignment.departure_id=p_departure AND assignment.status='active'
    AND assignment.role IN('agent','accompagnatore','tour_leader','guida')
  ORDER BY CASE assignment.role WHEN 'agent' THEN 0 WHEN 'accompagnatore' THEN 1 WHEN 'tour_leader' THEN 1 ELSE 2 END
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.register_selected_staff_day_document_v3(
  p_actor_user_id UUID,p_departure_id UUID,p_day_id UUID,p_scope TEXT,p_party_id UUID,p_traveler_id UUID,
  p_media_id UUID,p_document_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,p_original_name TEXT,
  p_content_type TEXT,p_size_bytes BIGINT,p_description TEXT,p_staff_users UUID[]
) RETURNS TABLE(document_id UUID,title TEXT,description TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_prefix TEXT;v_description TEXT;v_visibility TEXT;v_staff_role TEXT;
  v_manager BOOLEAN;v_actor_role TEXT;
BEGIN
  SELECT day.agency_id INTO v_agency FROM travel.departure_days day
    WHERE day.id=p_day_id AND day.departure_id=p_departure_id;
  IF v_agency IS NULL OR p_scope NOT IN('trip','group','traveler','accompagnatore','guida') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid document audience';
  END IF;
  SELECT EXISTS(SELECT 1 FROM iam.agency_memberships membership
    WHERE membership.agency_id=v_agency AND membership.user_id=p_actor_user_id
      AND membership.status='active' AND membership.role IN('owner','admin','editor')) INTO v_manager;
  v_actor_role:=app.departure_staff_role_v3(p_actor_user_id,p_departure_id);
  IF NOT v_manager AND (v_actor_role IS DISTINCT FROM 'accompagnatore' OR p_scope='accompagnatore') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='document publication not authorized';
  END IF;
  v_staff_role:=CASE WHEN p_scope IN('accompagnatore','guida') THEN p_scope ELSE NULL END;
  IF v_staff_role IS NOT NULL AND (p_party_id IS NOT NULL OR p_traveler_id IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM travel.departure_staff_assignments assignment
    WHERE assignment.agency_id=v_agency AND assignment.departure_id=p_departure_id
      AND assignment.role IN(v_staff_role,CASE WHEN v_staff_role='accompagnatore' THEN 'tour_leader' ELSE v_staff_role END)
      AND assignment.status='active')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid staff document audience';
  END IF;
  IF p_scope='trip' AND (p_party_id IS NOT NULL OR p_traveler_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid trip document audience';
  END IF;
  IF p_scope='group' AND (p_party_id IS NULL OR p_traveler_id IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM travel.travel_parties party WHERE party.agency_id=v_agency
      AND party.departure_id=p_departure_id AND party.id=p_party_id AND party.status<>'archived')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid group document audience';
  END IF;
  IF p_scope='traveler' AND (p_party_id IS NULL OR p_traveler_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM travel.party_memberships membership WHERE membership.agency_id=v_agency
      AND membership.departure_id=p_departure_id AND membership.party_id=p_party_id
      AND membership.traveler_id=p_traveler_id AND membership.status='active')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid traveler document audience';
  END IF;
  IF v_staff_role IS NOT NULL AND (COALESCE(cardinality(p_staff_users),0)=0 OR cardinality(p_staff_users)>100 OR EXISTS(
    SELECT 1 FROM unnest(p_staff_users) selected(user_id) WHERE NOT EXISTS(
      SELECT 1 FROM travel.departure_staff_assignments assignment
      WHERE assignment.departure_id=p_departure_id AND assignment.agency_id=v_agency
        AND assignment.user_id=selected.user_id AND assignment.status='active'
        AND assignment.role IN(v_staff_role,CASE WHEN v_staff_role='accompagnatore' THEN 'tour_leader' ELSE v_staff_role END)))) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid selected document recipients';
  END IF;
  v_description:=btrim(COALESCE(p_description,''));
  v_prefix:='agencies/'||v_agency||'/departures/'||p_departure_id||'/'||CASE p_scope
    WHEN 'trip' THEN 'trip' WHEN 'group' THEN 'groups/'||p_party_id
    WHEN 'traveler' THEN 'travelers/'||p_traveler_id ELSE 'staff/'||p_scope END||'/days/'||p_day_id||'/documents/';
  IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN('r2','s3') OR p_size_bytes<=0
    OR p_size_bytes>26214400 OR btrim(p_bucket)='' OR btrim(p_original_name)=''
    OR btrim(p_content_type)='' OR v_description='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid document metadata';
  END IF;
  v_visibility:=CASE WHEN v_staff_role IS NOT NULL THEN 'agency' WHEN p_scope='trip' THEN 'agency'
    WHEN p_scope='group' THEN 'party' ELSE 'private' END;
  INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,provider,bucket,
    object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_media_id,v_agency,p_departure_id,p_party_id,p_actor_user_id,p_provider,p_bucket,p_object_key,
    p_original_name,p_content_type,p_size_bytes,'other',v_visibility,'ready');
  RETURN QUERY INSERT INTO ops.travel_documents(id,agency_id,departure_id,departure_day_id,party_id,
    traveler_id,staff_role,staff_user_ids,media_asset_id,document_type,title,description,status)
  VALUES(p_document_id,v_agency,p_departure_id,p_day_id,p_party_id,p_traveler_id,v_staff_role,
    CASE WHEN v_staff_role IS NOT NULL THEN p_staff_users ELSE NULL END,p_media_id,'other',p_original_name,
    v_description,'ready')
  RETURNING ops.travel_documents.id,ops.travel_documents.title,ops.travel_documents.description,
    ops.travel_documents.created_at;
END $$;

CREATE OR REPLACE FUNCTION app.selected_staff_chat_authorized_v3(
  p_actor UUID,p_departure UUID,p_role TEXT,p_recipient UUID
) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel SET row_security=off AS $$
  SELECT p_role IN('accompagnatore','guida')
    AND EXISTS(SELECT 1 FROM travel.departure_staff_assignments recipient_assignment
      WHERE recipient_assignment.departure_id=p_departure AND recipient_assignment.user_id=p_recipient
        AND recipient_assignment.status='active'
        AND recipient_assignment.role IN(p_role,CASE WHEN p_role='accompagnatore' THEN 'tour_leader' ELSE p_role END))
    AND (
      p_actor=p_recipient
      OR EXISTS(SELECT 1 FROM travel.departures departure
        JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id
        WHERE departure.id=p_departure AND membership.user_id=p_actor AND membership.status='active'
          AND membership.role IN('owner','admin','editor'))
      OR (p_role='guida' AND app.departure_staff_role_v3(p_actor,p_departure)='accompagnatore')
    )
$$;

REVOKE ALL ON FUNCTION app.departure_staff_role_v3(UUID,UUID),
  app.register_selected_staff_day_document_v3(UUID,UUID,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,UUID[]),
  app.selected_staff_chat_authorized_v3(UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.departure_staff_role_v3(UUID,UUID),
  app.register_selected_staff_day_document_v3(UUID,UUID,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,UUID[]),
  app.selected_staff_chat_authorized_v3(UUID,UUID,TEXT,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('190_v3_staff_collaboration_permissions') ON CONFLICT(version) DO NOTHING;
