# Database lifecycle

The repository is the source of truth for the SMF Travel database.

The rebuild order is fixed and verified by `scripts/rebuild-database-from-empty.mjs`:

1. legacy multitenant foundation `001-011` from `scripts/migrate-platform.mjs`;
2. hardening migrations `012-015`;
3. normalized v3 target baseline from `database/schema-v3-review.sql`;
4. incremental migrations `019-128` in numeric order;
5. structural, RLS, constraint, index and tenant-isolation validation.

Numbers `016-018` are deliberately reserved for the v3 target baseline and its historical shadow backfills. They are not missing incremental migrations.

`npm run db:rebuild:empty:dry-run` validates the repository plan without a database. The apply command refuses any database containing user tables and additionally requires `ALLOW_EMPTY_DATABASE_BOOTSTRAP=1`. The destructive schema reset has a separate script which only runs when GitHub Actions supplies `CI=true`, an ephemeral `NEON_BRANCH_ID` and `ALLOW_CI_SCHEMA_RESET=1`.

Production is never rebuilt with this command. Existing environments continue to receive reviewed incremental migrations.
