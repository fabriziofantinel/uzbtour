import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL runtime non configurata");
const client = new Client(url);
try {
  await client.connect();
  const role = (await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const gates = (
    await client.query(
      `SELECT has_function_privilege(current_user,'app.create_platform_agency(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb)','EXECUTE') create_agency,has_function_privilege(current_user,'app.update_platform_agency_branding(text,uuid,text,text)','EXECUTE') branding,has_function_privilege(current_user,'app.provision_platform_agency_agent(text,uuid,text,text,text,text,text)','EXECUTE') agent`,
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
