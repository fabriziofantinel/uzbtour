-- Runtime least-privilege grants for traveler expense splitting.
-- Tenant and party isolation remains enforced by FORCE RLS and the existing
-- tenant_isolation policy; the runtime receives only the verbs used by the API.

GRANT SELECT, INSERT ON TABLE journey.expense_shares TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('099_v3_expense_shares_runtime_grants')
ON CONFLICT(version) DO NOTHING;

INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
VALUES('3.66.0-expense-shares-runtime-grants',repeat('0',64),0)
ON CONFLICT(version) DO NOTHING;
