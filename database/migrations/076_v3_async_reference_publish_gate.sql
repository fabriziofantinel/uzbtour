-- Consente alla conferma agente di pubblicare il solo programma prima che il
-- worker asincrono materializzi quiz, missioni, giochi e contest.
-- Il bypass e' ristretto a una importazione dello stesso tenant e template
-- ancora in ready_for_review; ogni altra transizione usa il gate completo.

CREATE OR REPLACE FUNCTION app.enforce_version_publish_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel, ops
SET row_security = off
AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    IF EXISTS (
      SELECT 1
      FROM ops.import_jobs import_job
      WHERE import_job.agency_id = NEW.agency_id
        AND import_job.template_id = NEW.template_id
        AND import_job.status = 'ready_for_review'
    ) THEN
      RETURN NEW;
    END IF;
    PERFORM app.validate_template_version_publish(NEW.agency_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.enforce_version_publish_gate() FROM PUBLIC;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('076_v3_async_reference_publish_gate')
ON CONFLICT (version) DO NOTHING;
