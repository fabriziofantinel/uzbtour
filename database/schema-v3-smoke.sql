-- Transactional validation for schema-v3-review.sql. Leaves no data behind.
BEGIN;

GRANT USAGE ON SCHEMA iam, ref, travel, content, ops, journey, privacy, app TO smf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam, travel, content, ops, journey, privacy TO smf_app;
GRANT SELECT ON ALL TABLES IN SCHEMA ref TO smf_app;
GRANT EXECUTE ON FUNCTION app.current_agency_id() TO smf_app;
GRANT smf_app TO CURRENT_USER;

INSERT INTO iam.users (id, username, display_name, platform_role, status) VALUES
  ('019d0000-0000-7000-8000-000000000001', 'smoke_admin', 'Test Admin', 'superadmin', 'active');
INSERT INTO iam.users (id, username, display_name, platform_role, status) VALUES
  ('019d0000-0000-7000-8000-000000000002', 'smoke_adult', 'Test Adult', 'user', 'active');
INSERT INTO ref.countries (id, iso_code, name, normalized_name, google_url) VALUES
  ('019d0000-0000-7000-8000-000000000010', 'IT', 'Italia', 'italia', 'https://www.google.com/search?q=Italia');

SELECT set_config('app.agency_id', '019d0000-0000-7000-8000-000000000101', true);
INSERT INTO iam.agencies (id, slug, name, reference_name) VALUES
  ('019d0000-0000-7000-8000-000000000101', 'tenant-a', 'Tenant A', 'Owner A');
SELECT set_config('app.agency_id', '019d0000-0000-7000-8000-000000000102', true);
INSERT INTO iam.agencies (id, slug, name, reference_name) VALUES
  ('019d0000-0000-7000-8000-000000000102', 'tenant-b', 'Tenant B', 'Owner B');

-- RLS visibility under the non-owner runtime role.
SET LOCAL ROLE smf_app;
SELECT set_config('app.agency_id', '019d0000-0000-7000-8000-000000000101', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM iam.agencies) <> 1 THEN
    RAISE EXCEPTION 'RLS agency isolation failed';
  END IF;
END $$;
RESET ROLE;

-- Minimal structures for two tenants.
SELECT set_config('app.agency_id', '019d0000-0000-7000-8000-000000000101', true);
INSERT INTO travel.trip_templates (id, agency_id, slug, title, primary_country_id) VALUES
  ('019d0000-0000-7000-8000-000000000201','019d0000-0000-7000-8000-000000000101','trip-a','Trip A','019d0000-0000-7000-8000-000000000010');
INSERT INTO travel.trip_template_versions (id, agency_id, template_id, version_number) VALUES
  ('019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000201',1);
INSERT INTO travel.template_days (id, agency_id, template_version_id, day_number, day_offset) VALUES
  ('019d0000-0000-7000-8000-000000000401','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301',1,0);
INSERT INTO travel.departures (id, agency_id, template_id, template_version_id, code, title, starts_on, ends_on, timezone) VALUES
  ('019d0000-0000-7000-8000-000000000501','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000201','019d0000-0000-7000-8000-000000000301','DEP-A','Departure A','2026-09-01','2026-09-01','Europe/Rome');
INSERT INTO travel.departure_days
  (id, agency_id, departure_id, template_version_id, template_day_id, service_date)
VALUES
  ('019d0000-0000-7000-8000-000000000411','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000501','019d0000-0000-7000-8000-000000000301',
   '019d0000-0000-7000-8000-000000000401','2026-09-01');
INSERT INTO travel.traveler_profiles
  (id, agency_id, user_id, display_name, birth_date, preferred_locale)
VALUES
  ('019d0000-0000-7000-8000-000000000701','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000001','Adult One','1980-01-01','it-IT'),
  ('019d0000-0000-7000-8000-000000000702','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000002','Adult Two','1982-01-01','en-GB'),
  ('019d0000-0000-7000-8000-000000000703','019d0000-0000-7000-8000-000000000101',
   NULL,'Minor','2010-01-01','it-IT');
