-- Align the physical model with the product rule: exactly two contest photos.
-- This is a one-time metadata correction on already published immutable
-- versions. Disable only the immutability trigger for the bounded update.
ALTER TABLE content.activities DROP CONSTRAINT IF EXISTS activities_check1;
ALTER TABLE content.activities DISABLE TRIGGER guard_template_version_mutation;
UPDATE content.activities SET max_entries=2
WHERE activity_type='photo_contest' AND max_entries<>2;
ALTER TABLE content.activities ENABLE TRIGGER guard_template_version_mutation;

ALTER TABLE content.activities ADD CONSTRAINT activities_check1 CHECK(
  (activity_type='photo_contest' AND contest_category IS NOT NULL AND max_entries=2)
  OR (activity_type<>'photo_contest' AND contest_category IS NULL AND max_entries IS NULL)
) NOT VALID;
ALTER TABLE content.activities VALIDATE CONSTRAINT activities_check1;

ALTER TABLE journey.photo_contest_entries
  DROP CONSTRAINT IF EXISTS photo_contest_entries_participant_slot_check;
ALTER TABLE journey.photo_contest_entries
  ADD CONSTRAINT photo_contest_entries_participant_slot_check
  CHECK(participant_slot BETWEEN 1 AND 2) NOT VALID;
ALTER TABLE journey.photo_contest_entries
  VALIDATE CONSTRAINT photo_contest_entries_participant_slot_check;

INSERT INTO public.platform_schema_migrations(version)
VALUES('110_v3_photo_contest_two_entry_contract') ON CONFLICT(version) DO NOTHING;
