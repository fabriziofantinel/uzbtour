import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");

const client = new Client(url);
try {
  await client.connect();
  const definitionName = process.argv.find((argument) => argument.startsWith("--definition="))?.split("=")[1];
  if (process.argv.includes("--actor-lines")) {
    const definitions = await client.query(`
      SELECT procedure.oid::regprocedure::text AS signature,pg_get_functiondef(procedure.oid) AS definition
      FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='app'
        AND pg_get_function_identity_arguments(procedure.oid)~'p_actor_legacy'
      ORDER BY procedure.proname,procedure.oid::regprocedure::text
    `);
    console.log(
      JSON.stringify(
        definitions.rows.map((row) => ({
          signature: row.signature,
          actorLines: row.definition
            .split("\n")
            .filter((line) => line.includes("p_actor_legacy"))
            .map((line) => line.trim()),
        })),
        null,
        2,
      ),
    );
  } else if (definitionName) {
    const definitions = await client.query(
      `SELECT procedure.oid::regprocedure::text AS signature,pg_get_functiondef(procedure.oid) AS definition
       FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
       WHERE namespace.nspname='app' AND procedure.proname=$1
       ORDER BY procedure.oid::regprocedure::text`,
      [definitionName],
    );
    console.log(JSON.stringify(definitions.rows, null, 2));
  } else if (process.argv.includes("--native")) {
    const native = await client.query(`
      SELECT procedure.oid::regprocedure::text AS signature
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='app'
        AND pg_get_function_identity_arguments(procedure.oid)~'^[^,]* uuid(?:,|$)'
      ORDER BY procedure.proname,procedure.oid::regprocedure::text
    `);
    console.log(
      JSON.stringify({ count: native.rowCount, signatures: native.rows.map((row) => row.signature) }, null, 2),
    );
    process.exitCode = 0;
  } else {
    const result = await client.query(`
    SELECT
      procedure.oid::regprocedure::text AS signature,
      procedure.proname AS function_name,
      pg_get_function_identity_arguments(procedure.oid) AS arguments,
      has_function_privilege('smf_app',procedure.oid,'EXECUTE') AS executable_by_app,
      EXISTS(
        SELECT 1
        FROM pg_depend dependency
        WHERE dependency.refobjid=procedure.oid
          AND dependency.deptype NOT IN ('i','e')
      ) AS has_dependents,
      EXISTS(
        SELECT 1
        FROM pg_proc native
        JOIN pg_namespace native_namespace ON native_namespace.oid=native.pronamespace
        WHERE native_namespace.nspname='app'
          AND native.proname=procedure.proname
          AND pg_get_function_identity_arguments(native.oid)~'^[^,]* uuid(?:,|$)'
      ) AS has_native_overload
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='app'
      AND pg_get_function_identity_arguments(procedure.oid)~'p_actor_legacy'
    ORDER BY procedure.proname,procedure.oid::regprocedure::text
  `);
    console.log(JSON.stringify({ count: result.rowCount, signatures: result.rows }, null, 2));
  }
} finally {
  await client.end().catch(() => undefined);
}
