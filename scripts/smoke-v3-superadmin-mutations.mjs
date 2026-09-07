import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const explicitRuntimeUrl = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
const runtimeUrl = explicitRuntimeUrl ?? ownerUrl;
if (!runtimeUrl) throw new Error("Connessione runtime non configurata");
const client = new Client(runtimeUrl);
try {
  await client.connect();
  if (!explicitRuntimeUrl) {
    await client.query("GRANT smf_app TO current_user");
    await client.query("SET ROLE smf_app");
  }
  const role = (await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const gates = (
    await client.query(
      `SELECT
        has_function_privilege(current_user,'app.create_platform_agency_with_owner(uuid,jsonb,text,timestamptz)','EXECUTE') create_agency,
        has_function_privilege(current_user,'app.update_platform_agency_branding(uuid,uuid,text,text)','EXECUTE') branding,
        has_function_privilege(current_user,'app.provision_platform_agency_agent(uuid,uuid,text,text,text,text,text,text,text,timestamptz)','EXECUTE') agent`,
    )
  ).rows[0];
  let denied = false;
  try {
    await client.query("SELECT app.update_platform_agency_branding($1,$2,$3,$4)", [
      randomUUID(),
      randomUUID(),
      "#247A6B",
      "",
    ]);
  } catch (error) {
    denied = error?.code === "42501";
  }
  if (!gates || Object.values(gates).some((v) => v !== true) || !denied)
    throw new Error("Gate mutazioni superadmin non superati");
  console.log(JSON.stringify({ status: "passed", role, gates, unauthorizedMutationDenied: denied }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
