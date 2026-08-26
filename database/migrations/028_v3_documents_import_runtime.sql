-- Blocco 11: documenti, biglietti, importazioni, job e audit operativo.

CREATE OR REPLACE FUNCTION app.sync_legacy_travel_document()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE r public.travel_documents%ROWTYPE;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_OP='DELETE' THEN DELETE FROM ops.travel_documents WHERE id=r.id; RETURN OLD; END IF;
 INSERT INTO ops.travel_documents(id,agency_id,template_id,departure_id,media_asset_id,document_type,title,status,created_at)
 VALUES(r.id,r.agency_id,r.template_id,r.departure_id,r.media_asset_id,
  CASE r.document_type WHEN 'programme' THEN 'accepted_quote' WHEN 'normalized_programme' THEN 'normalized_programme'
   WHEN 'ticket' THEN 'ticket' WHEN 'voucher' THEN 'voucher' WHEN 'insurance' THEN 'insurance' ELSE 'other' END,
  r.title,r.status,r.created_at)
 ON CONFLICT(id) DO UPDATE SET template_id=EXCLUDED.template_id,departure_id=EXCLUDED.departure_id,
  media_asset_id=EXCLUDED.media_asset_id,document_type=EXCLUDED.document_type,title=EXCLUDED.title,status=EXCLUDED.status;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_itinerary_document()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE r public.itinerary_item_documents%ROWTYPE; v_item UUID;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_OP='DELETE' THEN DELETE FROM ops.travel_documents WHERE id=r.id; RETURN OLD; END IF;
 SELECT target_id INTO v_item FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='departure_item'
  AND legacy_id=r.departure_id::text||':'||r.itinerary_item_id::text;
 IF v_item IS NULL THEN RAISE EXCEPTION 'v3 departure item mapping missing for document %',r.id; END IF;
 INSERT INTO ops.travel_documents(id,agency_id,departure_id,departure_item_id,media_asset_id,document_type,title,status,created_at)
 VALUES(r.id,r.agency_id,r.departure_id,v_item,r.media_asset_id,
  CASE r.document_type WHEN 'ticket' THEN 'ticket' WHEN 'voucher' THEN 'voucher' ELSE 'other' END,r.title,'ready',r.created_at)
 ON CONFLICT(id) DO UPDATE SET departure_id=EXCLUDED.departure_id,departure_item_id=EXCLUDED.departure_item_id,
  media_asset_id=EXCLUDED.media_asset_id,document_type=EXCLUDED.document_type,title=EXCLUDED.title,status=EXCLUDED.status;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_import_job()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE r public.import_jobs%ROWTYPE; v_user UUID;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_OP='DELETE' THEN DELETE FROM ops.import_jobs WHERE id=r.id; RETURN OLD; END IF;
 IF r.created_by_user_id IS NOT NULL THEN SELECT target_id INTO v_user FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=r.created_by_user_id; END IF;
 INSERT INTO ops.import_jobs(id,agency_id,template_id,source_document_id,normalized_document_id,status,
  extraction_provider,attempt_count,result,error_message,started_at,completed_at,created_by_user_id,created_at,updated_at)
 VALUES(r.id,r.agency_id,r.template_id,r.document_id,r.normalized_document_id,r.status,r.extraction_provider,
  r.attempt_count,coalesce(r.result,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('legacyAiProvider',r.ai_provider)),
  r.error_message,r.started_at,r.completed_at,v_user,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET normalized_document_id=EXCLUDED.normalized_document_id,status=EXCLUDED.status,
  extraction_provider=EXCLUDED.extraction_provider,attempt_count=EXCLUDED.attempt_count,result=EXCLUDED.result,
  error_message=EXCLUDED.error_message,started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,
  created_by_user_id=EXCLUDED.created_by_user_id,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_platform_job()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE r public.platform_jobs%ROWTYPE; v_import UUID;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_OP='DELETE' THEN DELETE FROM ops.platform_jobs WHERE id=r.id; RETURN OLD; END IF;
 IF r.payload->>'importId' ~* '^[0-9a-f-]{36}$' THEN SELECT id INTO v_import FROM public.import_jobs
  WHERE agency_id=r.agency_id AND id=(r.payload->>'importId')::uuid; END IF;
 INSERT INTO ops.platform_jobs(id,agency_id,import_job_id,job_type,provider,status,payload,external_id,idempotency_key,
  attempt_count,available_at,locked_at,completed_at,error_message,created_at,updated_at)
 VALUES(r.id,r.agency_id,v_import,r.job_type,r.provider,r.status,r.payload,r.external_id,r.idempotency_key,
  r.attempt_count,r.available_at,r.locked_at,r.completed_at,r.error_message,r.created_at,r.updated_at)
 ON CONFLICT(id) DO UPDATE SET import_job_id=EXCLUDED.import_job_id,job_type=EXCLUDED.job_type,
  provider=EXCLUDED.provider,status=EXCLUDED.status,payload=EXCLUDED.payload,external_id=EXCLUDED.external_id,
  idempotency_key=EXCLUDED.idempotency_key,attempt_count=EXCLUDED.attempt_count,
  available_at=EXCLUDED.available_at,locked_at=EXCLUDED.locked_at,completed_at=EXCLUDED.completed_at,
  error_message=EXCLUDED.error_message,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_audit_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE v_user UUID;
BEGIN
 IF NEW.actor_user_id IS NOT NULL THEN SELECT target_id INTO v_user FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=NEW.actor_user_id; END IF;
 INSERT INTO ops.audit_events(id,agency_id,actor_user_id,entity_type,entity_id,action,changes,request_id,created_at)
 OVERRIDING SYSTEM VALUE VALUES(NEW.id,NEW.agency_id,v_user,NEW.entity_type,NEW.entity_id,NEW.action,
  NEW.changes||jsonb_strip_nulls(jsonb_build_object('legacyDepartureId',NEW.departure_id,'legacyPartyId',NEW.party_id)),NEW.request_id,NEW.created_at)
 ON CONFLICT(id) DO UPDATE SET actor_user_id=EXCLUDED.actor_user_id,entity_type=EXCLUDED.entity_type,
  entity_id=EXCLUDED.entity_id,action=EXCLUDED.action,changes=EXCLUDED.changes,request_id=EXCLUDED.request_id;
 PERFORM setval(pg_get_serial_sequence('ops.audit_events','id'),greatest((SELECT max(id) FROM ops.audit_events),1),true);
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_v3_travel_document ON public.travel_documents;
CREATE TRIGGER sync_v3_travel_document AFTER INSERT OR UPDATE OR DELETE ON public.travel_documents FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_travel_document();
DROP TRIGGER IF EXISTS sync_v3_itinerary_document ON public.itinerary_item_documents;
CREATE TRIGGER sync_v3_itinerary_document AFTER INSERT OR UPDATE OR DELETE ON public.itinerary_item_documents FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_itinerary_document();
DROP TRIGGER IF EXISTS sync_v3_import_job ON public.import_jobs;
CREATE TRIGGER sync_v3_import_job AFTER INSERT OR UPDATE OR DELETE ON public.import_jobs FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_import_job();
DROP TRIGGER IF EXISTS sync_v3_platform_job ON public.platform_jobs;
CREATE TRIGGER sync_v3_platform_job AFTER INSERT OR UPDATE OR DELETE ON public.platform_jobs FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_platform_job();
DROP TRIGGER IF EXISTS sync_v3_audit_event ON public.audit_events;
CREATE TRIGGER sync_v3_audit_event AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_audit_event();

REVOKE ALL ON FUNCTION app.sync_legacy_travel_document() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_itinerary_document() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_import_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_platform_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_audit_event() FROM PUBLIC;
GRANT USAGE ON SCHEMA ops TO smf_app;
GRANT SELECT ON ops.travel_documents,ops.import_jobs,ops.platform_jobs TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('028_v3_documents_import_runtime') ON CONFLICT(version) DO NOTHING;