INSERT INTO travel.travel_parties (id, agency_id, departure_id, code, name, status, preferred_locale) VALUES
  ('019d0000-0000-7000-8000-000000000801','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000501','P1','Family One','active','it-IT'),
  ('019d0000-0000-7000-8000-000000000802','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000501','P2','Family Two','active','en-GB');
INSERT INTO travel.party_memberships
  (agency_id, departure_id, party_id, traveler_id, role, member_type, status)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000801','019d0000-0000-7000-8000-000000000701','organizer','adult','active'),
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000801','019d0000-0000-7000-8000-000000000703','member','dependent_minor','active'),
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000802','019d0000-0000-7000-8000-000000000702','organizer','adult','active');
INSERT INTO travel.traveler_guardianships
  (agency_id, departure_id, party_id, minor_traveler_id, guardian_traveler_id,
   relationship, effective_from)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000801','019d0000-0000-7000-8000-000000000703',
   '019d0000-0000-7000-8000-000000000701','parent','2026-01-01');

SELECT set_config('app.agency_id', '019d0000-0000-7000-8000-000000000102', true);
INSERT INTO travel.trip_templates (id, agency_id, slug, title, primary_country_id) VALUES
  ('019d0000-0000-7000-8000-000000000202','019d0000-0000-7000-8000-000000000102','trip-b','Trip B','019d0000-0000-7000-8000-000000000010');
INSERT INTO travel.trip_template_versions (id, agency_id, template_id, version_number) VALUES
  ('019d0000-0000-7000-8000-000000000302','019d0000-0000-7000-8000-000000000102','019d0000-0000-7000-8000-000000000202',1);
INSERT INTO travel.template_days (id, agency_id, template_version_id, day_number, day_offset) VALUES
  ('019d0000-0000-7000-8000-000000000402','019d0000-0000-7000-8000-000000000102','019d0000-0000-7000-8000-000000000302',1,0);

-- The composite FK must reject a day belonging to another tenant/version.
SELECT set_config('app.agency_id', '019d0000-0000-7000-8000-000000000101', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO travel.departure_days
      (agency_id, departure_id, template_version_id, template_day_id, service_date)
    VALUES
      ('019d0000-0000-7000-8000-000000000101',
       '019d0000-0000-7000-8000-000000000501',
       '019d0000-0000-7000-8000-000000000301',
       '019d0000-0000-7000-8000-000000000402',
       '2026-09-02');
    RAISE EXCEPTION 'Cross-tenant day was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;

-- Every tenant-policy table except the tenant root must have agency_id as the
-- first index key, otherwise the standard RLS predicate can degrade to Seq Scan.
DO $$
DECLARE missing_tables TEXT;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO missing_tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relrowsecurity
     AND NOT (n.nspname = 'iam' AND c.relname = 'agencies')
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'agency_id' AND NOT a.attisdropped)
     AND NOT EXISTS (
       SELECT 1
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
        WHERE i.indrelid = c.oid AND i.indisvalid AND i.indisready
          AND a.attname = 'agency_id'
     );
  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'RLS tables missing agency-leading indexes: %', missing_tables;
  END IF;
END $$;

-- Direct status changes cannot bypass aggregate publish validation.
DO $$
BEGIN
  BEGIN
    UPDATE travel.trip_template_versions
       SET status = 'published', published_at = clock_timestamp()
     WHERE id = '019d0000-0000-7000-8000-000000000301';
    RAISE EXCEPTION 'Incomplete version was incorrectly published';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Incomplete version was incorrectly published' THEN RAISE; END IF;
  END;
END $$;

-- Build the minimum governed content set and prove that the canonical stored
-- procedure publishes atomically, then makes child content immutable.
INSERT INTO content.activities
  (id, agency_id, template_version_id, template_day_id, activity_type, title, status)
