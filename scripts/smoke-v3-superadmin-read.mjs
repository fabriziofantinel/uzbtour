import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const explicitRuntimeUrl = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
const runtimeUrl = explicitRuntimeUrl ?? ownerUrl;
if (!runtimeUrl || !ownerUrl) throw new Error("Connessione runtime non configurata");
const client = new Client(runtimeUrl);
const owner = new Client(ownerUrl);
try {
  await Promise.all([client.connect(), owner.connect()]);
  if (!explicitRuntimeUrl) {
    await client.query("GRANT smf_app TO current_user");
    await client.query("SET ROLE smf_app");
  }
  const role = (await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const unknown = randomUUID();
  const denied = (await client.query("SELECT * FROM app.read_superadmin_summary($1)", [unknown])).rowCount === 0;
  const actor = (
    await owner.query(
      "SELECT id FROM iam.users WHERE platform_role='superadmin' AND status='active' ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  if (!actor) throw new Error("Superadmin attivo non disponibile");
  const summary = (await client.query("SELECT * FROM app.read_superadmin_summary($1)", [actor.id])).rows[0];
  const registry = await client.query("SELECT * FROM app.read_superadmin_agency_registry($1)", [actor.id]);
  const users = await client.query("SELECT * FROM app.read_superadmin_impersonation_users_v3($1)", [actor.id]);
  if (!denied || !summary || Number(summary.agencies) < 1 || registry.rowCount < 1)
    throw new Error("Gate letture superadmin V3 non superati");
  console.log(
    JSON.stringify(
      {
        status: "passed",
        role,
        unauthorizedReadDenied: denied,
        summary,
        registryRows: registry.rowCount,
        userRows: users.rowCount,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => undefined);
  await owner.end().catch(() => undefined);
}
