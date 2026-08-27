-- Preserva nel tentativo aggregato lo stato e il punteggio della singola voce.
-- Le chiavi di risposta restano server-side e non vengono restituite dal DTO pubblico.

CREATE OR REPLACE FUNCTION app.enrich_legacy_activity_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,ops,journey
SET row_security=off AS $$
DECLARE r public.party_activity_results%ROWTYPE; v_activity UUID; v_answers JSONB;
BEGIN
  r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  SELECT activity_id INTO v_activity
  FROM ops.legacy_generated_content_map
  WHERE agency_id=r.agency_id AND legacy_generated_content_id=r.generated_content_id;
  IF v_activity IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;

  SELECT jsonb_object_agg(result.generated_content_id::text,
    coalesce(result.result,'{}'::jsonb) || jsonb_build_object(
      '__resultId',result.id,
      '__score',result.score,'__maxScore',result.max_score,'__status',result.status,
      '__submittedAt',result.submitted_at,'__updatedAt',result.updated_at
    )) INTO v_answers
  FROM public.party_activity_results result
  JOIN ops.legacy_generated_content_map map
    ON map.agency_id=result.agency_id
   AND map.legacy_generated_content_id=result.generated_content_id
  WHERE result.agency_id=r.agency_id AND result.party_id=r.party_id
    AND result.traveler_id=r.traveler_id AND map.activity_id=v_activity;

  UPDATE journey.activity_attempts attempt
  SET answers=coalesce(v_answers,'{}'::jsonb),updated_at=clock_timestamp()
  WHERE attempt.agency_id=r.agency_id AND attempt.party_id=r.party_id
    AND attempt.traveler_id=r.traveler_id AND attempt.activity_id=v_activity;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS zz_enrich_v3_activity_attempt ON public.party_activity_results;
CREATE TRIGGER zz_enrich_v3_activity_attempt
AFTER INSERT OR UPDATE OR DELETE ON public.party_activity_results
FOR EACH ROW EXECUTE FUNCTION app.enrich_legacy_activity_attempt();

WITH enriched AS (
  SELECT result.agency_id,result.party_id,result.traveler_id,map.activity_id,
    jsonb_object_agg(result.generated_content_id::text,
      coalesce(result.result,'{}'::jsonb) || jsonb_build_object(
        '__resultId',result.id,
        '__score',result.score,'__maxScore',result.max_score,'__status',result.status,
        '__submittedAt',result.submitted_at,'__updatedAt',result.updated_at
      )) AS answers
  FROM public.party_activity_results result
  JOIN ops.legacy_generated_content_map map
    ON map.agency_id=result.agency_id
   AND map.legacy_generated_content_id=result.generated_content_id
  GROUP BY result.agency_id,result.party_id,result.traveler_id,map.activity_id
)
UPDATE journey.activity_attempts attempt
SET answers=enriched.answers,updated_at=clock_timestamp()
FROM enriched
WHERE attempt.agency_id=enriched.agency_id AND attempt.party_id=enriched.party_id
  AND attempt.traveler_id=enriched.traveler_id AND attempt.activity_id=enriched.activity_id;

REVOKE ALL ON FUNCTION app.enrich_legacy_activity_attempt() FROM PUBLIC;
GRANT USAGE ON SCHEMA content,ops,journey,travel TO smf_app;
GRANT SELECT ON content.activities,content.activity_items,ops.media_assets,
  journey.memories,journey.activity_attempts,journey.activity_evidence,
  journey.photo_contest_entries,journey.photo_contest_judgements TO smf_app;
REVOKE SELECT ON ops.legacy_id_map,ops.legacy_generated_content_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('031_v3_gamification_read_cutover') ON CONFLICT(version) DO NOTHING;
