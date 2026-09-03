import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");

const client = new Client(url);
try {
  await client.connect();
  const result = await client.query(`
    SELECT namespace.nspname||'.'||procedure.proname AS name,
      pg_get_function_identity_arguments(procedure.oid) AS arguments,
      has_function_privilege('smf_app',procedure.oid,'EXECUTE') AS executable,
      EXISTS(
        SELECT 1 FROM pg_proc native
        WHERE native.pronamespace=procedure.pronamespace AND native.proname=procedure.proname
          AND pg_get_function_identity_arguments(native.oid) ~ 'p_actor_user_id uuid'
      ) AS native_sibling
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='app'
      AND pg_get_function_identity_arguments(procedure.oid) ~ 'p_actor_legacy'
    ORDER BY 1,2
  `);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        legacyActorSignatures: result.rowCount,
        executableByRuntime: result.rows.filter((row) => row.executable).length,
        coveredByNativeSibling: result.rows.filter((row) => row.native_sibling).length,
        functions: result.rows,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => {});
}
