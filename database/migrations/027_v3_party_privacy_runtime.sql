-- Blocco 10: famiglie, viaggiatori e classificazione privacy dei minori.
-- Nessun consenso viene inferito: l'assenza di privacy.consent_records equivale
-- a consenso non concesso.

CREATE OR REPLACE FUNCTION app.sync_legacy_traveler_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE r public.traveler_profiles%ROWTYPE; v_user UUID;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_OP='DELETE' THEN DELETE FROM travel.traveler_profiles WHERE agency_id=r.agency_id AND id=r.id; RETURN OLD; END IF;
 IF r.user_id IS NOT NULL THEN SELECT target_id INTO v_user FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=r.user_id; END IF;
 INSERT INTO travel.traveler_profiles(id,agency_id,user_id,display_name,email,phone,birth_date,metadata,created_at,updated_at)
 VALUES(r.id,r.agency_id,v_user,r.display_name,r.email,r.phone,r.birth_date,r.metadata,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,display_name=EXCLUDED.display_name,
  email=EXCLUDED.email,phone=EXCLUDED.phone,birth_date=EXCLUDED.birth_date,
  metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_travel_party()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,travel SET row_security=off AS $$
DECLARE r public.travel_parties%ROWTYPE;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_OP='DELETE' THEN DELETE FROM travel.travel_parties WHERE agency_id=r.agency_id AND id=r.id; RETURN OLD; END IF;
 INSERT INTO travel.travel_parties(id,agency_id,departure_id,code,name,status,settings,created_at,updated_at)
 VALUES(r.id,r.agency_id,r.departure_id,r.code,r.name,r.status,r.settings,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET departure_id=EXCLUDED.departure_id,code=EXCLUDED.code,
  name=EXCLUDED.name,status=EXCLUDED.status,settings=EXCLUDED.settings,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_party_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,travel SET row_security=off AS $$
DECLARE r public.party_memberships%ROWTYPE; v_departure UUID; v_starts DATE; v_birth DATE; v_type TEXT;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 SELECT p.departure_id,d.starts_on INTO v_departure,v_starts
 FROM travel.travel_parties p JOIN travel.departures d ON d.id=p.departure_id
 WHERE p.agency_id=r.agency_id AND p.id=r.party_id;
 IF TG_OP='DELETE' THEN DELETE FROM travel.party_memberships WHERE party_id=r.party_id AND traveler_id=r.traveler_id; RETURN OLD; END IF;
 SELECT birth_date INTO v_birth FROM travel.traveler_profiles WHERE agency_id=r.agency_id AND id=r.traveler_id;
 v_type:=CASE WHEN r.role<>'organizer' AND v_birth IS NOT NULL AND v_birth>(v_starts-interval '18 years')::date
  THEN 'dependent_minor' ELSE 'adult' END;
 INSERT INTO travel.party_memberships(agency_id,departure_id,party_id,traveler_id,role,member_type,status,joined_at)
 VALUES(r.agency_id,v_departure,r.party_id,r.traveler_id,r.role,v_type,r.status,r.joined_at)
 ON CONFLICT(party_id,traveler_id) DO UPDATE SET departure_id=EXCLUDED.departure_id,
  role=EXCLUDED.role,member_type=EXCLUDED.member_type,status=EXCLUDED.status;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_invitation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
DECLARE r public.user_invitations%ROWTYPE; v_user UUID; v_creator UUID; v_agency UUID;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 SELECT target_id INTO v_user FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=r.user_id;
 IF TG_OP='DELETE' THEN DELETE FROM iam.invitations WHERE id=r.id; RETURN OLD; END IF;
 IF r.created_by_user_id IS NOT NULL THEN SELECT target_id INTO v_creator FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=r.created_by_user_id; END IF;
 SELECT agency_id INTO v_agency FROM iam.agency_memberships WHERE user_id=v_user AND status IN('invited','active') ORDER BY created_at DESC LIMIT 1;
 INSERT INTO iam.invitations(id,agency_id,invited_user_id,created_by_user_id,token_hash,expires_at,used_at,created_at)
 VALUES(r.id,v_agency,v_user,v_creator,r.token_hash,r.expires_at,r.used_at,r.created_at)
 ON CONFLICT(id) DO UPDATE SET agency_id=EXCLUDED.agency_id,invited_user_id=EXCLUDED.invited_user_id,
  created_by_user_id=EXCLUDED.created_by_user_id,expires_at=EXCLUDED.expires_at,used_at=EXCLUDED.used_at;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_v3_traveler_profile ON public.traveler_profiles;
CREATE TRIGGER sync_v3_traveler_profile AFTER INSERT OR UPDATE OR DELETE ON public.traveler_profiles FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_traveler_profile();
DROP TRIGGER IF EXISTS sync_v3_travel_party ON public.travel_parties;
CREATE TRIGGER sync_v3_travel_party AFTER INSERT OR UPDATE OR DELETE ON public.travel_parties FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_travel_party();
DROP TRIGGER IF EXISTS sync_v3_party_membership ON public.party_memberships;
CREATE TRIGGER sync_v3_party_membership AFTER INSERT OR UPDATE OR DELETE ON public.party_memberships FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_party_membership();
DROP TRIGGER IF EXISTS sync_v3_invitation ON public.user_invitations;
CREATE TRIGGER sync_v3_invitation AFTER INSERT OR UPDATE OR DELETE ON public.user_invitations FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_invitation();

REVOKE ALL ON FUNCTION app.sync_legacy_traveler_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_travel_party() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_party_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_invitation() FROM PUBLIC;
GRANT USAGE ON SCHEMA travel,privacy TO smf_app;
GRANT SELECT ON travel.traveler_profiles,travel.travel_parties,travel.party_memberships,privacy.consent_records TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('027_v3_party_privacy_runtime') ON CONFLICT(version) DO NOTHING;
