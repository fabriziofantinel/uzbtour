CREATE TABLE IF NOT EXISTS journey.operational_messages(
  id UUID PRIMARY KEY DEFAULT uuidv7(),agency_id UUID NOT NULL,departure_id UUID NOT NULL,party_id UUID NOT NULL,
  sender_user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  sender_traveler_id UUID REFERENCES travel.traveler_profiles(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,sender_role VARCHAR(16) NOT NULL CHECK(sender_role IN('agency','traveler')),
  body TEXT NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 2000),client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),deleted_at TIMESTAMPTZ,
  FOREIGN KEY(agency_id,departure_id,party_id) REFERENCES travel.travel_parties(agency_id,departure_id,id) ON DELETE CASCADE,
  UNIQUE(party_id,client_operation_id)
);
CREATE INDEX IF NOT EXISTS operational_messages_tenant_thread_idx ON journey.operational_messages(agency_id,departure_id,party_id,created_at DESC,id) WHERE deleted_at IS NULL;
ALTER TABLE journey.operational_messages ENABLE ROW LEVEL SECURITY;ALTER TABLE journey.operational_messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE journey.operational_messages FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.list_operational_messages_v3(p_actor_legacy TEXT,p_departure UUID,p_party UUID,p_limit INTEGER DEFAULT 100)
RETURNS TABLE(id UUID,sender_name TEXT,sender_role TEXT,body TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;
BEGIN
  SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;
  SELECT party.agency_id INTO v_agency FROM travel.travel_parties party WHERE party.id=p_party AND party.departure_id=p_departure;
  IF v_actor IS NULL OR v_agency IS NULL OR NOT(
    EXISTS(SELECT 1 FROM iam.agency_memberships member WHERE member.agency_id=v_agency AND member.user_id=v_actor AND member.status='active' AND member.role IN('owner','admin','editor'))
    OR EXISTS(SELECT 1 FROM travel.traveler_profiles profile JOIN travel.party_memberships member ON member.agency_id=profile.agency_id AND member.traveler_id=profile.id WHERE profile.user_id=v_actor AND member.departure_id=p_departure AND member.party_id=p_party AND member.status='active')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='chat not authorized';END IF;
  RETURN QUERY SELECT message.id,message.sender_name,message.sender_role::text,message.body,message.created_at,message.sender_user_id=v_actor
  FROM journey.operational_messages message WHERE message.agency_id=v_agency AND message.departure_id=p_departure AND message.party_id=p_party AND message.deleted_at IS NULL
  ORDER BY message.created_at DESC,message.id DESC LIMIT least(greatest(p_limit,1),200);
END $$;

CREATE OR REPLACE FUNCTION app.send_operational_message_v3(p_actor_legacy TEXT,p_departure UUID,p_party UUID,p_body TEXT,p_operation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_traveler UUID;v_name TEXT;v_role TEXT;v_id UUID;
BEGIN
  SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy LIMIT 1;SELECT party.agency_id INTO v_agency FROM travel.travel_parties party WHERE party.id=p_party AND party.departure_id=p_departure;
  SELECT membership.role,users.display_name INTO v_role,v_name FROM iam.agency_memberships membership JOIN iam.users users ON users.id=membership.user_id WHERE membership.agency_id=v_agency AND membership.user_id=v_actor AND membership.status='active' AND membership.role IN('owner','admin','editor') LIMIT 1;
  IF v_role IS NOT NULL THEN v_role:='agency';ELSE SELECT profile.id,profile.display_name INTO v_traveler,v_name FROM travel.traveler_profiles profile JOIN travel.party_memberships member ON member.agency_id=profile.agency_id AND member.traveler_id=profile.id WHERE profile.user_id=v_actor AND member.departure_id=p_departure AND member.party_id=p_party AND member.status='active' LIMIT 1;v_role:='traveler';END IF;
  IF v_actor IS NULL OR v_agency IS NULL OR v_name IS NULL OR length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='chat message not authorized';END IF;
  INSERT INTO journey.operational_messages(agency_id,departure_id,party_id,sender_user_id,sender_traveler_id,sender_name,sender_role,body,client_operation_id)
  VALUES(v_agency,p_departure,p_party,v_actor,v_traveler,v_name,v_role,btrim(p_body),p_operation) ON CONFLICT(party_id,client_operation_id) DO UPDATE SET body=journey.operational_messages.body RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.list_operational_messages_v3(TEXT,UUID,UUID,INTEGER),app.send_operational_message_v3(TEXT,UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_operational_messages_v3(TEXT,UUID,UUID,INTEGER),app.send_operational_message_v3(TEXT,UUID,UUID,TEXT,UUID) TO smf_app;
CREATE OR REPLACE FUNCTION app.list_party_web_push_subscriptions_v3(p_departure UUID,p_party UUID)
RETURNS TABLE(id UUID,endpoint TEXT,p256dh TEXT,auth_secret TEXT) LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,travel,journey SET row_security=off AS $$
 SELECT subscription.id,subscription.endpoint,subscription.p256dh,subscription.auth_secret
 FROM journey.web_push_subscriptions subscription JOIN travel.party_memberships membership ON membership.agency_id=subscription.agency_id AND membership.traveler_id=subscription.traveler_id
 WHERE membership.departure_id=p_departure AND membership.party_id=p_party AND membership.status='active' AND subscription.revoked_at IS NULL
$$;
REVOKE ALL ON FUNCTION app.list_party_web_push_subscriptions_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_party_web_push_subscriptions_v3(UUID,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('095_v3_operational_chat') ON CONFLICT(version) DO NOTHING;
