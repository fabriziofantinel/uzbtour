-- La prima pubblicazione precede per progetto la generazione asincrona dei contenuti.
-- Il gate completo resta obbligatorio quando esistono gia attivita materializzate.
CREATE OR REPLACE FUNCTION app.enforce_version_publish_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel, content
AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM travel.template_days day
      WHERE day.agency_id = NEW.agency_id
        AND day.template_version_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'publish gate: at least one programme day is required';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM content.activities activity
      WHERE activity.agency_id = NEW.agency_id
        AND activity.template_version_id = NEW.id
        AND activity.status = 'approved'
    ) THEN
      PERFORM app.validate_template_version_publish(NEW.agency_id, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.enforce_version_publish_gate() FROM PUBLIC;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('073_v3_async_content_publish_gate')
ON CONFLICT(version) DO NOTHING;
