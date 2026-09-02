import { Client } from "@neondatabase/serverless";
const deletionJobId = process.argv[2],
  apply = process.argv.includes("--apply");
if (!apply || !deletionJobId) throw new Error("Uso: resume-agency-deletion.mjs <job-id> --apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const client = new Client(url),
  workerId = `manual-recovery:${crypto.randomUUID()}`;
try {
  await client.connect();
  const job = (
    await client.query(`SELECT agency_id::text,status,phase FROM ops.agency_deletion_jobs WHERE id=$1`, [deletionJobId])
  ).rows[0];
  if (!job) throw new Error("Job non trovato");
  if (job.phase === "delete_objects") throw new Error("Ripresa manuale non ammessa durante la cancellazione oggetti");
  const claimed = (
    await client.query(`SELECT * FROM app.claim_agency_deletion_v3($1,$2,$3,600)`, [
      deletionJobId,
      job.agency_id,
      workerId,
    ])
  ).rows[0];
  if (!claimed) throw new Error("Job non disponibile");
  let state = claimed;
  for (let i = 0; i < 500 && state.status !== "completed" && state.status !== "blocked"; i += 1) {
    state = (
      await client.query(`SELECT * FROM app.advance_agency_deletion_v3($1,$2,$3,250)`, [
        deletionJobId,
        job.agency_id,
        workerId,
      ])
    ).rows[0];
  }
  if (state.status === "completed")
    await client.query(`SELECT app.finalize_agency_deletion_identities_v3($1)`, [deletionJobId]);
  console.log(
    JSON.stringify({ deletionJobId, agencyId: job.agency_id, status: state.status, phase: state.phase }, null, 2),
  );
} finally {
  await client.end().catch(() => {});
}
