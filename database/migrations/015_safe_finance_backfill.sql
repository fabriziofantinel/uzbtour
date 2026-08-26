-- SMF Travel - backfill finanziario deterministico.
-- Per EUR il tasso verso la valuta base EUR è sempre 1. Le altre valute
-- restano intenzionalmente nulle finché non è disponibile un tasso storico.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

UPDATE party_expenses
SET base_currency = 'EUR',
    exchange_rate_to_base = 1,
    base_amount = amount
WHERE currency = 'EUR'
  AND (base_amount IS NULL OR exchange_rate_to_base IS NULL);

INSERT INTO platform_schema_migrations (version)
VALUES ('015_safe_finance_backfill')
ON CONFLICT (version) DO NOTHING;
