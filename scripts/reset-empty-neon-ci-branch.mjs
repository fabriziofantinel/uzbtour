import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione Neon CI non configurata");
if (process.env.CI !== "true" || process.env.ALLOW_CI_SCHEMA_RESET !== "1" || !process.env.NEON_BRANCH_ID) {
  throw new Error("Reset consentito esclusivamente su un branch Neon effimero creato dalla CI");
}

const client = new Client(url);
await client.connect();
try {
  const role = (await client.query("SELECT current_user AS role_name, current_database() AS database_name")).rows[0];
  if (role?.role_name === "smf_app") throw new Error("Il ruolo runtime non può azzerare lo schema");
  await client.query(`
    DROP SCHEMA IF EXISTS privacy CASCADE;
    DROP SCHEMA IF EXISTS journey CASCADE;
    DROP SCHEMA IF EXISTS content CASCADE;
    DROP SCHEMA IF EXISTS travel CASCADE;
    DROP SCHEMA IF EXISTS ref CASCADE;
    DROP SCHEMA IF EXISTS iam CASCADE;
    DROP SCHEMA IF EXISTS ops CASCADE;
    DROP SCHEMA IF EXISTS app CASCADE;
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO CURRENT_USER;
    GRANT USAGE ON SCHEMA public TO PUBLIC;
  `);
  console.log(JSON.stringify({ status: "empty_ci_database_ready", ...role }));
} finally {
  await client.end();
}
