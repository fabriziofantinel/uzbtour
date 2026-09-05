ALTER TABLE ops.travel_documents ADD COLUMN IF NOT EXISTS staff_user_ids UUID[];
ALTER TABLE journey.staff_operational_messages ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES iam.users(id);
CREATE OR REPLACE FUNCTION app.register_selected_staff_day_document_v3(
  p_actor_user_id UUID,p_departure_id UUID,p_day_id UUID,p_scope TEXT,p_party_id UUID,p_traveler_id UUID,
  p_media_id UUID,p_document_id UUID,p_provider TEXT,p_bucket TEXT,p_object_key TEXT,p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT,p_description TEXT,p_staff_users UUID[]
) RETURNS TABLE(document_id UUID,title TEXT,description TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_prefix TEXT;v_description TEXT;v_visibility TEXT;v_staff_role TEXT;
BEGIN
 SELECT day.agency_id INTO v_agency FROM travel.departure_days day WHERE day.id=p_day_id AND day.departure_id=p_departure_id;
 IF v_agency IS NULL OR p_scope NOT IN('trip','group','traveler','accompagnatore','guida') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid document audience';END IF;
 PERFORM app.require_agency_editor_v3(p_actor_user_id,v_agency);
 v_staff_role:=CASE WHEN p_scope IN ('accompagnatore','guida') THEN p_scope ELSE NULL END;
 IF v_staff_role IS NOT NULL AND (p_party_id IS NOT NULL OR p_traveler_id IS NOT NULL OR NOT EXISTS(
   SELECT 1 FROM travel.departure_staff_assignments assignment WHERE assignment.agency_id=v_agency AND assignment.departure_id=p_departure_id
     AND assignment.role IN (v_staff_role,CASE WHEN v_staff_role='accompagnatore' THEN 'tour_leader' ELSE v_staff_role END) AND assignment.status='active')) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid staff document audience';END IF;
 IF p_scope='trip' AND (p_party_id IS NOT NULL OR p_traveler_id IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid trip document audience';END IF;
 IF p_scope='group' AND (p_party_id IS NULL OR p_traveler_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM travel.travel_parties party WHERE party.agency_id=v_agency AND party.departure_id=p_departure_id AND party.id=p_party_id AND party.status<>'archived')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid group document audience';END IF;
 IF p_scope='traveler' AND (p_party_id IS NULL OR p_traveler_id IS NULL OR NOT EXISTS(SELECT 1 FROM travel.party_memberships membership WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure_id AND membership.party_id=p_party_id AND membership.traveler_id=p_traveler_id AND membership.status='active')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid traveler document audience';END IF;
 IF v_staff_role IS NOT NULL AND (COALESCE(cardinality(p_staff_users),0)=0 OR cardinality(p_staff_users)>100 OR EXISTS(
 SELECT 1 FROM unnest(p_staff_users) selected(user_id) WHERE NOT EXISTS(
 SELECT 1 FROM travel.departure_staff_assignments assignment WHERE assignment.departure_id=p_departure_id
 AND assignment.agency_id=v_agency AND assignment.user_id=selected.user_id AND assignment.status='active'
 AND assignment.role IN(v_staff_role,CASE WHEN v_staff_role='accompagnatore' THEN 'tour_leader' ELSE v_staff_role END)
 ))) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid selected document recipients'; END IF;
 v_description:=btrim(COALESCE(p_description,''));
 v_prefix:='agencies/'||v_agency||'/departures/'||p_departure_id||'/'||CASE p_scope WHEN 'trip' THEN 'trip' WHEN 'group' THEN 'groups/'||p_party_id WHEN 'traveler' THEN 'travelers/'||p_traveler_id ELSE 'staff/'||p_scope END||'/days/'||p_day_id||'/documents/';
 IF position(v_prefix IN p_object_key)<>1 OR p_provider NOT IN('r2','s3') OR p_size_bytes<=0 OR p_size_bytes>26214400 OR btrim(p_bucket)='' OR btrim(p_original_name)='' OR btrim(p_content_type)='' OR v_description='' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid document metadata';END IF;
 v_visibility:=CASE WHEN v_staff_role IS NOT NULL THEN 'agency' WHEN p_scope='trip' THEN 'agency' WHEN p_scope='group' THEN 'party' ELSE 'private' END;
 INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
 VALUES(p_media_id,v_agency,p_departure_id,p_party_id,p_actor_user_id,p_provider,p_bucket,p_object_key,p_original_name,p_content_type,p_size_bytes,'other',v_visibility,'ready');
 RETURN QUERY INSERT INTO ops.travel_documents(id,agency_id,departure_id,departure_day_id,party_id,traveler_id,staff_role,staff_user_ids,media_asset_id,document_type,title,description,status)
 VALUES(p_document_id,v_agency,p_departure_id,p_day_id,p_party_id,p_traveler_id,v_staff_role,CASE WHEN v_staff_role IS NOT NULL THEN p_staff_users ELSE NULL END,p_media_id,'other',p_original_name,v_description,'ready') RETURNING ops.travel_documents.id,ops.travel_documents.title,ops.travel_documents.description,ops.travel_documents.created_at;
END $$;


CREATE OR REPLACE FUNCTION app.resolve_travel_document_download_v3(p_actor_user_id UUID,p_document_id UUID)
RETURNS TABLE(provider TEXT,bucket TEXT,object_key TEXT,original_name TEXT,content_type TEXT) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ops SET row_security=off AS $$
 SELECT asset.provider::text,asset.bucket,asset.object_key,asset.original_name,asset.content_type FROM ops.travel_documents document
 JOIN ops.media_assets asset ON asset.agency_id=document.agency_id AND asset.id=document.media_asset_id
 WHERE document.id=p_document_id AND document.departure_id IS NOT NULL AND document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
 AND (EXISTS(SELECT 1 FROM iam.agency_memberships member WHERE member.agency_id=document.agency_id AND member.user_id=p_actor_user_id AND member.status='active' AND member.role IN('owner','admin','editor'))
 OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id AND membership.status='active' WHERE profile.user_id=p_actor_user_id AND membership.agency_id=document.agency_id AND membership.departure_id=document.departure_id AND document.staff_role IS NULL AND (document.party_id IS NULL OR membership.party_id=document.party_id) AND (document.traveler_id IS NULL OR profile.id=document.traveler_id))
 OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment WHERE assignment.agency_id=document.agency_id AND assignment.departure_id=document.departure_id AND assignment.user_id=p_actor_user_id AND assignment.status='active' AND (document.staff_user_ids IS NULL OR p_actor_user_id=ANY(document.staff_user_ids)) AND document.staff_role IS NOT NULL AND assignment.role IN(document.staff_role,CASE WHEN document.staff_role='accompagnatore' THEN 'tour_leader' ELSE document.staff_role END))) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app.register_selected_staff_day_document_v3(UUID,UUID,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_selected_staff_day_document_v3(UUID,UUID,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,UUID[]) TO smf_app;

CREATE OR REPLACE FUNCTION app.selected_staff_chat_authorized_v3(p_actor UUID,p_departure UUID,p_role TEXT,p_recipient UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel AS $$
 SELECT app.staff_chat_authorized_v3(p_actor,p_departure,p_role)
 AND EXISTS(SELECT 1 FROM travel.departure_staff_assignments a WHERE a.departure_id=p_departure
 AND a.user_id=p_recipient AND a.status='active' AND a.role IN(p_role,CASE WHEN p_role='accompagnatore' THEN 'tour_leader' ELSE p_role END))
 AND (p_actor=p_recipient OR EXISTS(SELECT 1 FROM travel.departures d JOIN iam.agency_memberships m
 ON m.agency_id=d.agency_id WHERE d.id=p_departure AND m.user_id=p_actor AND m.status='active' AND m.role IN('owner','admin','editor')));
$$;

CREATE OR REPLACE FUNCTION app.list_selected_staff_messages_v3(p_actor UUID,p_departure UUID,p_role TEXT,p_recipient UUID,p_limit INTEGER)
RETURNS TABLE(id UUID,sender_name TEXT,sender_role TEXT,body TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,journey AS $$
DECLARE v_recipient UUID:=COALESCE(p_recipient,p_actor);
BEGIN
 IF NOT app.selected_staff_chat_authorized_v3(p_actor,p_departure,p_role,v_recipient) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff chat not authorized'; END IF;
 RETURN QUERY SELECT m.id,m.sender_name,CASE WHEN m.sender_user_id=v_recipient THEN p_role ELSE 'agency' END,m.body,m.created_at,m.sender_user_id=p_actor
 FROM journey.staff_operational_messages m WHERE m.departure_id=p_departure AND m.staff_role=p_role
 AND m.recipient_user_id=v_recipient AND m.deleted_at IS NULL ORDER BY m.created_at DESC,m.id DESC LIMIT least(greatest(p_limit,1),200);
END $$;

CREATE OR REPLACE FUNCTION app.send_selected_staff_message_v3(p_actor UUID,p_departure UUID,p_role TEXT,p_body TEXT,p_operation UUID,p_recipient UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel,journey AS $$
DECLARE v_recipient UUID:=COALESCE(p_recipient,p_actor);v_id UUID;
BEGIN
 IF NOT app.selected_staff_chat_authorized_v3(p_actor,p_departure,p_role,v_recipient) OR length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff chat not authorized'; END IF;
 INSERT INTO journey.staff_operational_messages(agency_id,departure_id,staff_role,sender_user_id,sender_name,body,client_operation_id,recipient_user_id)
 SELECT d.agency_id,d.id,p_role,p_actor,u.display_name,btrim(p_body),p_operation,v_recipient
 FROM travel.departures d JOIN iam.users u ON u.id=p_actor WHERE d.id=p_departure
 ON CONFLICT(departure_id,staff_role,client_operation_id) DO UPDATE SET body=journey.staff_operational_messages.body
 WHERE journey.staff_operational_messages.recipient_user_id=v_recipient AND journey.staff_operational_messages.sender_user_id=p_actor
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='conflicting message operation'; END IF;
 RETURN v_id;
END $$;

-- Old role-wide readers must never expose individually addressed conversations.
CREATE OR REPLACE FUNCTION app.list_staff_operational_messages_v3(p_actor UUID,p_departure UUID,p_role TEXT,p_limit INTEGER DEFAULT 100)
RETURNS TABLE(id UUID,sender_name TEXT,sender_role TEXT,body TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,journey AS $$
BEGIN
 IF NOT app.staff_chat_authorized_v3(p_actor,p_departure,p_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff chat not authorized'; END IF;
 RETURN QUERY SELECT m.id,m.sender_name,'agency'::text,m.body,m.created_at,m.sender_user_id=p_actor
 FROM journey.staff_operational_messages m WHERE m.departure_id=p_departure AND m.staff_role=p_role
 AND m.recipient_user_id IS NULL AND m.deleted_at IS NULL ORDER BY m.created_at DESC,m.id DESC LIMIT least(greatest(p_limit,1),200);
END $$;

REVOKE ALL ON FUNCTION app.selected_staff_chat_authorized_v3(UUID,UUID,TEXT,UUID),app.list_selected_staff_messages_v3(UUID,UUID,TEXT,UUID,INTEGER),app.send_selected_staff_message_v3(UUID,UUID,TEXT,TEXT,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.selected_staff_chat_authorized_v3(UUID,UUID,TEXT,UUID),app.list_selected_staff_messages_v3(UUID,UUID,TEXT,UUID,INTEGER),app.send_selected_staff_message_v3(UUID,UUID,TEXT,TEXT,UUID,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('182_v3_selected_staff_chat_documents') ON CONFLICT(version) DO NOTHING;

