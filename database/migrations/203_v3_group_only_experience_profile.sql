-- Il profilo esperienza appartiene esclusivamente al gruppo.
-- I valori storici della partenza/versione restano per compatibilita di schema,
-- ma non devono piu condizionare gruppi privi di una scelta esplicita.

UPDATE travel.departures
SET experience_profile='complete',updated_at=clock_timestamp()
WHERE experience_profile<>'complete';

UPDATE travel.trip_template_versions
SET experience_profile='complete'
WHERE experience_profile<>'complete';

INSERT INTO public.platform_schema_migrations(version)
VALUES('203_v3_group_only_experience_profile') ON CONFLICT(version) DO NOTHING;
