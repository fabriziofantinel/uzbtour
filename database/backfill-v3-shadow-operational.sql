-- SMF Travel v3 - shadow backfill for content, operations and journey facts.
-- Re-runnable and non-destructive: public remains authoritative until cutover.

CREATE TABLE IF NOT EXISTS travel.template_useful_information (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  source_reference_content_id UUID REFERENCES ref.reference_contents(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (btrim(category) <> ''),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  body TEXT NOT NULL,
  phone TEXT,
  url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  source VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','ai')),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_version_id)
    REFERENCES travel.trip_template_versions(agency_id, id) ON DELETE CASCADE,
  UNIQUE (agency_id, template_version_id, id),
  UNIQUE (template_version_id, sort_order, id)
);
CREATE INDEX IF NOT EXISTS template_useful_information_tenant_idx
  ON travel.template_useful_information
  (agency_id, template_version_id, sort_order, id);

CREATE TABLE IF NOT EXISTS travel.template_phrasebook_entries (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  source_reference_content_id UUID REFERENCES ref.reference_contents(id) ON DELETE SET NULL,
  locale app.locale_code NOT NULL DEFAULT 'it-IT',
  language_code VARCHAR(12) NOT NULL CHECK (btrim(language_code) <> ''),
  category TEXT NOT NULL DEFAULT 'general',
  term TEXT NOT NULL CHECK (btrim(term) <> ''),
  pronunciation TEXT NOT NULL DEFAULT '',
  translation TEXT NOT NULL CHECK (btrim(translation) <> ''),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  source VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','ai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_version_id)
    REFERENCES travel.trip_template_versions(agency_id, id) ON DELETE CASCADE,
  UNIQUE (agency_id, template_version_id, id)
);
CREATE INDEX IF NOT EXISTS template_phrasebook_entries_tenant_idx
  ON travel.template_phrasebook_entries
  (agency_id, template_version_id, locale, sort_order, language_code, id);

CREATE TABLE IF NOT EXISTS ops.legacy_generated_content_map (
  legacy_generated_content_id UUID PRIMARY KEY,
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  activity_item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agency_id, template_version_id, activity_id)
    REFERENCES content.activities(agency_id, template_version_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_version_id, activity_id, activity_item_id)
    REFERENCES content.activity_items(agency_id, template_version_id, activity_id, id) ON DELETE CASCADE,
  UNIQUE (agency_id, legacy_generated_content_id),
  UNIQUE (agency_id, activity_item_id)
);
CREATE INDEX IF NOT EXISTS legacy_generated_content_map_tenant_idx
  ON ops.legacy_generated_content_map
  (agency_id, template_version_id, activity_id, legacy_generated_content_id);