VALUES
  ('019d0000-0000-7000-8000-000000000601','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000401','quiz','Quiz','approved'),
  ('019d0000-0000-7000-8000-000000000602','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000401','mission','Missioni','approved'),
  ('019d0000-0000-7000-8000-000000000603','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000401','word_game','Parole','approved'),
  ('019d0000-0000-7000-8000-000000000604','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000401','order_game','Ordina','approved'),
  ('019d0000-0000-7000-8000-000000000605','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000401','puzzle','Puzzle','approved');
INSERT INTO content.activities
  (id, agency_id, template_version_id, template_day_id, activity_type, contest_category, title, max_entries, status)
VALUES
  ('019d0000-0000-7000-8000-000000000606','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000401','photo_contest','free','Contest libero',2,'approved'),
  ('019d0000-0000-7000-8000-000000000607','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000401','photo_contest','theme','Contest tema',2,'approved');
INSERT INTO content.activities
  (id, agency_id, template_version_id, activity_type, title, status)
VALUES
  ('019d0000-0000-7000-8000-000000000608','019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301','bingo','Bingo','approved');
INSERT INTO content.activity_items
  (agency_id, template_version_id, activity_id, ordinal, item_kind, prompt, answer_spec, points)
SELECT '019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301',
       '019d0000-0000-7000-8000-000000000601',g,'question','Q' || g,
       jsonb_build_object('correct','x'),1 FROM generate_series(1,15) g;
INSERT INTO content.activity_items
  (agency_id, template_version_id, activity_id, ordinal, item_kind, prompt, points)
SELECT '019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301',
       '019d0000-0000-7000-8000-000000000602',g,'mission','M' || g,1
  FROM generate_series(1,5) g;
INSERT INTO content.activity_items
  (agency_id, template_version_id, activity_id, ordinal, item_kind, prompt, points)
SELECT '019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301',
       '019d0000-0000-7000-8000-000000000608',g,'bingo_cell','B' || g,1
  FROM generate_series(1,15) g;

UPDATE content.activities
   SET availability_rule = 'relative_day_time', relative_days = 0, unlock_local_time = '20:00'
 WHERE id = '019d0000-0000-7000-8000-000000000601';
INSERT INTO content.activity_translations
  (agency_id, template_version_id, activity_id, locale, title, instructions,
   status, translated_by, approved_by_user_id, approved_at)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301',
   '019d0000-0000-7000-8000-000000000601','en-GB','Quiz','Answer the questions',
   'approved','human','019d0000-0000-7000-8000-000000000001',clock_timestamp());
INSERT INTO content.activity_item_translations
  (agency_id, template_version_id, activity_id, activity_item_id, locale, prompt,
   status, translated_by, approved_by_user_id, approved_at)
SELECT i.agency_id,i.template_version_id,i.activity_id,i.id,'en-GB','Question 1',
       'approved','human','019d0000-0000-7000-8000-000000000001',clock_timestamp()
  FROM content.activity_items i
 WHERE i.activity_id = '019d0000-0000-7000-8000-000000000601' AND i.ordinal = 1;
INSERT INTO travel.template_itinerary_items
  (id, agency_id, template_version_id, template_day_id, item_type, title, sort_order)
VALUES
  ('019d0000-0000-7000-8000-000000000451','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000401',
   'visit','Visit',1);
INSERT INTO travel.template_itinerary_item_translations
  (agency_id, template_version_id, template_item_id, locale, title, status,
   translated_by, approved_by_user_id, approved_at)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301',
   '019d0000-0000-7000-8000-000000000451','en-GB','Visit','approved','human',
   '019d0000-0000-7000-8000-000000000001',clock_timestamp());

