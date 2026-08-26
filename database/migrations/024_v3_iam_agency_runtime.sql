-- Blocco 7: identità, agenzie e membership.
-- Replica atomica public -> iam; la cancellazione tenant avvia BR-019.

CREATE OR REPLACE FUNCTION app.sync_legacy_platform_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
DECLARE r public.platform_users%ROWTYPE; v_user UUID;
BEGIN
  r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id)
  VALUES('public-v2','user',r.id)
  ON CONFLICT(source_system,entity_type,legacy_id) DO NOTHING;
  SELECT target_id INTO v_user FROM ops.legacy_id_map
   WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=r.id;
  IF TG_OP='DELETE' THEN
    DELETE FROM iam.user_identities WHERE user_id=v_user;
    UPDATE iam.users SET display_name='Utente anonimizzato',email=NULL,phone=NULL,
      status='anonymized',updated_at=clock_timestamp() WHERE id=v_user;
    RETURN OLD;
  END IF;
  INSERT INTO iam.users(id,display_name,email,phone,platform_role,status,created_at,updated_at)
  VALUES(v_user,r.display_name,r.email,r.phone,r.platform_role,r.status,r.created_at,r.updated_at)
  ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,email=EXCLUDED.email,
    phone=EXCLUDED.phone,platform_role=EXCLUDED.platform_role,status=EXCLUDED.status,
    updated_at=EXCLUDED.updated_at;
  DELETE FROM iam.user_identities WHERE user_id=v_user
    AND (provider<>r.auth_provider OR subject IS DISTINCT FROM r.auth_subject);
  IF NULLIF(btrim(r.auth_subject),'') IS NOT NULL THEN
    INSERT INTO iam.user_identities(user_id,provider,subject,created_at)
    VALUES(v_user,r.auth_provider,r.auth_subject,r.created_at)
    ON CONFLICT(provider,subject) DO UPDATE SET user_id=EXCLUDED.user_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_agency()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
DECLARE r public.agencies%ROWTYPE; v_actor UUID;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT id INTO v_actor FROM iam.users
     WHERE platform_role='superadmin' AND status='active' ORDER BY created_at,id LIMIT 1;
    IF v_actor IS NULL THEN RAISE EXCEPTION 'BR-019: active superadmin required for agency deletion'; END IF;
    UPDATE iam.agencies SET status='deleting',updated_at=clock_timestamp() WHERE id=OLD.id;
    INSERT INTO ops.agency_deletion_jobs
      (agency_id,agency_name_snapshot,requested_by_user_id,reason)
    VALUES(OLD.id,OLD.name,v_actor,'Cancellazione richiesta dal flusso legacy durante la convergenza v3')
    ON CONFLICT(agency_id) WHERE status IN ('queued','processing','blocked') DO NOTHING;
    INSERT INTO ops.integration_outbox
      (agency_id,event_type,aggregate_type,aggregate_id,payload,idempotency_key)
    VALUES(OLD.id,'agency.deletion.requested','agency',OLD.id::text,
      jsonb_build_object('agency_id',OLD.id,'source','public-v2-trigger'),
      'agency-delete:legacy:'||OLD.id::text)
    ON CONFLICT(idempotency_key) DO NOTHING;
    RETURN OLD;
  END IF;
  r:=NEW;
  INSERT INTO iam.agencies
    (id,slug,name,legal_name,vat_number,tax_code,registered_address,registered_city,
     registered_postal_code,registered_province,registered_country_code,pec,sdi_code,
     phone,email,website,reference_name,reference_email,reference_phone,status,
     default_locale,default_timezone,branding,settings,created_at,updated_at)
  VALUES(r.id,r.slug,r.name,r.legal_name,r.vat_number,r.tax_code,r.registered_address,
    r.registered_city,r.registered_postal_code,r.registered_province,
    NULLIF(upper(left(btrim(r.registered_country),2)),''),r.pec,r.sdi_code,r.phone,r.email,
    r.website,COALESCE(NULLIF(btrim(r.reference_name),''),'Referente da completare'),
    NULLIF(r.reference_email,''),NULLIF(r.reference_phone,''),r.status,r.default_locale,
    r.default_timezone,r.branding,r.settings,r.created_at,r.updated_at)
  ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,
    legal_name=EXCLUDED.legal_name,vat_number=EXCLUDED.vat_number,tax_code=EXCLUDED.tax_code,
    registered_address=EXCLUDED.registered_address,registered_city=EXCLUDED.registered_city,
    registered_postal_code=EXCLUDED.registered_postal_code,
    registered_province=EXCLUDED.registered_province,
    registered_country_code=EXCLUDED.registered_country_code,pec=EXCLUDED.pec,
    sdi_code=EXCLUDED.sdi_code,phone=EXCLUDED.phone,email=EXCLUDED.email,
    website=EXCLUDED.website,reference_name=EXCLUDED.reference_name,
    reference_email=EXCLUDED.reference_email,reference_phone=EXCLUDED.reference_phone,
    status=EXCLUDED.status,default_locale=EXCLUDED.default_locale,
    default_timezone=EXCLUDED.default_timezone,branding=EXCLUDED.branding,
    settings=EXCLUDED.settings,updated_at=EXCLUDED.updated_at;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_agency_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
DECLARE r public.agency_memberships%ROWTYPE; v_user UUID;
BEGIN
  r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  SELECT target_id INTO v_user FROM ops.legacy_id_map
   WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=r.user_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'v3 user mapping missing for %',r.user_id; END IF;
  IF TG_OP='DELETE' THEN
    DELETE FROM iam.agency_memberships WHERE agency_id=r.agency_id AND user_id=v_user;
    RETURN OLD;
  END IF;
  INSERT INTO iam.agency_memberships(agency_id,user_id,role,status,created_at)
  VALUES(r.agency_id,v_user,r.role,'active',r.created_at)
  ON CONFLICT(agency_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_v3_platform_user ON public.platform_users;
CREATE TRIGGER sync_v3_platform_user AFTER INSERT OR UPDATE OR DELETE ON public.platform_users
FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_platform_user();
DROP TRIGGER IF EXISTS sync_v3_agency ON public.agencies;
CREATE TRIGGER sync_v3_agency AFTER INSERT OR UPDATE OR DELETE ON public.agencies
FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_agency();
DROP TRIGGER IF EXISTS sync_v3_agency_membership ON public.agency_memberships;
CREATE TRIGGER sync_v3_agency_membership AFTER INSERT OR UPDATE OR DELETE ON public.agency_memberships
FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_agency_membership();

REVOKE ALL ON FUNCTION app.sync_legacy_platform_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_agency() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_agency_membership() FROM PUBLIC;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('024_v3_iam_agency_runtime') ON CONFLICT(version) DO NOTHING;