ALTER TABLE travel.template_useful_information ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel.template_phrasebook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.legacy_generated_content_map ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE q RECORD;
BEGIN
  FOR q IN
    SELECT * FROM (VALUES
      ('travel','template_useful_information'),
      ('travel','template_phrasebook_entries'),
      ('ops','legacy_generated_content_map')
    ) AS x(schema_name, table_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = q.schema_name AND p.tablename = q.table_name
        AND p.policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I.%I USING (agency_id = app.current_agency_id()) WITH CHECK (agency_id = app.current_agency_id())',
        q.schema_name, q.table_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'travel.template_useful_information'::regclass
      AND tgname = 'guard_template_version_mutation' AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER guard_template_version_mutation
      BEFORE INSERT OR UPDATE OR DELETE ON travel.template_useful_information
      FOR EACH ROW EXECUTE FUNCTION app.assert_template_version_mutable();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'travel.template_phrasebook_entries'::regclass
      AND tgname = 'guard_template_version_mutation' AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER guard_template_version_mutation
      BEFORE INSERT OR UPDATE OR DELETE ON travel.template_phrasebook_entries
      FOR EACH ROW EXECUTE FUNCTION app.assert_template_version_mutable();
  END IF;
END $$;

-- Hotel stays are first-class feedback targets, not synthetic itinerary items.
ALTER TABLE journey.programme_feedback
  ADD COLUMN IF NOT EXISTS departure_day_id UUID,
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS hotel_id UUID;
ALTER TABLE journey.programme_feedback ALTER COLUMN departure_item_id DROP NOT NULL;
UPDATE journey.programme_feedback SET target_type = 'itinerary_item' WHERE target_type IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM journey.programme_feedback) AND EXISTS (
    SELECT 1 FROM journey.programme_feedback WHERE departure_day_id IS NULL
  ) THEN
    RAISE EXCEPTION 'programme_feedback requires departure_day_id before v3.3 migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'journey.programme_feedback'::regclass
      AND conname = 'programme_feedback_target_shape_check'
  ) THEN
    ALTER TABLE journey.programme_feedback
      ADD CONSTRAINT programme_feedback_target_shape_check CHECK (
        (target_type = 'itinerary_item' AND departure_item_id IS NOT NULL AND hotel_id IS NULL)
        OR (target_type = 'hotel' AND departure_item_id IS NULL AND hotel_id IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'journey.programme_feedback'::regclass
      AND conname = 'programme_feedback_departure_day_fk'
  ) THEN
    ALTER TABLE journey.programme_feedback
      ADD CONSTRAINT programme_feedback_departure_day_fk
      FOREIGN KEY (agency_id, departure_id, departure_day_id)
      REFERENCES travel.departure_days(agency_id, departure_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'journey.programme_feedback'::regclass
      AND conname = 'programme_feedback_hotel_fk'
  ) THEN
    ALTER TABLE journey.programme_feedback
      ADD CONSTRAINT programme_feedback_hotel_fk
      FOREIGN KEY (hotel_id) REFERENCES ref.hotels(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE journey.programme_feedback ALTER COLUMN target_type SET NOT NULL;
ALTER TABLE journey.programme_feedback ALTER COLUMN departure_day_id SET NOT NULL;
ALTER TABLE journey.programme_feedback
  DROP CONSTRAINT IF EXISTS programme_feedback_party_id_traveler_id_departure_item_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS programme_feedback_item_uidx
  ON journey.programme_feedback (party_id, traveler_id, departure_item_id)
  WHERE target_type = 'itinerary_item';
CREATE UNIQUE INDEX IF NOT EXISTS programme_feedback_hotel_uidx
  ON journey.programme_feedback (party_id, traveler_id, departure_day_id, hotel_id)
  WHERE target_type = 'hotel';

-- Published legacy versions require an owner-only historical load window.
ALTER TABLE travel.template_useful_information DISABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_phrasebook_entries DISABLE TRIGGER guard_template_version_mutation;
ALTER TABLE content.activities DISABLE TRIGGER guard_template_version_mutation;
ALTER TABLE content.activity_items DISABLE TRIGGER guard_template_version_mutation;

INSERT INTO travel.template_useful_information
  (id, agency_id, template_version_id, category, title, body, phone, url,
   sort_order, source, metadata)
SELECT id, agency_id, template_version_id, category, title, body, phone, url,
       sort_order,
       CASE WHEN metadata->>'source' IN ('manual','import','ai')
            THEN metadata->>'source' ELSE 'import' END,
       metadata
FROM public.useful_information
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category, title = EXCLUDED.title, body = EXCLUDED.body,
  phone = EXCLUDED.phone, url = EXCLUDED.url, sort_order = EXCLUDED.sort_order,
  source = EXCLUDED.source, metadata = EXCLUDED.metadata, updated_at = now();

INSERT INTO travel.template_phrasebook_entries
  (id, agency_id, template_version_id, locale, language_code, category, term,
   pronunciation, translation, sort_order, source)
SELECT p.id, p.agency_id, p.template_version_id,
       coalesce(t.default_locale, 'it-IT'), p.language_code, p.category, p.term,
       p.pronunciation, p.translation, p.sort_order, p.source
FROM public.phrasebook_entries p
JOIN public.trip_template_versions v ON v.id = p.template_version_id
JOIN public.trip_templates t ON t.id = v.template_id
ON CONFLICT (id) DO UPDATE SET
  locale = EXCLUDED.locale, language_code = EXCLUDED.language_code,
  category = EXCLUDED.category, term = EXCLUDED.term,
  pronunciation = EXCLUDED.pronunciation, translation = EXCLUDED.translation,
  sort_order = EXCLUDED.sort_order, source = EXCLUDED.source, updated_at = now();

CREATE TEMP TABLE tmp_activity_group_source ON COMMIT DROP AS
SELECT g.agency_id, g.template_version_id, g.trip_day_id AS template_day_id,
       'group:' || g.template_version_id::text || ':' || coalesce(g.trip_day_id::text, 'trip') || ':' || g.content_type AS group_key,
       CASE g.content_type WHEN 'quiz_question' THEN 'quiz'
                           WHEN 'mission' THEN 'mission'
                           ELSE 'bingo' END AS activity_type,
       NULL::text AS contest_category,
       CASE g.content_type WHEN 'quiz_question' THEN 'Quiz del giorno'
                           WHEN 'mission' THEN 'Missioni del giorno'
                           ELSE 'Bingo del viaggio' END AS title,
       ''::text AS instructions,
       min(g.sort_order) AS sort_order,
       count(*)::int AS item_count,
       CASE WHEN bool_and(g.status = 'approved') THEN 'approved'
            WHEN bool_and(g.status = 'archived') THEN 'archived' ELSE 'draft' END AS status,
       CASE WHEN bool_and(g.source = 'ai') THEN 'ai'
            WHEN bool_or(g.source = 'import') THEN 'import' ELSE 'manual' END AS source
FROM public.generated_content g
WHERE g.content_type IN ('quiz_question','mission','bingo_item')
GROUP BY g.agency_id, g.template_version_id, g.trip_day_id, g.content_type
UNION ALL
SELECT g.agency_id, g.template_version_id, g.trip_day_id,
       'item:' || g.id::text,
       CASE WHEN g.content_type = 'order_game' THEN 'order_game'
            WHEN g.content_type = 'word_game' AND g.content->>'type' = 'rebus' THEN 'puzzle'
            WHEN g.content_type = 'word_game' THEN 'word_game'
            ELSE 'photo_contest' END,
       CASE WHEN g.content_type = 'photo_contest' THEN
         CASE WHEN lower(g.title || ' ' || g.content::text) ~ 'liber[oaie]'
              THEN 'free' ELSE 'theme' END
       END,
       coalesce(nullif(g.title, ''), g.content->>'title', 'Attività'),
       coalesce(g.content->>'description', g.content->>'instructions', ''),
       g.sort_order, 1, g.status, g.source
FROM public.generated_content g
WHERE g.content_type IN ('word_game','order_game','photo_contest');

INSERT INTO ops.legacy_id_map (source_system, entity_type, legacy_id, agency_id)
SELECT 'public-v2', 'content_activity', group_key, agency_id
FROM tmp_activity_group_source
ON CONFLICT (source_system, entity_type, legacy_id) DO NOTHING;

CREATE TEMP TABLE tmp_activity_groups ON COMMIT DROP AS
SELECT s.*, m.target_id AS activity_id
FROM tmp_activity_group_source s
JOIN ops.legacy_id_map m
  ON m.source_system = 'public-v2' AND m.entity_type = 'content_activity'
 AND m.legacy_id = s.group_key;

INSERT INTO content.activities
  (id, agency_id, template_version_id, template_day_id, activity_type,
   contest_category, title, instructions, availability_rule, relative_days,
   unlock_local_time, max_score, max_entries, status, source, sort_order, config)
SELECT activity_id, agency_id, template_version_id, template_day_id,
       activity_type, contest_category, title, instructions,
       CASE WHEN activity_type IN ('quiz','mission') THEN 'relative_day_time' ELSE 'always' END,
       CASE activity_type WHEN 'quiz' THEN 0 WHEN 'mission' THEN -2 END,
       CASE WHEN activity_type IN ('quiz','mission') THEN time '20:00' END,
       CASE activity_type WHEN 'quiz' THEN item_count
                          WHEN 'mission' THEN item_count * 10
                          WHEN 'word_game' THEN 10
                          WHEN 'order_game' THEN 10
                          WHEN 'puzzle' THEN 10 END,
       CASE WHEN activity_type = 'photo_contest' THEN 3 END,
       status, source, sort_order,
       jsonb_build_object('legacyGroupKey', group_key, 'legacyItemCount', item_count)
FROM tmp_activity_groups
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, instructions = EXCLUDED.instructions,
  availability_rule = EXCLUDED.availability_rule,
  relative_days = EXCLUDED.relative_days,
  unlock_local_time = EXCLUDED.unlock_local_time,
  max_score = EXCLUDED.max_score, max_entries = EXCLUDED.max_entries,
  status = EXCLUDED.status, source = EXCLUDED.source,
  sort_order = EXCLUDED.sort_order, config = EXCLUDED.config;

CREATE TEMP TABLE tmp_generated_item_map ON COMMIT DROP AS
SELECT g.*, a.activity_id,
       row_number() OVER (PARTITION BY a.activity_id ORDER BY g.sort_order, g.id)::smallint AS ordinal
FROM public.generated_content g
JOIN tmp_activity_groups a ON a.agency_id = g.agency_id
 AND a.template_version_id = g.template_version_id
 AND (
   (g.content_type IN ('quiz_question','mission','bingo_item')
    AND a.group_key = 'group:' || g.template_version_id::text || ':' || coalesce(g.trip_day_id::text, 'trip') || ':' || g.content_type)
   OR
   (g.content_type IN ('word_game','order_game','photo_contest')
    AND a.group_key = 'item:' || g.id::text)
 );

INSERT INTO content.activity_items
  (id, agency_id, template_version_id, activity_id, ordinal, item_kind,
   prompt, payload, answer_spec, points, created_at)
SELECT g.id, g.agency_id, g.template_version_id, g.activity_id, g.ordinal,
       CASE g.content_type WHEN 'quiz_question' THEN 'question'
                           WHEN 'mission' THEN 'mission'
                           WHEN 'bingo_item' THEN 'bingo_cell'
                           WHEN 'order_game' THEN 'order_step'
                           WHEN 'photo_contest' THEN 'contest_rule'
                           ELSE 'word' END,
       CASE g.content_type WHEN 'quiz_question' THEN coalesce(g.content->>'question', g.title)
                           ELSE coalesce(nullif(g.title, ''), g.content->>'title', '') END,
       CASE g.content_type
         WHEN 'quiz_question' THEN jsonb_build_object(
           'options', coalesce(g.content->'options', '[]'::jsonb),
           'explanation', coalesce(g.content->>'explanation', ''))
         WHEN 'mission' THEN jsonb_build_object('description', coalesce(g.content->>'description', ''))
         WHEN 'bingo_item' THEN jsonb_build_object('description', coalesce(g.content->>'description', ''))
         WHEN 'photo_contest' THEN jsonb_build_object('description', coalesce(g.content->>'description', ''))
         ELSE jsonb_build_object('type', coalesce(g.content->>'type', ''),
                                 'instructions', coalesce(g.content->>'instructions', ''))
       END,
       CASE g.content_type
         WHEN 'quiz_question' THEN jsonb_build_object('correctIndex', g.content->'correctIndex')
         WHEN 'mission' THEN jsonb_build_object('validation', 'photo')
         WHEN 'bingo_item' THEN jsonb_build_object('validation', 'photo')
         WHEN 'photo_contest' THEN '{}'::jsonb
         ELSE jsonb_build_object('answer', coalesce(g.content->>'answer', ''))
       END,
       CASE g.content_type WHEN 'quiz_question' THEN 1 WHEN 'mission' THEN 10
                           WHEN 'word_game' THEN 10 WHEN 'order_game' THEN 10 ELSE 0 END,
       g.created_at
FROM tmp_generated_item_map g
ON CONFLICT (id) DO UPDATE SET
  activity_id = EXCLUDED.activity_id, ordinal = EXCLUDED.ordinal,
  item_kind = EXCLUDED.item_kind, prompt = EXCLUDED.prompt,
  payload = EXCLUDED.payload, answer_spec = EXCLUDED.answer_spec,
  points = EXCLUDED.points;

INSERT INTO ops.legacy_generated_content_map
  (legacy_generated_content_id, agency_id, template_version_id, activity_id, activity_item_id)
SELECT id, agency_id, template_version_id, activity_id, id
FROM tmp_generated_item_map
ON CONFLICT (legacy_generated_content_id) DO UPDATE SET
  activity_id = EXCLUDED.activity_id, activity_item_id = EXCLUDED.activity_item_id;

INSERT INTO ops.media_assets
  (id, agency_id, departure_id, party_id, uploaded_by_user_id, provider, bucket,
   object_key, original_name, content_type, size_bytes, checksum_sha256, purpose,
   visibility, status, metadata, created_at, updated_at, deleted_at)
SELECT a.id, a.agency_id, a.departure_id, a.party_id, um.target_id,
       CASE WHEN a.provider IN ('r2','s3') THEN a.provider ELSE 'r2' END,
       a.bucket, a.object_key, a.original_name, a.content_type, a.size_bytes,
       a.checksum_sha256,
       CASE a.purpose
         WHEN 'travel_programme' THEN 'source_document'
         WHEN 'travel_programme_normalized' THEN 'normalized_document'
         WHEN 'ticket' THEN 'ticket'
         WHEN 'voucher' THEN 'voucher'
         WHEN 'photo' THEN 'memory'
         WHEN 'memory' THEN 'memory'
         WHEN 'challenge' THEN 'challenge_evidence'
         WHEN 'challenge_evidence' THEN 'challenge_evidence'
         WHEN 'contest' THEN 'contest_entry'
         WHEN 'contest_entry' THEN 'contest_entry'
         ELSE 'other'
       END,
       a.visibility, a.status,
       a.metadata || jsonb_build_object('legacyPurpose', a.purpose, 'legacyProvider', a.provider),
       a.created_at, a.updated_at,
       CASE WHEN a.status = 'deleted' THEN a.updated_at END
FROM public.media_assets a
LEFT JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = a.uploaded_by_user_id
ON CONFLICT (id) DO UPDATE SET
  departure_id = EXCLUDED.departure_id, party_id = EXCLUDED.party_id,
  uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
  provider = EXCLUDED.provider, bucket = EXCLUDED.bucket,
  object_key = EXCLUDED.object_key, original_name = EXCLUDED.original_name,
  content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes,
  checksum_sha256 = EXCLUDED.checksum_sha256, purpose = EXCLUDED.purpose,
  visibility = EXCLUDED.visibility, status = EXCLUDED.status,
  metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at;

INSERT INTO ops.travel_documents
  (id, agency_id, template_id, departure_id, media_asset_id, document_type,
   title, status, created_at)
SELECT d.id, d.agency_id, d.template_id, d.departure_id, d.media_asset_id,
       CASE d.document_type
         WHEN 'programme' THEN 'accepted_quote'
         WHEN 'normalized_programme' THEN 'normalized_programme'
         WHEN 'ticket' THEN 'ticket'
         WHEN 'voucher' THEN 'voucher'
         WHEN 'insurance' THEN 'insurance'
         ELSE 'other'
       END,
       d.title, d.status, d.created_at
FROM public.travel_documents d
ON CONFLICT (id) DO UPDATE SET
  document_type = EXCLUDED.document_type, title = EXCLUDED.title,
  status = EXCLUDED.status;

INSERT INTO ops.travel_documents
  (id, agency_id, departure_id, departure_item_id, media_asset_id,
   document_type, title, status, created_at)
SELECT d.id, d.agency_id, d.departure_id, item_map.target_id, d.media_asset_id,
       CASE d.document_type WHEN 'ticket' THEN 'ticket' WHEN 'voucher' THEN 'voucher' ELSE 'other' END,
       d.title, 'ready', d.created_at
FROM public.itinerary_item_documents d
JOIN ops.legacy_id_map item_map
  ON item_map.source_system = 'public-v2' AND item_map.entity_type = 'departure_item'
 AND item_map.legacy_id = d.departure_id::text || ':' || d.itinerary_item_id::text
ON CONFLICT (id) DO UPDATE SET
  departure_item_id = EXCLUDED.departure_item_id,
  document_type = EXCLUDED.document_type, title = EXCLUDED.title,
  status = EXCLUDED.status;

INSERT INTO ops.import_jobs
  (id, agency_id, template_id, source_document_id, normalized_document_id,
   status, extraction_provider, attempt_count, result, error_message,
   started_at, completed_at, created_by_user_id, created_at, updated_at)
SELECT i.id, i.agency_id, i.template_id, i.document_id, i.normalized_document_id,
       i.status, i.extraction_provider, i.attempt_count,
       coalesce(i.result, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
         'legacyAiProvider', i.ai_provider
       )),
       i.error_message, i.started_at, i.completed_at, um.target_id,
       i.created_at, i.updated_at
FROM public.import_jobs i
LEFT JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = i.created_by_user_id
ON CONFLICT (id) DO UPDATE SET
  normalized_document_id = EXCLUDED.normalized_document_id,
  status = EXCLUDED.status, extraction_provider = EXCLUDED.extraction_provider,
  attempt_count = EXCLUDED.attempt_count, result = EXCLUDED.result,
  error_message = EXCLUDED.error_message, started_at = EXCLUDED.started_at,
  completed_at = EXCLUDED.completed_at,
  created_by_user_id = EXCLUDED.created_by_user_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO ops.platform_jobs
  (id, agency_id, import_job_id, job_type, provider, status, payload,
   external_id, idempotency_key, attempt_count, available_at, locked_at,
   completed_at, error_message, created_at, updated_at)
SELECT j.id, j.agency_id,
       CASE WHEN j.payload->>'importId' ~* '^[0-9a-f-]{36}$'
            THEN i.id END,
       j.job_type, j.provider, j.status, j.payload, j.external_id,
       j.idempotency_key, j.attempt_count, j.available_at, j.locked_at,
       j.completed_at, j.error_message, j.created_at, j.updated_at
FROM public.platform_jobs j
LEFT JOIN public.import_jobs i
  ON i.agency_id = j.agency_id
 AND i.id::text = CASE WHEN j.payload->>'importId' ~* '^[0-9a-f-]{36}$'
                       THEN j.payload->>'importId' END
ON CONFLICT (id) DO UPDATE SET
  import_job_id = EXCLUDED.import_job_id, job_type = EXCLUDED.job_type,
  provider = EXCLUDED.provider, status = EXCLUDED.status,
  payload = EXCLUDED.payload, external_id = EXCLUDED.external_id,
  idempotency_key = EXCLUDED.idempotency_key,
  attempt_count = EXCLUDED.attempt_count, available_at = EXCLUDED.available_at,
  locked_at = EXCLUDED.locked_at, completed_at = EXCLUDED.completed_at,
  error_message = EXCLUDED.error_message, updated_at = EXCLUDED.updated_at;

INSERT INTO ops.audit_events
  (id, agency_id, actor_user_id, entity_type, entity_id, action, changes,
   request_id, created_at)
OVERRIDING SYSTEM VALUE
SELECT e.id, e.agency_id, um.target_id, e.entity_type, e.entity_id, e.action,
       e.changes || jsonb_strip_nulls(jsonb_build_object(
         'legacyDepartureId', e.departure_id,
         'legacyPartyId', e.party_id
       )),
       e.request_id, e.created_at
FROM public.audit_events e
LEFT JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = e.actor_user_id
ON CONFLICT (id) DO UPDATE SET
  agency_id = EXCLUDED.agency_id, actor_user_id = EXCLUDED.actor_user_id,
  entity_type = EXCLUDED.entity_type, entity_id = EXCLUDED.entity_id,
  action = EXCLUDED.action, changes = EXCLUDED.changes,
  request_id = EXCLUDED.request_id, created_at = EXCLUDED.created_at;

SELECT setval(
  pg_get_serial_sequence('ops.audit_events', 'id'),
  greatest(coalesce((SELECT max(id) FROM ops.audit_events), 1), 1),
  EXISTS (SELECT 1 FROM ops.audit_events)
);

INSERT INTO journey.expenses
  (id, agency_id, departure_id, party_id, departure_day_id, label,
   amount_minor, currency, base_currency, exchange_rate_to_base,
   base_amount_minor, paid_by_traveler_id, paid_by_name, allocation_method,
   allocation_status, client_operation_id, created_at, updated_at)
SELECT e.id, e.agency_id, e.departure_id, e.party_id, dd.id, e.label,
       round(e.amount * power(10::numeric, c.minor_unit))::bigint,
       e.currency, e.base_currency,
       CASE
         WHEN e.currency = e.base_currency THEN 1
         WHEN e.exchange_rate_to_base IS NOT NULL THEN e.exchange_rate_to_base
         WHEN e.base_amount IS NOT NULL THEN e.base_amount / e.amount
         ELSE historical_rate.exchange_rate_to_base
       END,
       round((CASE
         WHEN e.currency = e.base_currency THEN e.amount
         WHEN e.base_amount IS NOT NULL THEN e.base_amount
         ELSE e.amount * coalesce(e.exchange_rate_to_base, historical_rate.exchange_rate_to_base)
       END) * power(10::numeric, bc.minor_unit))::bigint,
       payer.id, e.paid_by_name, 'whole_party', 'draft',
       coalesce(e.client_operation_id, e.id), e.created_at, e.updated_at
FROM public.party_expenses e
JOIN ref.currencies c ON c.code = e.currency
JOIN ref.currencies bc ON bc.code = e.base_currency
LEFT JOIN travel.traveler_profiles payer
  ON payer.agency_id = e.agency_id AND payer.user_id = (
    SELECT m.target_id FROM ops.legacy_id_map m
    WHERE m.source_system = 'public-v2' AND m.entity_type = 'user'
      AND m.legacy_id = e.paid_by_user_id
  )
LEFT JOIN travel.departure_days dd
  ON dd.departure_id = e.departure_id AND dd.template_day_id = e.trip_day_id
LEFT JOIN LATERAL (
  SELECT movement.euro_amount / movement.local_amount AS exchange_rate_to_base
    FROM public.party_cash_movements movement
   WHERE movement.party_id = e.party_id
     AND movement.local_currency = e.currency
     AND e.base_currency = 'EUR'
     AND movement.euro_amount > 0
     AND movement.local_amount > 0
   ORDER BY abs(extract(epoch FROM (movement.created_at - e.created_at))), movement.id
   LIMIT 1
) historical_rate ON true
ON CONFLICT (id) DO UPDATE SET
  departure_day_id = EXCLUDED.departure_day_id, label = EXCLUDED.label,
  amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
  base_currency = EXCLUDED.base_currency,
  exchange_rate_to_base = EXCLUDED.exchange_rate_to_base,
  base_amount_minor = EXCLUDED.base_amount_minor,
  paid_by_traveler_id = EXCLUDED.paid_by_traveler_id,
  paid_by_name = EXCLUDED.paid_by_name, updated_at = EXCLUDED.updated_at;

INSERT INTO journey.cash_movements
  (id, agency_id, departure_id, party_id, departure_day_id, kind,
   source_amount_minor, source_currency, target_amount_minor, target_currency,
   applied_rate, added_by_traveler_id, client_operation_id, created_at)
SELECT c.id, c.agency_id, p.departure_id, c.party_id, dd.id, c.kind,
       CASE WHEN c.euro_amount IS NOT NULL THEN round(c.euro_amount * 100)::bigint END,
       'EUR', round(c.local_amount * power(10::numeric, currency.minor_unit))::bigint,
       c.local_currency,
       CASE WHEN c.euro_amount IS NOT NULL THEN c.local_amount / c.euro_amount END,
       actor.id, coalesce(c.client_operation_id, c.id), c.created_at
FROM public.party_cash_movements c
JOIN travel.travel_parties p ON p.id = c.party_id AND p.agency_id = c.agency_id
JOIN ref.currencies currency ON currency.code = c.local_currency
JOIN travel.departure_days dd
  ON dd.departure_id = p.departure_id AND dd.template_day_id = c.trip_day_id
JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = c.added_by_user_id
JOIN travel.traveler_profiles actor
  ON actor.agency_id = c.agency_id AND actor.user_id = um.target_id
ON CONFLICT (id) DO UPDATE SET
  departure_day_id = EXCLUDED.departure_day_id, kind = EXCLUDED.kind,
  source_amount_minor = EXCLUDED.source_amount_minor,
  source_currency = EXCLUDED.source_currency,
  target_amount_minor = EXCLUDED.target_amount_minor,
  target_currency = EXCLUDED.target_currency,
  applied_rate = EXCLUDED.applied_rate,
  added_by_traveler_id = EXCLUDED.added_by_traveler_id;

INSERT INTO journey.day_notes
  (id, agency_id, departure_id, party_id, departure_day_id, note_text,
   updated_by_traveler_id, client_operation_id, created_at, updated_at)
SELECT n.id, n.agency_id, p.departure_id, n.party_id, dd.id, n.text,
       actor.id, n.id, n.created_at, n.updated_at
FROM public.party_day_notes n
JOIN travel.travel_parties p ON p.id = n.party_id AND p.agency_id = n.agency_id
JOIN travel.departure_days dd
  ON dd.departure_id = p.departure_id AND dd.template_day_id = n.trip_day_id
JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = n.updated_by_user_id
JOIN travel.traveler_profiles actor
  ON actor.agency_id = n.agency_id AND actor.user_id = um.target_id
ON CONFLICT (id) DO UPDATE SET
  note_text = EXCLUDED.note_text,
  updated_by_traveler_id = EXCLUDED.updated_by_traveler_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO journey.restaurant_visits
  (id, agency_id, departure_id, party_id, departure_day_id, name,
   added_by_traveler_id, client_operation_id, created_at)
SELECT r.id, r.agency_id, p.departure_id, r.party_id, dd.id, r.name,
       actor.id, r.id, r.created_at
FROM public.party_restaurants r
JOIN travel.travel_parties p ON p.id = r.party_id AND p.agency_id = r.agency_id
JOIN travel.departure_days dd
  ON dd.departure_id = p.departure_id AND dd.template_day_id = r.trip_day_id
JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = r.added_by_user_id
JOIN travel.traveler_profiles actor
  ON actor.agency_id = r.agency_id AND actor.user_id = um.target_id
ON CONFLICT (id) DO UPDATE SET
  departure_day_id = EXCLUDED.departure_day_id, name = EXCLUDED.name,
  added_by_traveler_id = EXCLUDED.added_by_traveler_id;

INSERT INTO journey.memories
  (id, agency_id, departure_id, party_id, departure_day_id, media_asset_id,
   created_by_traveler_id, caption, comment, client_operation_id,
   created_at, updated_at)
SELECT m.id, m.agency_id, p.departure_id, m.party_id, dd.id, m.media_asset_id,
       actor.id, m.caption, m.comment, m.id, m.created_at, m.updated_at
FROM public.party_memories m
JOIN travel.travel_parties p ON p.id = m.party_id AND p.agency_id = m.agency_id
JOIN travel.departure_days dd
  ON dd.departure_id = p.departure_id AND dd.template_day_id = m.trip_day_id
JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = m.created_by_user_id
JOIN travel.traveler_profiles actor
  ON actor.agency_id = m.agency_id AND actor.user_id = um.target_id
ON CONFLICT (id) DO UPDATE SET
  departure_day_id = EXCLUDED.departure_day_id,
  media_asset_id = EXCLUDED.media_asset_id,
  created_by_traveler_id = EXCLUDED.created_by_traveler_id,
  caption = EXCLUDED.caption, comment = EXCLUDED.comment,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE journey.activity_attempts DISABLE TRIGGER activity_attempt_access_gate;

CREATE TEMP TABLE tmp_attempt_groups ON COMMIT DROP AS
SELECT r.agency_id, p.departure_id, d.template_version_id, r.party_id,
       r.traveler_id, dd.id AS departure_day_id, gm.activity_id,
       sum(r.score) AS score, sum(r.max_score) AS max_score,
       CASE WHEN bool_and(r.status = 'approved') THEN 'approved'
            WHEN bool_or(r.status = 'rejected') THEN 'rejected'
            WHEN bool_and(r.status = 'draft') THEN 'draft' ELSE 'submitted' END AS status,
       jsonb_object_agg(r.generated_content_id::text, r.result) AS answers,
       min(r.submitted_at) AS submitted_at, max(r.updated_at) AS updated_at,
       min(vm.target_id::text)::uuid AS validated_by_user_id,
       r.party_id::text || ':' || r.traveler_id::text || ':' || gm.activity_id::text AS group_key
FROM public.party_activity_results r
JOIN travel.travel_parties p ON p.id = r.party_id AND p.agency_id = r.agency_id
JOIN travel.departures d ON d.id = p.departure_id
JOIN ops.legacy_generated_content_map gm
  ON gm.legacy_generated_content_id = r.generated_content_id
LEFT JOIN travel.departure_days dd
  ON dd.departure_id = p.departure_id AND dd.template_day_id = r.trip_day_id
LEFT JOIN ops.legacy_id_map vm
  ON vm.source_system = 'public-v2' AND vm.entity_type = 'user'
 AND vm.legacy_id = r.validated_by_user_id
GROUP BY r.agency_id, p.departure_id, d.template_version_id, r.party_id,
         r.traveler_id, dd.id, gm.activity_id;

INSERT INTO ops.legacy_id_map (source_system, entity_type, legacy_id, agency_id)
SELECT 'public-v2', 'activity_attempt', group_key, agency_id FROM tmp_attempt_groups
ON CONFLICT (source_system, entity_type, legacy_id) DO NOTHING;

INSERT INTO journey.activity_attempts
  (id, agency_id, departure_id, template_version_id, party_id, traveler_id,
   departure_day_id, activity_id, score, max_score, status, answers,
   validated_by_user_id, client_operation_id, client_answered_at,
   server_received_at, submitted_at, updated_at)
SELECT im.target_id, g.agency_id, g.departure_id, g.template_version_id,
       g.party_id, g.traveler_id, g.departure_day_id, g.activity_id,
       g.score, g.max_score, g.status, g.answers, g.validated_by_user_id,
       im.target_id,
       CASE WHEN g.status <> 'draft' THEN g.submitted_at END,
       CASE WHEN g.status <> 'draft' THEN g.submitted_at END,
       CASE WHEN g.status <> 'draft' THEN g.submitted_at END,
       g.updated_at
FROM tmp_attempt_groups g
JOIN ops.legacy_id_map im
  ON im.source_system = 'public-v2' AND im.entity_type = 'activity_attempt'
 AND im.legacy_id = g.group_key
ON CONFLICT (id) DO UPDATE SET
  score = EXCLUDED.score, max_score = EXCLUDED.max_score,
  status = EXCLUDED.status, answers = EXCLUDED.answers,
  validated_by_user_id = EXCLUDED.validated_by_user_id,
  client_answered_at = EXCLUDED.client_answered_at,
  server_received_at = EXCLUDED.server_received_at,
  submitted_at = EXCLUDED.submitted_at, updated_at = EXCLUDED.updated_at;

INSERT INTO journey.activity_evidence
  (agency_id, departure_id, party_id, attempt_id, activity_item_id,
   media_asset_id, created_at)
SELECT r.agency_id, p.departure_id, r.party_id, attempt_map.target_id,
       gm.activity_item_id, (r.result->>'mediaId')::uuid, r.submitted_at
FROM public.party_activity_results r
JOIN travel.travel_parties p ON p.id = r.party_id AND p.agency_id = r.agency_id
JOIN ops.legacy_generated_content_map gm
  ON gm.legacy_generated_content_id = r.generated_content_id
JOIN ops.legacy_id_map attempt_map
  ON attempt_map.source_system = 'public-v2' AND attempt_map.entity_type = 'activity_attempt'
 AND attempt_map.legacy_id = r.party_id::text || ':' || r.traveler_id::text || ':' || gm.activity_id::text
JOIN ops.media_assets media
  ON media.id = CASE WHEN r.result->>'mediaId' ~* '^[0-9a-f-]{36}$'
                     THEN (r.result->>'mediaId')::uuid END
WHERE r.result->>'mediaId' ~* '^[0-9a-f-]{36}$'
ON CONFLICT (attempt_id, media_asset_id) DO NOTHING;

INSERT INTO journey.photo_contest_entries
  (id, agency_id, departure_id, template_version_id, party_id, traveler_id,
   activity_id, media_asset_id, participant_slot, status, is_winner,
   client_operation_id, submitted_at)
SELECT e.id, e.agency_id, p.departure_id, d.template_version_id, e.party_id,
       e.traveler_id, gm.activity_id, e.media_asset_id, e.participant_slot,
       CASE WHEN e.is_winner THEN 'ranked' ELSE e.status END,
       e.is_winner, e.id, e.submitted_at
FROM public.party_photo_contest_entries e
JOIN travel.travel_parties p ON p.id = e.party_id AND p.agency_id = e.agency_id
JOIN travel.departures d ON d.id = p.departure_id
JOIN ops.legacy_generated_content_map gm
  ON gm.legacy_generated_content_id = e.generated_content_id
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status, is_winner = EXCLUDED.is_winner,
  media_asset_id = EXCLUDED.media_asset_id;

INSERT INTO ops.legacy_id_map (source_system, entity_type, legacy_id, agency_id)
SELECT 'public-v2', 'photo_judgement', e.id::text, e.agency_id
FROM public.party_photo_contest_entries e WHERE e.score IS NOT NULL
ON CONFLICT (source_system, entity_type, legacy_id) DO NOTHING;

INSERT INTO journey.photo_contest_judgements
  (id, agency_id, party_id, activity_id, entry_id, judge_type,
   judge_user_id, model, score, reason, judged_at)
SELECT jm.target_id, e.agency_id, e.party_id, gm.activity_id, e.id,
       CASE WHEN judge.target_id IS NOT NULL THEN 'human' ELSE 'ai' END,
       judge.target_id,
       CASE WHEN judge.target_id IS NULL THEN 'legacy-ai-evaluation' END,
       e.score, e.reason, coalesce(e.judged_at, e.submitted_at)
FROM public.party_photo_contest_entries e
JOIN ops.legacy_generated_content_map gm
  ON gm.legacy_generated_content_id = e.generated_content_id
JOIN ops.legacy_id_map jm
  ON jm.source_system = 'public-v2' AND jm.entity_type = 'photo_judgement'
 AND jm.legacy_id = e.id::text
LEFT JOIN ops.legacy_id_map judge
  ON judge.source_system = 'public-v2' AND judge.entity_type = 'user'
 AND judge.legacy_id = e.judged_by_user_id
WHERE e.score IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  judge_type = EXCLUDED.judge_type, judge_user_id = EXCLUDED.judge_user_id,
  model = EXCLUDED.model, score = EXCLUDED.score,
  reason = EXCLUDED.reason, judged_at = EXCLUDED.judged_at;

INSERT INTO journey.programme_feedback
  (id, agency_id, departure_id, party_id, traveler_id, departure_day_id,
   target_type, departure_item_id, hotel_id, rating, comment,
   client_operation_id, created_at, updated_at)
SELECT f.id, f.agency_id, f.departure_id, f.party_id, f.traveler_id, dd.id,
       f.target_type,
       CASE WHEN f.target_type = 'itinerary_item' THEN item_map.target_id END,
       CASE WHEN f.target_type = 'hotel' THEN f.hotel_id END,
       f.rating, '', coalesce(f.client_operation_id, f.id), f.created_at, f.updated_at
FROM public.traveler_programme_feedback f
JOIN travel.departure_days dd
  ON dd.departure_id = f.departure_id AND dd.template_day_id = f.trip_day_id
LEFT JOIN ops.legacy_id_map item_map
  ON item_map.source_system = 'public-v2' AND item_map.entity_type = 'departure_item'
 AND item_map.legacy_id = f.departure_id::text || ':' || f.itinerary_item_id::text
ON CONFLICT (id) DO UPDATE SET
  departure_day_id = EXCLUDED.departure_day_id,
  target_type = EXCLUDED.target_type,
  departure_item_id = EXCLUDED.departure_item_id,
  hotel_id = EXCLUDED.hotel_id, rating = EXCLUDED.rating,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE journey.activity_attempts ENABLE TRIGGER activity_attempt_access_gate;
ALTER TABLE travel.template_useful_information ENABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_phrasebook_entries ENABLE TRIGGER guard_template_version_mutation;
ALTER TABLE content.activities ENABLE TRIGGER guard_template_version_mutation;
ALTER TABLE content.activity_items ENABLE TRIGGER guard_template_version_mutation;
