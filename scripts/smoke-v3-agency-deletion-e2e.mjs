import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Client } from "@neondatabase/serverless";
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED,
  queueUrl = process.env.AWS_SQS_IMPORT_QUEUE_URL;
if (!url || !queueUrl) throw new Error("DATABASE_URL_UNPOOLED e AWS_SQS_IMPORT_QUEUE_URL sono obbligatorie");
const db = new Client(url),
  sqs = new SQSClient({ region: process.env.AWS_REGION ?? "eu-central-1" });
let agencyId, jobId;
try {
  await db.connect();
  const actor = (
    await db.query(
      `SELECT map.legacy_id FROM ops.legacy_id_map map JOIN iam.users u ON u.id=map.target_id WHERE map.source_system='public-v2' AND map.entity_type='user' AND u.platform_role='superadmin' AND u.status='active' ORDER BY u.created_at LIMIT 1`,
    )
  ).rows[0];
  if (!actor) throw new Error("Superadmin non disponibile");
  agencyId = crypto.randomUUID();
  await db.query(
    `INSERT INTO iam.agencies(id,slug,name,reference_name,status) VALUES($1,$2,'E2E deletion smoke','E2E','active')`,
    [agencyId, `e2e-delete-${agencyId.slice(0, 8)}`],
  );
  const deletion = (
    await db.query(`SELECT * FROM app.request_agency_deletion_v3($1,$2,'Smoke SQS Lambda BR-019')`, [
      actor.legacy_id,
      agencyId,
    ])
  ).rows[0];
  jobId = crypto.randomUUID();
  await db.query(
    `INSERT INTO ops.platform_jobs(id,agency_id,job_type,provider,status,payload,idempotency_key) VALUES($1,$2,'agency.delete','sqs','queued',$3::jsonb,$4)`,
    [jobId, agencyId, JSON.stringify({ deletionJobId: deletion.job_id }), `agency-delete:${deletion.job_id}`],
  );
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        version: 1,
        jobId,
        agencyId,
        type: "agency.delete",
        payload: { deletionJobId: deletion.job_id },
      }),
    }),
  );
  let state;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    state = (
      await db.query(`SELECT status,phase,last_error FROM ops.agency_deletion_jobs WHERE id=$1`, [deletion.job_id])
    ).rows[0];
    if (state?.status === "completed" || state?.status === "blocked") break;
  }
  const agencyExists = (await db.query(`SELECT EXISTS(SELECT 1 FROM iam.agencies WHERE id=$1) value`, [agencyId]))
    .rows[0]?.value;
  if (state?.status !== "completed" || agencyExists)
    throw new Error(`Smoke non completato: ${JSON.stringify({ state, agencyExists })}`);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        pipeline: "SQS-Lambda-Neon",
        agencyDeletionJobId: deletion.job_id,
        finalPhase: state.phase,
        temporaryAgencyRemoved: !agencyExists,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end().catch(() => {});
}
