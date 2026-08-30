import { Client } from "@neondatabase/serverless";

if (process.env.GITHUB_ACTIONS !== "true" || !process.env.NEON_BRANCH_ID) {
  throw new Error("Preparazione ruolo consentita solo su un branch Neon effimero in GitHub Actions");
}

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl) throw new Error("DATABASE_MIGRATION_URL non configurata");

const client = new Client(migrationUrl);
try {
  await client.connect();
  const branchRole = (await client.query("SELECT current_user AS role_name")).rows[0]?.role_name;
  if (!branchRole) throw new Error("Ruolo proprietario Neon non determinabile");

  await client.query(`GRANT smf_app TO ${client.escapeIdentifier(branchRole)}`);
  await client.query("SET ROLE smf_app");
  const runtimeRole = (await client.query("SELECT current_user AS role_name")).rows[0]?.role_name;
  if (runtimeRole !== "smf_app") throw new Error(`Ruolo runtime inatteso: ${runtimeRole ?? "assente"}`);
  await client.query("RESET ROLE");

  console.log(JSON.stringify({ status: "prepared", branchId: process.env.NEON_BRANCH_ID, runtimeRole }));
} finally {
  await client.end().catch(() => undefined);
}
