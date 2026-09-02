import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";

const name = "055_v3_username_identity_foundation",
  model = "3.27.0-username-identity-foundation";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex"),
  client = new Client(url);
let open = false;
try {
  await client.connect();
  const role = (await client.query("SELECT current_user role_name,current_user='smf_app' runtime")).rows[0];
  if (!role || role.runtime) throw new Error("Ruolo owner richiesto");
  const started = performance.now();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='90s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-username-identity-foundation',0))");
  await client.query(source);

  const contract = (
    await client.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='iam' AND table_name='users' AND column_name='username' AND is_nullable='NO') username_required,
    NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='iam.users'::regclass AND contype='u' AND pg_get_constraintdef(oid) ILIKE '%normalized_email%') email_not_unique,
    has_function_privilege('smf_app','app.resolve_cognito_authenticated_user(text)','EXECUTE') cognito_resolver,
    has_function_privilege('smf_app','app.provision_journey_traveler(text,uuid,uuid,text,text,text,text,text,date,text,text,timestamptz)','EXECUTE') username_provisioning,
    has_function_privilege('smf_app','app.provision_platform_agency_agent(text,uuid,text,text,text,text,text,text,text,timestamptz)','EXECUTE') username_agent_provisioning`)
  ).rows[0];
  if (
    !contract?.username_required ||
    !contract.email_not_unique ||
    !contract.cognito_resolver ||
    !contract.username_provisioning ||
    !contract.username_agent_provisioning
  )
    throw new Error("Contratto username IAM incompleto");

  await client.query("SAVEPOINT shared_email_test");
  const shared = `identity-check-${crypto.randomUUID()}@example.invalid`;
  await client.query(
    `INSERT INTO iam.users(username,display_name,email,status) VALUES
    ($1,'Identity check one',$3,'invited'),($2,'Identity check two',$3,'invited')`,
    [`check_${crypto.randomUUID().replaceAll("-", "")}`, `check_${crypto.randomUUID().replaceAll("-", "")}`, shared],
  );
  const count = Number(
    (await client.query("SELECT count(*) total FROM iam.users WHERE normalized_email=$1", [shared])).rows[0].total,
  );
  if (count !== 2) throw new Error("Email condivisa non supportata");
  await client.query("ROLLBACK TO SAVEPOINT shared_email_test");

  const executionMs = Math.round(performance.now() - started);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
      VALUES($1,$2,$3) ON CONFLICT(version) DO UPDATE
      SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,
      [model, checksum, executionMs],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      {
        status: apply ? "applied" : "dry_run_passed",
        role: role.role_name,
        executionMs,
        gates: {
          usernameRequired: true,
          emailShared: true,
          cognitoResolver: true,
          usernameProvisioning: true,
          usernameAgentProvisioning: true,
        },
        migration: { name, model, checksum },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