SELECT app.publish_trip_template_version(
  '019d0000-0000-7000-8000-000000000101',
  '019d0000-0000-7000-8000-000000000301',
  '019d0000-0000-7000-8000-000000000001'
);
DO $$
BEGIN
  IF (SELECT status FROM travel.trip_template_versions
       WHERE id = '019d0000-0000-7000-8000-000000000301') <> 'published' THEN
    RAISE EXCEPTION 'Canonical publish procedure did not publish the version';
  END IF;
  BEGIN
    INSERT INTO content.activity_items
      (agency_id, template_version_id, activity_id, ordinal, item_kind, prompt)
    VALUES
      ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000301',
       '019d0000-0000-7000-8000-000000000601',16,'question','Late write');
    RAISE EXCEPTION 'Published content incorrectly accepted a late write';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Published content incorrectly accepted a late write' THEN RAISE; END IF;
  END;
END $$;

-- Expense splitting spans two explicitly consenting families and reconciles
-- both original and base-currency amounts under a deferred aggregate gate.
INSERT INTO journey.expense_groups
  (id, agency_id, departure_id, name, created_by_party_id, created_by_traveler_id,
   client_operation_id)
VALUES
  ('019d0000-0000-7000-8000-000000000901','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000501','Shared costs',
   '019d0000-0000-7000-8000-000000000801','019d0000-0000-7000-8000-000000000701',
   '00000000-0000-0000-0000-000000000901');
INSERT INTO journey.expense_group_parties
  (agency_id, departure_id, expense_group_id, party_id, status,
   accepted_by_traveler_id, joined_at)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000901','019d0000-0000-7000-8000-000000000801',
   'active','019d0000-0000-7000-8000-000000000701',clock_timestamp()),
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000901','019d0000-0000-7000-8000-000000000802',
   'active','019d0000-0000-7000-8000-000000000702',clock_timestamp());
INSERT INTO journey.expenses
  (id, agency_id, departure_id, party_id, departure_day_id, expense_group_id,
   label, amount_minor, currency, base_currency, exchange_rate_to_base, base_amount_minor,
   paid_by_traveler_id, paid_by_name, allocation_method, allocation_status, client_operation_id)
VALUES
  ('019d0000-0000-7000-8000-000000000902','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000501','019d0000-0000-7000-8000-000000000801',
   '019d0000-0000-7000-8000-000000000411','019d0000-0000-7000-8000-000000000901',
   'Shared lunch',1000,'EUR','EUR',1,1000,'019d0000-0000-7000-8000-000000000701',
   'Adult One','equal','draft','00000000-0000-0000-0000-000000000902');
INSERT INTO journey.expense_shares
  (agency_id, departure_id, expense_id, beneficiary_party_id, beneficiary_traveler_id,
   share_amount_minor, share_base_amount_minor)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000902','019d0000-0000-7000-8000-000000000801',
   '019d0000-0000-7000-8000-000000000701',500,500),
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000902','019d0000-0000-7000-8000-000000000802',
   '019d0000-0000-7000-8000-000000000702',500,500);
UPDATE journey.expenses SET allocation_status = 'allocated'
 WHERE id = '019d0000-0000-7000-8000-000000000902';
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO journey.settlements
  (agency_id, departure_id, expense_group_id, payer_party_id, payer_traveler_id,
   receiver_party_id, receiver_traveler_id, amount_minor, currency, base_currency,
   exchange_rate_to_base, base_amount_minor, settled_at, client_operation_id)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000901','019d0000-0000-7000-8000-000000000802',
   '019d0000-0000-7000-8000-000000000702','019d0000-0000-7000-8000-000000000801',
   '019d0000-0000-7000-8000-000000000701',500,'EUR','EUR',1,500,clock_timestamp(),
   '00000000-0000-0000-0000-000000000903');

-- A minor cannot be tagged in media until a current guardian decision exists.
INSERT INTO ops.media_assets
  (id, agency_id, departure_id, party_id, uploaded_by_user_id, provider, bucket,
   object_key, original_name, content_type, size_bytes, purpose, visibility, status)
