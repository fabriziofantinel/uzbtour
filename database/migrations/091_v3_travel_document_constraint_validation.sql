DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'ops.travel_documents'::regclass
       AND conname = 'travel_documents_day_requires_party_ck'
  ) THEN
    RAISE EXCEPTION 'travel_documents_day_requires_party_ck is missing';
  END IF;
END $$;

ALTER TABLE ops.travel_documents
  VALIDATE CONSTRAINT travel_documents_day_requires_party_ck;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('091_v3_travel_document_constraint_validation')
ON CONFLICT(version) DO NOTHING;
