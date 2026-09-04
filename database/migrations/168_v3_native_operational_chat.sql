-- Completa il passaggio della chat operativa alle identità UUID native.

CREATE OR REPLACE FUNCTION app.list_operational_messages_scoped_v3(
  p_actor_user_id UUID,p_departure UUID,p_scope TEXT,p_party UUID,p_traveler UUID,p_limit INTEGER DEFAULT 100
) RETURNS TABLE(id UUID,sender_name TEXT,sender_role TEXT,body TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_own_traveler UUID;v_own_party UUID;v_staff BOOLEAN;
BEGIN
  IF p_scope NOT IN('trip','group','traveler') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid chat scope';END IF;
  SELECT agency_id INTO v_agency FROM travel.departures WHERE id=p_departure;
  SELECT profile.id,m.party_id INTO v_own_traveler,v_own_party
  FROM travel.traveler_profiles profile JOIN travel.party_memberships m ON m.agency_id=profile.agency_id AND m.traveler_id=profile.id
  WHERE profile.user_id=p_actor_user_id AND m.departure_id=p_departure AND m.status='active' LIMIT 1;
  v_staff:=app.is_departure_operator_v3(p_actor_user_id,p_departure);
  IF NOT v_staff AND v_own_traveler IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='chat not authorized';END IF;
  IF p_scope='group' AND (p_party IS NULL OR (NOT v_staff AND p_party<>v_own_party)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='group chat not authorized';END IF;
  IF p_scope='traveler' AND (p_party IS NULL OR p_traveler IS NULL OR (NOT v_staff AND p_traveler<>v_own_traveler)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler chat not authorized';END IF;
  RETURN QUERY SELECT m.id,m.sender_name,m.sender_role::text,m.body,m.created_at,m.sender_user_id=p_actor_user_id
  FROM journey.operational_messages m
  WHERE m.agency_id=v_agency AND m.departure_id=p_departure AND m.scope_type=p_scope
    AND m.party_id IS NOT DISTINCT FROM CASE WHEN p_scope='trip' THEN NULL ELSE p_party END
    AND m.subject_traveler_id IS NOT DISTINCT FROM CASE WHEN p_scope='traveler' THEN p_traveler ELSE NULL END
    AND m.deleted_at IS NULL ORDER BY m.created_at DESC,m.id DESC LIMIT least(greatest(p_limit,1),200);
END $$;

CREATE OR REPLACE FUNCTION app.send_operational_message_scoped_v3(
  p_actor_user_id UUID,p_departure UUID,p_scope TEXT,p_party UUID,p_traveler UUID,p_body TEXT,p_operation UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_sender_traveler UUID;v_sender_party UUID;v_name TEXT;v_role TEXT;v_staff BOOLEAN;v_id UUID;
BEGIN
  SELECT agency_id INTO v_agency FROM travel.departures WHERE id=p_departure;
  SELECT profile.id,m.party_id,profile.display_name INTO v_sender_traveler,v_sender_party,v_name
  FROM travel.traveler_profiles profile JOIN travel.party_memberships m ON m.agency_id=profile.agency_id AND m.traveler_id=profile.id
  WHERE profile.user_id=p_actor_user_id AND m.departure_id=p_departure AND m.status='active' LIMIT 1;
  v_staff:=app.is_departure_operator_v3(p_actor_user_id,p_departure);
  IF v_staff THEN SELECT display_name INTO v_name FROM iam.users WHERE id=p_actor_user_id;v_role:='agency';ELSE v_role:='traveler';END IF;
  IF p_scope NOT IN('trip','group','traveler') OR (NOT v_staff AND v_sender_traveler IS NULL) OR length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='chat message not authorized';END IF;
  IF p_scope='group' AND (p_party IS NULL OR (NOT v_staff AND p_party<>v_sender_party)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='group chat not authorized';END IF;
  IF p_scope='traveler' AND (p_party IS NULL OR p_traveler IS NULL OR (NOT v_staff AND p_traveler<>v_sender_traveler)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler chat not authorized';END IF;
  INSERT INTO journey.operational_messages(agency_id,departure_id,party_id,subject_traveler_id,scope_type,sender_user_id,sender_traveler_id,sender_name,sender_role,body,client_operation_id)
  VALUES(v_agency,p_departure,CASE WHEN p_scope='trip' THEN NULL ELSE p_party END,CASE WHEN p_scope='traveler' THEN p_traveler ELSE NULL END,p_scope,p_actor_user_id,v_sender_traveler,v_name,v_role,btrim(p_body),p_operation)
  ON CONFLICT(departure_id,scope_type,COALESCE(party_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(subject_traveler_id,'00000000-0000-0000-0000-000000000000'::uuid),client_operation_id) DO UPDATE SET body=journey.operational_messages.body RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.list_operational_messages_scoped_v3(UUID,UUID,TEXT,UUID,UUID,INTEGER),app.send_operational_message_scoped_v3(UUID,UUID,TEXT,UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_operational_messages_scoped_v3(UUID,UUID,TEXT,UUID,UUID,INTEGER),app.send_operational_message_scoped_v3(UUID,UUID,TEXT,UUID,UUID,TEXT,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version) VALUES('168_v3_native_operational_chat') ON CONFLICT(version) DO NOTHING;
