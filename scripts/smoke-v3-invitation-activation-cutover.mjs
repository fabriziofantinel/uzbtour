import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const explicitRuntimeUrl = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL;
const runtimeUrl = explicitRuntimeUrl ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
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
    await client.query(`SELECT
    has_function_privilege(current_user,'app.inspect_account_invitation(text)','EXECUTE') inspect_invitation,
    has_function_privilege(current_user,'app.activate_account_invitation(text,text,text)','EXECUTE') activate_invitation,
    NOT has_table_privilege(current_user,(SELECT relation.oid FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='iam' AND relation.relname='invitations'),'SELECT') invitation_table_private,
    NOT has_table_privilege(current_user,'ops.legacy_id_map','SELECT') identity_map_private`)
  ).rows[0];
  if (!gates || Object.values(gates).some((value) => value !== true))
    throw new Error(`Gate runtime incompleti: ${JSON.stringify(gates)}`);
  const unknownHash = randomBytes(32).toString("hex");
  const unknownInspection =
    (await client.query("SELECT * FROM app.inspect_account_invitation($1)", [unknownHash])).rowCount === 0;
  const unknownActivation =
    (
      await client.query("SELECT * FROM app.activate_account_invitation($1,$2,$3)", [
        unknownHash,
        randomUUID(),
        `${randomUUID()}@invalid.example`,
      ])
    ).rowCount === 0;
  if (!unknownInspection || !unknownActivation) throw new Error("Un invito inesistente e' stato accettato");
  console.log(
    JSON.stringify(
      {
        status: "passed",
        role,
        gates,
        unknownInvitationHidden: unknownInspection,
        unknownActivationDenied: unknownActivation,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => undefined);
}
