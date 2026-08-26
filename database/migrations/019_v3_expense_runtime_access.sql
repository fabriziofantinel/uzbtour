-- Prima tranche di privilegi runtime sul modello v3: sola esperienza spese.
-- Il ruolo resta NOBYPASSRLS e ogni accesso richiede app.agency_id nella
-- medesima transazione HTTP Neon.

-- Convergenza del solo dato storico incompleto: il backfill v3 ha ricavato il
-- cambio dal movimento di cassa più vicino. Riportiamo quel valore nel legacy,
-- ancora autorevole durante la fase shadow, senza modificare record già completi.
UPDATE public.party_expenses legacy
SET exchange_rate_to_base = target.exchange_rate_to_base,
    base_amount = round(
      target.base_amount_minor::numeric / power(10::numeric, currency.minor_unit),
      4
    ),
    updated_at = clock_timestamp()
FROM journey.expenses target
JOIN ref.currencies currency ON currency.code = target.base_currency
WHERE target.id = legacy.id
  AND target.agency_id = legacy.agency_id
  AND (legacy.exchange_rate_to_base IS NULL OR legacy.base_amount IS NULL);

GRANT USAGE ON SCHEMA app, ref, travel, ops, journey TO smf_app;
GRANT EXECUTE ON FUNCTION app.current_agency_id() TO smf_app;

GRANT SELECT ON TABLE
  ref.currencies,
  travel.departure_days,
  travel.traveler_profiles,
  travel.travel_parties,
  travel.party_memberships,
  ops.legacy_id_map,
  journey.expenses
TO smf_app;

GRANT INSERT, UPDATE, DELETE ON TABLE journey.expenses TO smf_app;

INSERT INTO public.platform_schema_migrations (version)
VALUES ('019_v3_expense_runtime_access')
ON CONFLICT (version) DO NOTHING;
