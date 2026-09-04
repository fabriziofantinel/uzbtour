-- Configurazione per gruppo e polizze mirate a viaggio, gruppo o viaggiatore.

CREATE TABLE IF NOT EXISTS travel.departure_party_experience_profiles (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  profile VARCHAR(20) NOT NULL CHECK (profile IN ('essential','standard','complete')),
  updated_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (agency_id, departure_id, party_id),
  FOREIGN KEY (agency_id, departure_id) REFERENCES travel.departures(agency_id,id) ON DELETE CASCADE,
  FOREIGN KEY (party_id) REFERENCES travel.travel_parties(id) ON DELETE CASCADE
);
ALTER TABLE travel.departure_party_experience_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel.departure_party_experience_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departure_party_experience_profiles_tenant ON travel.departure_party_experience_profiles;
CREATE POLICY departure_party_experience_profiles_tenant ON travel.departure_party_experience_profiles
  USING (agency_id=NULLIF(current_setting('app.agency_id',true),'')::uuid);

ALTER TABLE travel.departure_insurance_policies
  ADD COLUMN IF NOT EXISTS party_id UUID REFERENCES travel.travel_parties(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS traveler_id UUID REFERENCES travel.traveler_profiles(id) ON DELETE CASCADE;
ALTER TABLE travel.departure_insurance_policies DROP CONSTRAINT IF EXISTS departure_insurance_audience_ck;
ALTER TABLE travel.departure_insurance_policies ADD CONSTRAINT departure_insurance_audience_ck CHECK (
  (party_id IS NULL AND traveler_id IS NULL) OR (party_id IS NOT NULL AND traveler_id IS NULL) OR (party_id IS NOT NULL AND traveler_id IS NOT NULL)
) NOT VALID;
DROP INDEX IF EXISTS travel.departure_insurance_current_uidx;
DROP INDEX IF EXISTS departure_insurance_current_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS departure_insurance_trip_current_uidx
  ON travel.departure_insurance_policies(agency_id,departure_id) WHERE status='current' AND party_id IS NULL AND traveler_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS departure_insurance_group_current_uidx
  ON travel.departure_insurance_policies(agency_id,departure_id,party_id) WHERE status='current' AND party_id IS NOT NULL AND traveler_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS departure_insurance_traveler_current_uidx
  ON travel.departure_insurance_policies(agency_id,departure_id,traveler_id) WHERE status='current' AND traveler_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS departure_insurance_audience_idx
  ON travel.departure_insurance_policies(agency_id,departure_id,party_id,traveler_id,status,version_number DESC);

DROP FUNCTION IF EXISTS app.read_journey_management(TEXT,UUID);
CREATE FUNCTION app.read_journey_management(p_actor_legacy_user_id TEXT,p_departure_id UUID)
RETURNS TABLE(
  departure_id UUID,agency_id UUID,title TEXT,code TEXT,starts_on DATE,ends_on DATE,
  departure_status TEXT,agency_name TEXT,destination_country TEXT,
  party_id UUID,party_name TEXT,party_code TEXT,party_status TEXT,party_experience_profile TEXT,
  traveler_id UUID,traveler_name TEXT,traveler_username TEXT,traveler_email TEXT,traveler_phone TEXT,
  membership_role TEXT,membership_status TEXT,user_status TEXT,
  member_type TEXT,minor_image_consent TEXT,traveler_participates_in_trip_games BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ref,ops,privacy SET row_security=off AS $$
  SELECT departure.id,departure.agency_id,departure.title,departure.code,
    departure.starts_on,departure.ends_on,departure.status,agency.name,
    COALESCE(country.name,''),party.id,party.name,party.code,party.status,
    COALESCE(profile.profile,departure.experience_profile),
    traveler.id,traveler.display_name,COALESCE(users.username,''),COALESCE(traveler.email,''),
    COALESCE(traveler.phone,''),membership.role,membership.status,users.status,
    membership.member_type,COALESCE(consent.decision,'missing'),COALESCE(membership.participates_in_trip_games,false)
  FROM travel.departures departure
  JOIN iam.agencies agency ON agency.id=departure.agency_id
  JOIN travel.trip_templates template ON template.id=departure.template_id AND template.agency_id=departure.agency_id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  JOIN iam.agency_memberships actor_membership ON actor_membership.agency_id=departure.agency_id
    AND actor_membership.status='active' AND actor_membership.role IN('owner','admin','editor')
  JOIN ops.legacy_id_map actor_map ON actor_map.target_id=actor_membership.user_id
    AND actor_map.source_system='public-v2' AND actor_map.entity_type='user' AND actor_map.legacy_id=p_actor_legacy_user_id
  JOIN iam.users actor ON actor.id=actor_membership.user_id AND actor.status='active'
  LEFT JOIN travel.travel_parties party ON party.departure_id=departure.id
  LEFT JOIN travel.departure_party_experience_profiles profile ON profile.agency_id=departure.agency_id
    AND profile.departure_id=departure.id AND profile.party_id=party.id
  LEFT JOIN travel.party_memberships membership ON membership.party_id=party.id AND membership.status<>'removed'
  LEFT JOIN travel.traveler_profiles traveler ON traveler.id=membership.traveler_id AND traveler.agency_id=departure.agency_id
  LEFT JOIN iam.users users ON users.id=traveler.user_id
  LEFT JOIN LATERAL (
    SELECT record.decision FROM privacy.consent_records record
    WHERE record.agency_id=departure.agency_id AND record.departure_id=departure.id
      AND record.party_id=party.id AND record.subject_traveler_id=traveler.id
      AND record.consent_type='minor_image_upload' AND record.consent_scope='party'
      AND (record.expires_at IS NULL OR record.expires_at>clock_timestamp())
    ORDER BY record.effective_at DESC,record.id DESC LIMIT 1
  ) consent ON true
  WHERE departure.id=p_departure_id
  ORDER BY party.name,membership.role,traveler.display_name
$$;

DROP FUNCTION IF EXISTS app.set_departure_party_experience_profile_v3(TEXT,UUID,UUID,TEXT);
CREATE OR REPLACE FUNCTION app.set_departure_party_experience_profile_v3(
  p_actor_user_id UUID,p_departure UUID,p_party UUID,p_profile TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;
BEGIN
 IF p_profile NOT IN('essential','standard','complete') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid experience profile'; END IF;
 v_actor:=p_actor_user_id;
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure JOIN iam.agency_memberships membership
  ON membership.agency_id=departure.agency_id AND membership.user_id=v_actor AND membership.status='active' AND membership.role IN('owner','admin','editor')
 WHERE departure.id=p_departure LIMIT 1;
 IF v_agency IS NULL OR NOT EXISTS(SELECT 1 FROM travel.travel_parties party WHERE party.id=p_party AND party.agency_id=v_agency AND party.departure_id=p_departure AND party.status<>'archived') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='group experience profile update not authorized'; END IF;
 INSERT INTO travel.departure_party_experience_profiles(agency_id,departure_id,party_id,profile,updated_by)
 VALUES(v_agency,p_departure,p_party,p_profile,v_actor)
 ON CONFLICT(agency_id,departure_id,party_id) DO UPDATE SET profile=EXCLUDED.profile,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
 INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
 VALUES(v_agency,v_actor,'travel_party',p_party::text,'experience_profile_updated',jsonb_build_object('departureId',p_departure,'profile',p_profile));
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION app.read_departure_experience_profile_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
 WITH actor AS (SELECT target_id id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1),
 membership AS (SELECT party_membership.party_id FROM travel.party_memberships party_membership JOIN travel.traveler_profiles profile
  ON profile.agency_id=party_membership.agency_id AND profile.id=party_membership.traveler_id JOIN actor ON actor.id=profile.user_id
  WHERE party_membership.departure_id=p_departure AND party_membership.status='active' LIMIT 1)
 SELECT COALESCE(group_profile.profile,departure.experience_profile) FROM travel.departures departure
 LEFT JOIN membership ON true LEFT JOIN travel.departure_party_experience_profiles group_profile
  ON group_profile.agency_id=departure.agency_id AND group_profile.departure_id=departure.id AND group_profile.party_id=membership.party_id
 WHERE departure.id=p_departure AND (EXISTS(SELECT 1 FROM iam.agency_memberships member,actor WHERE member.agency_id=departure.agency_id AND member.user_id=actor.id AND member.status='active') OR EXISTS(SELECT 1 FROM membership)) LIMIT 1
$$;

DROP FUNCTION IF EXISTS app.save_departure_insurance_scoped_v3(TEXT,UUID,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,DATE,DATE,JSONB,UUID);
CREATE OR REPLACE FUNCTION app.save_departure_insurance_scoped_v3(
 p_actor_user_id UUID,p_departure UUID,p_scope TEXT,p_party UUID,p_traveler UUID,p_provider TEXT,p_product TEXT,p_policy_number TEXT,p_phone TEXT,
 p_valid_from DATE,p_valid_to DATE,p_guarantees JSONB,p_document UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_id UUID;v_version INTEGER;
BEGIN
 v_actor:=p_actor_user_id;
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id
  AND membership.user_id=v_actor AND membership.status='active' AND membership.role IN('owner','admin','editor') WHERE departure.id=p_departure LIMIT 1;
 IF v_agency IS NULL OR p_scope NOT IN('trip','group','traveler') OR p_valid_to<p_valid_from OR jsonb_typeof(COALESCE(p_guarantees,'[]'))<>'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid insurance policy'; END IF;
 IF p_scope='trip' AND (p_party IS NOT NULL OR p_traveler IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid trip insurance audience'; END IF;
 IF p_scope='group' AND (p_party IS NULL OR p_traveler IS NOT NULL OR NOT EXISTS(SELECT 1 FROM travel.travel_parties party WHERE party.id=p_party AND party.agency_id=v_agency AND party.departure_id=p_departure AND party.status<>'archived')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid group insurance audience'; END IF;
 IF p_scope='traveler' AND (p_party IS NULL OR p_traveler IS NULL OR NOT EXISTS(SELECT 1 FROM travel.party_memberships membership WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure AND membership.party_id=p_party AND membership.traveler_id=p_traveler AND membership.status='active')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid traveler insurance audience'; END IF;
 IF p_document IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ops.travel_documents document WHERE document.agency_id=v_agency AND document.departure_id=p_departure AND document.id=p_document AND document.status='ready' AND document.party_id IS NOT DISTINCT FROM p_party AND document.traveler_id IS NOT DISTINCT FROM p_traveler) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid insurance document'; END IF;
 SELECT COALESCE(max(version_number),0)+1 INTO v_version FROM travel.departure_insurance_policies WHERE agency_id=v_agency AND departure_id=p_departure;
 UPDATE travel.departure_insurance_policies SET status='superseded',updated_at=clock_timestamp() WHERE agency_id=v_agency AND departure_id=p_departure AND status='current' AND party_id IS NOT DISTINCT FROM p_party AND traveler_id IS NOT DISTINCT FROM p_traveler;
 INSERT INTO travel.departure_insurance_policies(agency_id,departure_id,party_id,traveler_id,provider_name,product_name,policy_number,assistance_phone,valid_from,valid_to,guarantees,document_id,version_number,created_by)
 VALUES(v_agency,p_departure,p_party,p_traveler,btrim(p_provider),btrim(COALESCE(p_product,'')),btrim(p_policy_number),btrim(p_phone),p_valid_from,p_valid_to,COALESCE(p_guarantees,'[]'),p_document,v_version,v_actor) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

DROP FUNCTION IF EXISTS app.read_departure_insurance_scoped_v3(TEXT,UUID,TEXT,UUID,UUID);
CREATE OR REPLACE FUNCTION app.read_departure_insurance_scoped_v3(p_actor_user_id UUID,p_departure UUID,p_scope TEXT,p_party UUID,p_traveler UUID)
RETURNS TABLE(id UUID,agency_id UUID,provider_name VARCHAR,product_name VARCHAR,policy_number VARCHAR,assistance_phone VARCHAR,valid_from DATE,valid_to DATE,guarantees JSONB,document_id UUID,document_title TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
 WITH allowed AS (
 SELECT departure.agency_id FROM travel.departures departure JOIN iam.agency_memberships member ON member.agency_id=departure.agency_id AND member.user_id=p_actor_user_id
 WHERE departure.id=p_departure AND member.status='active' AND member.role IN('owner','admin','editor'))
 SELECT policy.id,policy.agency_id,policy.provider_name,policy.product_name,policy.policy_number,policy.assistance_phone,policy.valid_from,policy.valid_to,policy.guarantees,policy.document_id,document.title
 FROM travel.departure_insurance_policies policy JOIN allowed ON allowed.agency_id=policy.agency_id LEFT JOIN ops.travel_documents document ON document.agency_id=policy.agency_id AND document.id=policy.document_id
 WHERE policy.departure_id=p_departure AND policy.status='current' AND ((p_scope='trip' AND policy.party_id IS NULL AND policy.traveler_id IS NULL) OR (p_scope='group' AND policy.party_id=p_party AND policy.traveler_id IS NULL) OR (p_scope='traveler' AND policy.party_id=p_party AND policy.traveler_id=p_traveler)) LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.read_departure_insurance_v3(p_actor_legacy TEXT,p_departure UUID)
RETURNS TABLE(id UUID,agency_id UUID,provider_name VARCHAR,product_name VARCHAR,policy_number VARCHAR,assistance_phone VARCHAR,valid_from DATE,valid_to DATE,guarantees JSONB,document_id UUID,document_title TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
 WITH actor AS (SELECT target_id id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=p_actor_legacy LIMIT 1), allowed AS (
 SELECT departure.agency_id, membership.party_id,membership.traveler_id FROM travel.departures departure JOIN travel.party_memberships membership ON membership.agency_id=departure.agency_id AND membership.departure_id=departure.id AND membership.status='active'
 JOIN travel.traveler_profiles profile ON profile.id=membership.traveler_id AND profile.agency_id=membership.agency_id JOIN actor ON actor.id=profile.user_id WHERE departure.id=p_departure
 UNION ALL SELECT departure.agency_id,NULL::uuid,NULL::uuid FROM travel.departures departure JOIN iam.agency_memberships member ON member.agency_id=departure.agency_id JOIN actor ON actor.id=member.user_id WHERE departure.id=p_departure AND member.status='active')
 SELECT policy.id,policy.agency_id,policy.provider_name,policy.product_name,policy.policy_number,policy.assistance_phone,policy.valid_from,policy.valid_to,policy.guarantees,policy.document_id,document.title
 FROM travel.departure_insurance_policies policy JOIN allowed ON allowed.agency_id=policy.agency_id LEFT JOIN ops.travel_documents document ON document.agency_id=policy.agency_id AND document.id=policy.document_id
 WHERE policy.departure_id=p_departure AND policy.status='current' AND (policy.traveler_id=allowed.traveler_id OR (policy.traveler_id IS NULL AND policy.party_id=allowed.party_id) OR (policy.traveler_id IS NULL AND policy.party_id IS NULL))
 ORDER BY CASE WHEN policy.traveler_id=allowed.traveler_id AND policy.traveler_id IS NOT NULL THEN 3 WHEN policy.party_id=allowed.party_id AND policy.party_id IS NOT NULL THEN 2 ELSE 1 END DESC LIMIT 1
$$;

DROP FUNCTION IF EXISTS app.register_departure_insurance_document_scoped_v3(TEXT,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT);
CREATE OR REPLACE FUNCTION app.register_departure_insurance_document_scoped_v3(
 p_actor_user_id UUID,p_departure UUID,p_scope TEXT,p_party UUID,p_traveler UUID,p_media UUID,p_document UUID,p_provider TEXT,p_bucket TEXT,p_key TEXT,p_name TEXT,p_content_type TEXT,p_size BIGINT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_agency UUID;v_prefix TEXT;v_visibility TEXT;
BEGIN
 v_actor:=p_actor_user_id;
 SELECT departure.agency_id INTO v_agency FROM travel.departures departure JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id AND membership.user_id=v_actor AND membership.status='active' AND membership.role IN('owner','admin','editor') WHERE departure.id=p_departure LIMIT 1;
 IF v_agency IS NULL OR p_scope NOT IN('trip','group','traveler') OR p_provider NOT IN('r2','s3') OR p_content_type<>'application/pdf' OR p_size<=0 OR p_size>26214400 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid insurance document'; END IF;
 IF p_scope='trip' AND (p_party IS NOT NULL OR p_traveler IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid trip insurance audience'; END IF;
 IF p_scope='group' AND (p_party IS NULL OR p_traveler IS NOT NULL OR NOT EXISTS(SELECT 1 FROM travel.travel_parties party WHERE party.id=p_party AND party.agency_id=v_agency AND party.departure_id=p_departure AND party.status<>'archived')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid group insurance audience'; END IF;
 IF p_scope='traveler' AND (p_party IS NULL OR p_traveler IS NULL OR NOT EXISTS(SELECT 1 FROM travel.party_memberships membership WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure AND membership.party_id=p_party AND membership.traveler_id=p_traveler AND membership.status='active')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid traveler insurance audience'; END IF;
 v_prefix:='agencies/'||v_agency||'/departures/'||p_departure||'/insurance/'||CASE p_scope WHEN 'trip' THEN 'trip' WHEN 'group' THEN 'groups/'||p_party ELSE 'travelers/'||p_traveler END||'/';
 IF position(v_prefix IN p_key)<>1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid insurance document key'; END IF;
 v_visibility:=CASE p_scope WHEN 'trip' THEN 'agency' WHEN 'group' THEN 'party' ELSE 'private' END;
 INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status) VALUES(p_media,v_agency,p_departure,p_party,v_actor,p_provider,p_bucket,p_key,left(p_name,500),p_content_type,p_size,'insurance',v_visibility,'ready');
 INSERT INTO ops.travel_documents(id,agency_id,departure_id,party_id,traveler_id,media_asset_id,document_type,title,status) VALUES(p_document,v_agency,p_departure,p_party,p_traveler,p_media,'insurance',left(p_name,500),'ready');
 RETURN p_document;
END $$;

REVOKE ALL ON FUNCTION app.read_journey_management(TEXT,UUID),app.set_departure_party_experience_profile_v3(UUID,UUID,UUID,TEXT),app.read_departure_experience_profile_v3(TEXT,UUID),app.save_departure_insurance_scoped_v3(UUID,UUID,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,DATE,DATE,JSONB,UUID),app.read_departure_insurance_scoped_v3(UUID,UUID,TEXT,UUID,UUID),app.read_departure_insurance_v3(TEXT,UUID),app.register_departure_insurance_document_scoped_v3(UUID,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_journey_management(TEXT,UUID),app.set_departure_party_experience_profile_v3(UUID,UUID,UUID,TEXT),app.read_departure_experience_profile_v3(TEXT,UUID),app.save_departure_insurance_scoped_v3(UUID,UUID,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,DATE,DATE,JSONB,UUID),app.read_departure_insurance_scoped_v3(UUID,UUID,TEXT,UUID,UUID),app.read_departure_insurance_v3(TEXT,UUID),app.register_departure_insurance_document_scoped_v3(UUID,UUID,TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('173_v3_group_experience_and_insurance_audience') ON CONFLICT(version) DO NOTHING;