VALUES
  ('019d0000-0000-7000-8000-000000000920','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000501','019d0000-0000-7000-8000-000000000801',
   '019d0000-0000-7000-8000-000000000001','r2','smoke','minor.jpg','minor.jpg',
   'image/jpeg',10,'memory','party','ready');
DO $$
BEGIN
  BEGIN
    INSERT INTO ops.media_asset_subjects
      (agency_id, departure_id, media_asset_id, subject_party_id, subject_traveler_id)
    VALUES
      ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
       '019d0000-0000-7000-8000-000000000920','019d0000-0000-7000-8000-000000000801',
       '019d0000-0000-7000-8000-000000000703');
    RAISE EXCEPTION 'minor media was accepted without consent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'minor media was accepted without consent' THEN RAISE; END IF;
  END;
END $$;
INSERT INTO privacy.consent_records
  (id, agency_id, departure_id, party_id, subject_traveler_id, decided_by_traveler_id,
   consent_type, consent_scope, decision, policy_version, capture_method,
   captured_by_user_id)
VALUES
  ('019d0000-0000-7000-8000-000000000910','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000501','019d0000-0000-7000-8000-000000000801',
   '019d0000-0000-7000-8000-000000000703','019d0000-0000-7000-8000-000000000701',
   'minor_image_upload','party','granted','privacy-v1','digital',
   '019d0000-0000-7000-8000-000000000001');
INSERT INTO ops.media_asset_subjects
  (agency_id, departure_id, media_asset_id, subject_party_id, subject_traveler_id,
   identification_method)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000920','019d0000-0000-7000-8000-000000000801',
   '019d0000-0000-7000-8000-000000000703','declared');
DO $$
BEGIN
  BEGIN
    UPDATE privacy.consent_records SET notes = 'mutated'
     WHERE id = '019d0000-0000-7000-8000-000000000910';
    RAISE EXCEPTION 'append-only consent was incorrectly updated';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'append-only consent was incorrectly updated' THEN RAISE; END IF;
  END;
END $$;

-- Disruption changes are preserved as events and cannot bypass the command.
INSERT INTO travel.departure_itinerary_items
  (id, agency_id, departure_id, template_version_id, departure_day_id,
   source_template_item_id, item_type, title, sort_order)
VALUES
  ('019d0000-0000-7000-8000-000000000930','019d0000-0000-7000-8000-000000000101',
   '019d0000-0000-7000-8000-000000000501','019d0000-0000-7000-8000-000000000301',
   '019d0000-0000-7000-8000-000000000411','019d0000-0000-7000-8000-000000000451',
   'visit','Visit',1);
INSERT INTO travel.departure_itinerary_item_translations
  (agency_id, departure_id, itinerary_item_id, locale, title, status,
   translated_by, approved_by_user_id, approved_at)
VALUES
  ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
   '019d0000-0000-7000-8000-000000000930','en-GB','Visit','approved','human',
   '019d0000-0000-7000-8000-000000000001',clock_timestamp());
SET LOCAL ROLE smf_app;
DO $$
BEGIN
  BEGIN
    UPDATE travel.departure_itinerary_items SET operational_status = 'cancelled'
     WHERE id = '019d0000-0000-7000-8000-000000000930';
    RAISE EXCEPTION 'direct disruption update was incorrectly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'direct disruption update was incorrectly accepted' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT app.record_itinerary_disruption(
  '019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000930',
  '019d0000-0000-7000-8000-000000000411',NULL,NULL,'cancelled','Weather',NULL,
  '019d0000-0000-7000-8000-000000000001','00000000-0000-0000-0000-000000000930');

-- The server refuses an early quiz without an authorized override, returns a
-- payload without answer_spec after grant, and rejects submitted attempts that
-- do not reference a valid server-issued grant.
DO $$
BEGIN
  BEGIN
    PERFORM app.issue_activity_access_grant(
      '019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
      '019d0000-0000-7000-8000-000000000801','019d0000-0000-7000-8000-000000000701',
      '019d0000-0000-7000-8000-000000000601',repeat('b',64)::char(64),repeat('a',64)::char(64),NULL);
    RAISE EXCEPTION 'early quiz grant was incorrectly issued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'early quiz grant was incorrectly issued' THEN RAISE; END IF;
  END;
