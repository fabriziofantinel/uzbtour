CREATE OR REPLACE FUNCTION app.actor_legacy_id_v3(p_actor_user_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,ops
SET row_security=off
AS $$
  SELECT map.legacy_id
  FROM ops.legacy_id_map map
  WHERE map.source_system='public-v2'
    AND map.entity_type='user'
    AND map.target_id=p_actor_user_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.actor_legacy_id_v3(UUID) FROM PUBLIC,smf_app;

DO $$
DECLARE
  legacy_function RECORD;
  native_arguments TEXT;
  native_signature REGPROCEDURE;
  native_definition TEXT;
BEGIN
  FOR legacy_function IN
    SELECT
      procedure.oid,
      procedure.proname,
      procedure.oid::regprocedure::text AS signature,
      oidvectortypes(procedure.proargtypes) AS argument_types,
      pg_get_functiondef(procedure.oid) AS definition
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='app'
      AND pg_get_function_identity_arguments(procedure.oid)~'p_actor_legacy[^,]* text'
    ORDER BY
      CASE procedure.proname
        WHEN 'upsert_photo_contest_draft_v3' THEN 0
        WHEN 'save_activity_item_result_v3' THEN 0
        ELSE 1
      END,
      procedure.proname,
      procedure.oid::regprocedure::text
  LOOP
    native_arguments:=regexp_replace(legacy_function.argument_types,'^text','uuid');
    native_signature:=to_regprocedure(format('app.%I(%s)',legacy_function.proname,native_arguments));

    IF native_signature IS NULL THEN
      native_definition:=replace(
        replace(legacy_function.definition,'p_actor_legacy_user_id','p_actor_user_id'),
        'p_actor_legacy',
        'p_actor_user_id'
      );
      native_definition:=regexp_replace(
        native_definition,
        '(\(\s*p_actor_user_id\s+)text',
        '\1uuid',
        'i'
      );
      native_definition:=replace(
        native_definition,
        'app.require_agency_editor(p_actor_user_id,',
        'app.require_agency_editor_v3(p_actor_user_id,'
      );
      native_definition:=regexp_replace(
        native_definition,
        'app\.resolve_legacy_user_id\(p_actor_user_id\s*,\s*[^\)]+\)',
        'p_actor_user_id',
        'gi'
      );
      native_definition:=regexp_replace(
        native_definition,
        '((?:[a-z_][a-z0-9_]*\.)?legacy_id\s*=\s*)p_actor_user_id',
        '\1app.actor_legacy_id_v3(p_actor_user_id)',
        'gi'
      );
      native_definition:=replace(
        native_definition,
        'v_legacy_user_id,p_actor_user_id,p_token_hash',
        'v_legacy_user_id,app.actor_legacy_id_v3(p_actor_user_id),p_token_hash'
      );

      EXECUTE native_definition;
      native_signature:=to_regprocedure(format('app.%I(%s)',legacy_function.proname,native_arguments));
      IF native_signature IS NULL THEN
        RAISE EXCEPTION 'Creazione firma UUID non riuscita per %',legacy_function.signature;
      END IF;
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',native_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO smf_app',native_signature);
  END LOOP;
END
$$;

DO $$
DECLARE missing_count INTEGER;
BEGIN
  SELECT count(*)::integer INTO missing_count
  FROM pg_proc legacy
  JOIN pg_namespace namespace ON namespace.oid=legacy.pronamespace
  WHERE namespace.nspname='app'
    AND pg_get_function_identity_arguments(legacy.oid)~'p_actor_legacy[^,]* text'
    AND to_regprocedure(format(
      'app.%I(%s)',
      legacy.proname,
      regexp_replace(oidvectortypes(legacy.proargtypes),'^text','uuid')
    )) IS NULL;

  IF missing_count<>0 THEN
    RAISE EXCEPTION 'Firme UUID sostitutive mancanti: %',missing_count;
  END IF;
END
$$;

INSERT INTO public.platform_schema_migrations(version)
VALUES('198_v3_native_remaining_actor_signatures') ON CONFLICT(version) DO NOTHING;
