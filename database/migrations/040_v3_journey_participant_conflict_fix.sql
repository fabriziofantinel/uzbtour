-- Correzione forward-only della risoluzione ON CONFLICT nella funzione 039.
-- I nomi delle colonne di ritorno PL/pgSQL coincidono con quelli della PK;
-- il riferimento esplicito al vincolo elimina l'ambiguita' a runtime.

DO $$
DECLARE v_oid OID; v_before TEXT; v_after TEXT;
BEGIN
  SELECT routine.oid INTO v_oid
  FROM pg_proc routine
  JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
  WHERE namespace.nspname='app'
    AND routine.proname='provision_journey_traveler'
    AND pg_get_function_identity_arguments(routine.oid)=
      'p_actor_legacy_user_id text, p_agency_id uuid, p_party_id uuid, p_display_name text, p_initials text, p_email text, p_phone text, p_birth_date date, p_role text, p_token_hash text, p_expires_at timestamp with time zone';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'provision_journey_traveler function missing'; END IF;
  v_before:=pg_get_functiondef(v_oid);
  v_after:=replace(v_before,'ON CONFLICT(party_id,traveler_id)',
    'ON CONFLICT ON CONSTRAINT party_memberships_pkey');
  IF v_after=v_before THEN RAISE EXCEPTION 'expected conflict targets not found'; END IF;
  EXECUTE v_after;
END $$;

REVOKE ALL ON FUNCTION app.provision_journey_traveler(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provision_journey_traveler(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('040_v3_journey_participant_conflict_fix') ON CONFLICT(version) DO NOTHING;