END $$;
DO $$
DECLARE v_grant UUID; v_payload JSONB;
BEGIN
  v_grant := app.issue_activity_access_grant(
    '019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
    '019d0000-0000-7000-8000-000000000801','019d0000-0000-7000-8000-000000000701',
    '019d0000-0000-7000-8000-000000000601',repeat('c',64)::char(64),repeat('a',64)::char(64),
    '019d0000-0000-7000-8000-000000000001');
  v_payload := app.get_unlocked_activity_payload(repeat('c',64)::char(64),'en-GB');
  IF v_payload->>'title' <> 'Quiz' OR v_payload::text LIKE '%answer_spec%' THEN
    RAISE EXCEPTION 'unlocked payload localization or answer-key protection failed';
  END IF;
  INSERT INTO journey.activity_attempts
    (agency_id, departure_id, template_version_id, party_id, traveler_id,
     departure_day_id, activity_id, access_grant_id, status, answers,
     client_operation_id, client_answered_at)
  VALUES
    ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
     '019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000801',
     '019d0000-0000-7000-8000-000000000701','019d0000-0000-7000-8000-000000000411',
     '019d0000-0000-7000-8000-000000000601',v_grant,'submitted','{}',
     '00000000-0000-0000-0000-000000000940',clock_timestamp());
END $$;
DO $$
BEGIN
  BEGIN
    INSERT INTO journey.activity_attempts
      (agency_id, departure_id, template_version_id, party_id, traveler_id,
       departure_day_id, activity_id, status, answers, client_operation_id)
    VALUES
      ('019d0000-0000-7000-8000-000000000101','019d0000-0000-7000-8000-000000000501',
       '019d0000-0000-7000-8000-000000000301','019d0000-0000-7000-8000-000000000801',
       '019d0000-0000-7000-8000-000000000703','019d0000-0000-7000-8000-000000000411',
       '019d0000-0000-7000-8000-000000000601','submitted','{}',
       '00000000-0000-0000-0000-000000000941');
    RAISE EXCEPTION 'quiz attempt without grant was incorrectly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'quiz attempt without grant was incorrectly accepted' THEN RAISE; END IF;
  END;
END $$;

-- Claim is atomic, leased and retry-safe; it must set processing ownership.
INSERT INTO ops.integration_outbox
  (agency_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key)
VALUES
  ('019d0000-0000-7000-8000-000000000101','test.event','test','1','{}','smoke:test:1');
DO $$
DECLARE claimed ops.integration_outbox;
BEGIN
  SELECT * INTO claimed FROM app.claim_integration_outbox('smoke-worker', 1, 60);
  IF claimed.id IS NULL OR claimed.status <> 'processing' OR claimed.locked_by <> 'smoke-worker'
     OR claimed.lease_expires_at <= claimed.locked_at THEN
    RAISE EXCEPTION 'Outbox transactional claim failed';
  END IF;
  IF NOT app.complete_integration_outbox(claimed.id, 'smoke-worker', true) THEN
    RAISE EXCEPTION 'Outbox completion failed';
  END IF;
  IF (SELECT status FROM ops.integration_outbox WHERE id = claimed.id) <> 'completed' THEN
    RAISE EXCEPTION 'Outbox completion state is invalid';
  END IF;
END $$;

-- BR-019 prevents a synchronous root delete before the async workflow closes it.
DO $$
BEGIN
  BEGIN
    DELETE FROM iam.agencies WHERE id = '019d0000-0000-7000-8000-000000000101';
    RAISE EXCEPTION 'Active agency was incorrectly deleted synchronously';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Active agency was incorrectly deleted synchronously' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
