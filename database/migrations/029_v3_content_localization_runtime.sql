-- Blocco 12: info utili, frasi e attività generate.
-- Il bypass è accettato solo da trigger annidati SECURITY DEFINER: una scrittura
-- diretta del runtime resta bloccata dall'immutabilità delle versioni pubblicate.

CREATE OR REPLACE FUNCTION app.assert_template_version_mutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel AS $$
DECLARE v_agency UUID; v_version UUID; v_status TEXT;
BEGIN
 IF pg_trigger_depth()>1 AND current_setting('app.legacy_sync',true)='on' THEN
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 v_agency:=CASE WHEN TG_OP='DELETE' THEN OLD.agency_id ELSE NEW.agency_id END;
 v_version:=CASE WHEN TG_OP='DELETE' THEN OLD.template_version_id ELSE NEW.template_version_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text,0));
 SELECT status INTO v_status FROM travel.trip_template_versions WHERE agency_id=v_agency AND id=v_version;
 IF v_status IS NULL THEN RAISE EXCEPTION 'template version % not found in tenant %',v_version,v_agency; END IF;
 IF v_status<>'draft' THEN RAISE EXCEPTION 'template version % is immutable in status %',v_version,v_status; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION app.assert_template_version_mutable() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.sync_legacy_useful_information()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel SET row_security=off AS $$
