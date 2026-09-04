-- Elimina l'ambiguita' tra le colonne restituite dalla funzione e le colonne delle tabelle.
-- La funzione viene richiamata dalla route /api/chat con identificativi UUID nativi.

CREATE OR REPLACE FUNCTION app.list_operational_messages_scoped_v3(
  p_actor_user_id UUID,p_departure UUID,p_scope TEXT,p_party UUID,p_traveler UUID,p_limit INTEGER DEFAULT 100
) RETURNS TABLE(id UUID,sender_name TEXT,sender_role TEXT,body TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey,ops SET row_security=off AS $$
#variable_conflict use_column
DECLARE v_agency UUID;v_own_traveler UUID;v_own_party UUID;v_staff BOOLEAN;
BEGIN
  IF p_scope NOT IN('trip','group','traveler') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid chat scope';END IF;
  SELECT departure.agency_id INTO v_agency FROM travel.departures departure WHERE departure.id=p_departure;
  SELECT profile.id,membership.party_id INTO v_own_traveler,v_own_party
  FROM travel.traveler_profiles profile JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id
  WHERE profile.user_id=p_actor_user_id AND membership.departure_id=p_departure AND membership.status='active' LIMIT 1;
  v_staff:=app.is_departure_operator_v3(p_actor_user_id,p_departure);
  IF NOT v_staff AND v_own_traveler IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='chat not authorized';END IF;
  IF p_scope='group' AND (p_party IS NULL OR (NOT v_staff AND p_party<>v_own_party)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='group chat not authorized';END IF;
  IF p_scope='traveler' AND (p_party IS NULL OR p_traveler IS NULL OR (NOT v_staff AND p_traveler<>v_own_traveler)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler chat not authorized';END IF;
  RETURN QUERY SELECT message.id,message.sender_name,message.sender_role::text,message.body,message.created_at,message.sender_user_id=p_actor_user_id
  FROM journey.operational_messages message
  WHERE message.agency_id=v_agency AND message.departure_id=p_departure AND message.scope_type=p_scope
    AND message.party_id IS NOT DISTINCT FROM CASE WHEN p_scope='trip' THEN NULL ELSE p_party END
    AND message.subject_traveler_id IS NOT DISTINCT FROM CASE WHEN p_scope='traveler' THEN p_traveler ELSE NULL END
    AND message.deleted_at IS NULL ORDER BY message.created_at DESC,message.id DESC LIMIT least(greatest(p_limit,1),200);
END $$;

REVOKE ALL ON FUNCTION app.list_operational_messages_scoped_v3(UUID,UUID,TEXT,UUID,UUID,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_operational_messages_scoped_v3(UUID,UUID,TEXT,UUID,UUID,INTEGER) TO smf_app;

INSERT INTO public.platform_schema_migrations(version) VALUES('170_v3_native_operational_chat_column_ambiguity_fix') ON CONFLICT(version) DO NOTHING;