DECLARE r public.useful_information%ROWTYPE;
BEGIN
 PERFORM set_config('app.legacy_sync','on',true); r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_OP='DELETE' THEN DELETE FROM travel.template_useful_information WHERE id=r.id; RETURN OLD; END IF;
 INSERT INTO travel.template_useful_information(id,agency_id,template_version_id,category,title,body,phone,url,sort_order,source,metadata)
 VALUES(r.id,r.agency_id,r.template_version_id,r.category,r.title,r.body,r.phone,r.url,r.sort_order,
  CASE WHEN r.metadata->>'source' IN('manual','import','ai') THEN r.metadata->>'source' ELSE 'import' END,r.metadata)
 ON CONFLICT(id) DO UPDATE SET category=EXCLUDED.category,title=EXCLUDED.title,body=EXCLUDED.body,
  phone=EXCLUDED.phone,url=EXCLUDED.url,sort_order=EXCLUDED.sort_order,source=EXCLUDED.source,
  metadata=EXCLUDED.metadata,updated_at=clock_timestamp();
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_phrasebook_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel SET row_security=off AS $$
DECLARE r public.phrasebook_entries%ROWTYPE; v_locale app.locale_code;
BEGIN
 PERFORM set_config('app.legacy_sync','on',true); r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF TG_OP='DELETE' THEN DELETE FROM travel.template_phrasebook_entries WHERE id=r.id; RETURN OLD; END IF;
 SELECT coalesce(t.default_locale,'it-IT') INTO v_locale FROM public.trip_template_versions v
  JOIN public.trip_templates t ON t.id=v.template_id WHERE v.id=r.template_version_id;
 INSERT INTO travel.template_phrasebook_entries(id,agency_id,template_version_id,locale,language_code,category,term,pronunciation,translation,sort_order,source)
 VALUES(r.id,r.agency_id,r.template_version_id,v_locale,r.language_code,r.category,r.term,r.pronunciation,r.translation,r.sort_order,r.source)
 ON CONFLICT(id) DO UPDATE SET locale=EXCLUDED.locale,language_code=EXCLUDED.language_code,
  category=EXCLUDED.category,term=EXCLUDED.term,pronunciation=EXCLUDED.pronunciation,
  translation=EXCLUDED.translation,sort_order=EXCLUDED.sort_order,source=EXCLUDED.source,updated_at=clock_timestamp();
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.refresh_legacy_generated_activity(
 p_agency UUID,p_version UUID,p_day UUID,p_type TEXT,p_legacy_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,content,ops SET row_security=off AS $$
DECLARE v_group TEXT; v_activity UUID; v_activity_type TEXT; v_category TEXT; v_count INTEGER;
 v_status TEXT; v_source TEXT; v_title TEXT; v_instructions TEXT; v_sort INTEGER;
BEGIN
 PERFORM set_config('app.legacy_sync','on',true);
 IF p_type IN('quiz_question','mission','bingo_item') THEN
  v_group:='group:'||p_version::text||':'||coalesce(p_day::text,'trip')||':'||p_type;
 ELSE v_group:='item:'||p_legacy_id::text; END IF;
 SELECT target_id INTO v_activity FROM ops.legacy_id_map
  WHERE source_system='public-v2' AND entity_type='content_activity' AND legacy_id=v_group;
 SELECT count(*) INTO v_count FROM public.generated_content g WHERE g.agency_id=p_agency AND g.template_version_id=p_version
  AND ((p_type IN('quiz_question','mission','bingo_item') AND g.content_type=p_type AND g.trip_day_id IS NOT DISTINCT FROM p_day)
    OR (p_type NOT IN('quiz_question','mission','bingo_item') AND g.id=p_legacy_id));
 IF v_count=0 THEN
  IF v_activity IS NOT NULL THEN
   UPDATE content.activities SET status='archived',updated_at=clock_timestamp() WHERE id=v_activity;
   DELETE FROM content.activity_items WHERE activity_id=v_activity;
  END IF; RETURN;
 END IF;
 IF v_activity IS NULL THEN
  INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,agency_id)
  VALUES('public-v2','content_activity',v_group,p_agency)
  ON CONFLICT(source_system,entity_type,legacy_id) DO UPDATE SET agency_id=EXCLUDED.agency_id
  RETURNING target_id INTO v_activity;
 END IF;
 SELECT CASE p_type WHEN 'quiz_question' THEN 'quiz' WHEN 'mission' THEN 'mission' WHEN 'bingo_item' THEN 'bingo'
   WHEN 'order_game' THEN 'order_game' WHEN 'puzzle' THEN 'puzzle'
   WHEN 'word_game' THEN CASE WHEN bool_or(g.content->>'type'='rebus') THEN 'puzzle' ELSE 'word_game' END ELSE 'photo_contest' END,
  CASE WHEN p_type='photo_contest' THEN CASE WHEN lower(string_agg(g.title||' '||g.content::text,' ')) ~ 'liber[oaie]' THEN 'free' ELSE 'theme' END END,
  CASE p_type WHEN 'quiz_question' THEN 'Quiz del giorno' WHEN 'mission' THEN 'Missioni del giorno' WHEN 'bingo_item' THEN 'Bingo del viaggio'
    ELSE coalesce(nullif(min(g.title),''),min(g.content->>'title'),'Attività') END,
  CASE WHEN p_type IN('quiz_question','mission','bingo_item') THEN '' ELSE coalesce(min(g.content->>'description'),min(g.content->>'instructions'),'') END,
  min(g.sort_order),CASE WHEN bool_and(g.status='approved') THEN 'approved' WHEN bool_and(g.status='archived') THEN 'archived' ELSE 'draft' END,
  CASE WHEN bool_and(g.source='ai') THEN 'ai' WHEN bool_or(g.source='import') THEN 'import' ELSE 'manual' END
 INTO v_activity_type,v_category,v_title,v_instructions,v_sort,v_status,v_source
 FROM public.generated_content g WHERE g.agency_id=p_agency AND g.template_version_id=p_version
  AND ((p_type IN('quiz_question','mission','bingo_item') AND g.content_type=p_type AND g.trip_day_id IS NOT DISTINCT FROM p_day)
    OR (p_type NOT IN('quiz_question','mission','bingo_item') AND g.id=p_legacy_id));
 INSERT INTO content.activities(id,agency_id,template_version_id,template_day_id,activity_type,contest_category,title,instructions,
  availability_rule,relative_days,unlock_local_time,max_score,max_entries,status,source,sort_order,config)
 VALUES(v_activity,p_agency,p_version,p_day,v_activity_type,v_category,v_title,v_instructions,
  CASE WHEN v_activity_type IN('quiz','mission') THEN 'relative_day_time' ELSE 'always' END,
  CASE v_activity_type WHEN 'quiz' THEN 0 WHEN 'mission' THEN -2 END,
  CASE WHEN v_activity_type IN('quiz','mission') THEN time '20:00' END,
  CASE v_activity_type WHEN 'quiz' THEN v_count WHEN 'mission' THEN v_count*10 WHEN 'word_game' THEN 10 WHEN 'order_game' THEN 10 WHEN 'puzzle' THEN 10 END,
  CASE WHEN v_activity_type='photo_contest' THEN 3 END,v_status,v_source,v_sort,jsonb_build_object('legacyGroupKey',v_group,'legacyItemCount',v_count))
 ON CONFLICT(id) DO UPDATE SET activity_type=EXCLUDED.activity_type,contest_category=EXCLUDED.contest_category,
  title=EXCLUDED.title,instructions=EXCLUDED.instructions,availability_rule=EXCLUDED.availability_rule,
  relative_days=EXCLUDED.relative_days,unlock_local_time=EXCLUDED.unlock_local_time,max_score=EXCLUDED.max_score,
  max_entries=EXCLUDED.max_entries,status=EXCLUDED.status,source=EXCLUDED.source,sort_order=EXCLUDED.sort_order,
  config=EXCLUDED.config,updated_at=clock_timestamp();
 UPDATE content.activity_items SET ordinal=ordinal+1000 WHERE activity_id=v_activity;
 INSERT INTO content.activity_items(id,agency_id,template_version_id,activity_id,ordinal,item_kind,prompt,payload,answer_spec,points,created_at)
 SELECT g.id,g.agency_id,g.template_version_id,v_activity,
  row_number() OVER(ORDER BY g.sort_order,g.id)::smallint,
  CASE g.content_type WHEN 'quiz_question' THEN 'question' WHEN 'mission' THEN 'mission' WHEN 'bingo_item' THEN 'bingo_cell'
   WHEN 'order_game' THEN 'order_step' WHEN 'puzzle' THEN 'puzzle_image' WHEN 'photo_contest' THEN 'contest_rule' ELSE 'word' END,
  CASE g.content_type WHEN 'quiz_question' THEN coalesce(g.content->>'question',g.title) ELSE coalesce(nullif(g.title,''),g.content->>'title','') END,
  CASE g.content_type WHEN 'quiz_question' THEN jsonb_build_object('options',coalesce(g.content->'options','[]'::jsonb),'explanation',coalesce(g.content->>'explanation',''))
   WHEN 'mission' THEN jsonb_build_object('description',coalesce(g.content->>'description','')) WHEN 'bingo_item' THEN jsonb_build_object('description',coalesce(g.content->>'description',''))
   WHEN 'photo_contest' THEN jsonb_build_object('description',coalesce(g.content->>'description','')) ELSE jsonb_build_object('type',coalesce(g.content->>'type',''),'instructions',coalesce(g.content->>'instructions','')) END,
  CASE g.content_type WHEN 'quiz_question' THEN jsonb_build_object('correctIndex',g.content->'correctIndex') WHEN 'mission' THEN jsonb_build_object('validation','photo')
   WHEN 'bingo_item' THEN jsonb_build_object('validation','photo') WHEN 'photo_contest' THEN '{}'::jsonb ELSE jsonb_build_object('answer',coalesce(g.content->>'answer','')) END,
  CASE g.content_type WHEN 'quiz_question' THEN 1 WHEN 'mission' THEN 10 WHEN 'word_game' THEN 10 WHEN 'order_game' THEN 10 WHEN 'puzzle' THEN 10 ELSE 0 END,g.created_at
 FROM public.generated_content g WHERE g.agency_id=p_agency AND g.template_version_id=p_version
  AND ((p_type IN('quiz_question','mission','bingo_item') AND g.content_type=p_type AND g.trip_day_id IS NOT DISTINCT FROM p_day)
    OR (p_type NOT IN('quiz_question','mission','bingo_item') AND g.id=p_legacy_id))
 ON CONFLICT(id) DO UPDATE SET activity_id=EXCLUDED.activity_id,ordinal=EXCLUDED.ordinal,item_kind=EXCLUDED.item_kind,
  prompt=EXCLUDED.prompt,payload=EXCLUDED.payload,answer_spec=EXCLUDED.answer_spec,points=EXCLUDED.points;
 DELETE FROM content.activity_items i WHERE i.activity_id=v_activity AND NOT EXISTS(SELECT 1 FROM public.generated_content g WHERE g.id=i.id);
 INSERT INTO ops.legacy_generated_content_map(legacy_generated_content_id,agency_id,template_version_id,activity_id,activity_item_id)
 SELECT g.id,g.agency_id,g.template_version_id,v_activity,g.id FROM public.generated_content g
 WHERE g.agency_id=p_agency AND g.template_version_id=p_version
  AND ((p_type IN('quiz_question','mission','bingo_item') AND g.content_type=p_type AND g.trip_day_id IS NOT DISTINCT FROM p_day)
    OR (p_type NOT IN('quiz_question','mission','bingo_item') AND g.id=p_legacy_id))
 ON CONFLICT(legacy_generated_content_id) DO UPDATE SET activity_id=EXCLUDED.activity_id,activity_item_id=EXCLUDED.activity_item_id;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_generated_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP IN('UPDATE','DELETE') THEN PERFORM app.refresh_legacy_generated_activity(OLD.agency_id,OLD.template_version_id,OLD.trip_day_id,OLD.content_type,OLD.id); END IF;
 IF TG_OP IN('INSERT','UPDATE') THEN PERFORM app.refresh_legacy_generated_activity(NEW.agency_id,NEW.template_version_id,NEW.trip_day_id,NEW.content_type,NEW.id); END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS sync_v3_useful_information ON public.useful_information;
CREATE TRIGGER sync_v3_useful_information AFTER INSERT OR UPDATE OR DELETE ON public.useful_information FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_useful_information();
DROP TRIGGER IF EXISTS sync_v3_phrasebook_entry ON public.phrasebook_entries;
CREATE TRIGGER sync_v3_phrasebook_entry AFTER INSERT OR UPDATE OR DELETE ON public.phrasebook_entries FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_phrasebook_entry();
DROP TRIGGER IF EXISTS sync_v3_generated_content ON public.generated_content;
CREATE TRIGGER sync_v3_generated_content AFTER INSERT OR UPDATE OR DELETE ON public.generated_content FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_generated_content();

REVOKE ALL ON FUNCTION app.sync_legacy_useful_information() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_phrasebook_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.refresh_legacy_generated_activity(UUID,UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_generated_content() FROM PUBLIC;
GRANT USAGE ON SCHEMA content,travel TO smf_app;
GRANT SELECT ON travel.template_useful_information,travel.template_phrasebook_entries,content.activities,content.activity_items TO smf_app;
REVOKE SELECT ON ops.legacy_id_map,ops.legacy_generated_content_map FROM smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('029_v3_content_localization_runtime') ON CONFLICT(version) DO NOTHING;
