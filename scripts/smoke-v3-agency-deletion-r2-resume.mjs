import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Client } from "@neondatabase/serverless";

if (process.env.DESTRUCTIVE_TEST_CONFIRM !== "1") {
  throw new Error("Test distruttivo disattivato: impostare DESTRUCTIVE_TEST_CONFIRM=1 per avviarlo");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} non configurata`);
  return value;
}

const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim();
if (!databaseUrl) throw new Error("Connessione diretta Neon owner non configurata");

if (!process.env.R2_ACCESS_KEY_ID?.trim() || !process.env.R2_SECRET_ACCESS_KEY?.trim()) {
  const parameterName = process.env.R2_PARAMETER_NAME?.trim();
  if (!parameterName?.startsWith("/")) {
    throw new Error("Credenziali R2 assenti e R2_PARAMETER_NAME non configurato");
  }
  const parameter = await new SSMClient({ region: process.env.AWS_REGION ?? "eu-central-1" }).send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );
  const credentials = JSON.parse(parameter.Parameter?.Value ?? "{}");
  process.env.R2_ACCESS_KEY_ID = String(credentials.R2_ACCESS_KEY_ID ?? "");
  process.env.R2_SECRET_ACCESS_KEY = String(credentials.R2_SECRET_ACCESS_KEY ?? "");
}

const accountId = required("R2_ACCOUNT_ID");
const jurisdiction = required("R2_JURISDICTION").toLowerCase();
const bucket = required("R2_BUCKET");
const endpoint = `https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`;
const r2 = new S3Client({
  region: "auto",
  endpoint,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});

const runId = randomUUID();
const targetAgencyId = randomUUID();
const sentinelAgencyId = randomUUID();
const targetAssetId = randomUUID();
const sentinelAssetId = randomUUID();
const targetKey = `destructive-tests/${runId}/target.txt`;
const sentinelKey = `destructive-tests/${runId}/sentinel.txt`;
const targetBody = new TextEncoder().encode(`target:${runId}`);
const sentinelBody = new TextEncoder().encode(`sentinel:${runId}`);
const db = new Client(databaseUrl);
let deletionJobId;
let connected = false;

async function objectExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

async function removeFixtureAgency(agencyId) {
  await db.query("DELETE FROM ops.media_assets WHERE agency_id=$1", [agencyId]);
  await db.query("DELETE FROM ops.audit_events WHERE agency_id=$1", [agencyId]);
  await db.query("UPDATE iam.agencies SET status='closed' WHERE id=$1", [agencyId]);
  await db.query("DELETE FROM iam.agencies WHERE id=$1", [agencyId]);
}

try {
  await db.connect();
  connected = true;
  const actor = (
    await db.query(
      "SELECT id FROM iam.users WHERE platform_role='superadmin' AND status='active' ORDER BY created_at,id LIMIT 1",
    )
  ).rows[0];
  if (!actor) throw new Error("Superadmin attivo non disponibile");

  await r2.send(new PutObjectCommand({ Bucket: bucket, Key: targetKey, Body: targetBody, ContentType: "text/plain" }));
  await r2.send(
    new PutObjectCommand({ Bucket: bucket, Key: sentinelKey, Body: sentinelBody, ContentType: "text/plain" }),
  );

  await db.query(
    `INSERT INTO iam.agencies(id,slug,name,reference_name,status) VALUES
      ($1,$2,'Destructive deletion target','E2E','active'),
      ($3,$4,'Destructive deletion sentinel','E2E','active')`,
    [targetAgencyId, `delete-target-${runId.slice(0, 8)}`, sentinelAgencyId, `delete-sentinel-${runId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO ops.media_assets
      (id,agency_id,uploaded_by_user_id,provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
     VALUES
      ($1,$2,$3,'r2',$4,$5,'target.txt','text/plain',$6,'other','agency','ready'),
      ($7,$8,$3,'r2',$4,$9,'sentinel.txt','text/plain',$10,'other','agency','ready')`,
    [
      targetAssetId,
      targetAgencyId,
      actor.id,
      bucket,
      targetKey,
      targetBody.byteLength,
      sentinelAssetId,
      sentinelAgencyId,
      sentinelKey,
      sentinelBody.byteLength,
    ],
  );

  const deletion = (
    await db.query("SELECT * FROM app.request_agency_deletion_v3($1::uuid,$2::uuid,$3)", [
      actor.id,
      targetAgencyId,
      `Destructive R2 resume drill ${runId}`,
    ])
  ).rows[0];
  deletionJobId = deletion?.job_id;
  if (!deletionJobId) throw new Error("Job di cancellazione non creato");

  const workerA = `drill-a:${runId}`;
  const workerB = `drill-b:${runId}`;
  const claimed = (
    await db.query("SELECT * FROM app.claim_agency_deletion_v3($1,$2,$3,600)", [deletionJobId, targetAgencyId, workerA])
  ).rows[0];
  if (claimed?.status !== "processing" || claimed?.phase !== "freeze") {
    throw new Error(`Claim iniziale inatteso: ${JSON.stringify(claimed)}`);
  }

  await db.query("SELECT * FROM app.advance_agency_deletion_v3($1,$2,$3,25)", [deletionJobId, targetAgencyId, workerA]);
  const deleteObjectsStep = (
    await db.query("SELECT * FROM app.advance_agency_deletion_v3($1,$2,$3,25)", [
      deletionJobId,
      targetAgencyId,
      workerA,
    ])
  ).rows[0];
  if (deleteObjectsStep?.phase !== "delete_objects") {
    throw new Error(`Fase delete_objects non raggiunta: ${JSON.stringify(deleteObjectsStep)}`);
  }

  const assets = (
    await db.query("SELECT * FROM app.read_agency_deletion_assets_v3($1,$2,$3,100)", [
      deletionJobId,
      targetAgencyId,
      workerA,
    ])
  ).rows;
  if (assets.length !== 1 || assets[0].object_key !== targetKey) {
    throw new Error(`Asset target non isolato: ${JSON.stringify(assets)}`);
  }
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: targetKey }));
  await db.query("SELECT app.mark_agency_deletion_asset_v3($1,$2,$3,$4)", [
    deletionJobId,
    targetAgencyId,
    workerA,
    targetAssetId,
  ]);

  const released = (
    await db.query("SELECT app.release_agency_deletion_v3($1,$2,$3,$4) released", [
      deletionJobId,
      targetAgencyId,
      workerA,
      "Simulated worker interruption after R2 delete",
    ])
  ).rows[0]?.released;
  if (!released) throw new Error("Interruzione simulata non registrata");

  const interrupted = (
    await db.query("SELECT status,phase,attempt_count FROM ops.agency_deletion_jobs WHERE id=$1", [deletionJobId])
  ).rows[0];
  if (interrupted?.status !== "queued" || interrupted?.phase !== "delete_objects") {
    throw new Error(`Stato dopo interruzione inatteso: ${JSON.stringify(interrupted)}`);
  }
  if (!(await objectExists(sentinelKey)) || (await objectExists(targetKey))) {
    throw new Error("Isolamento R2 non rispettato dopo l'interruzione");
  }

  const resumed = (
    await db.query("SELECT * FROM app.claim_agency_deletion_v3($1,$2,$3,600)", [deletionJobId, targetAgencyId, workerB])
  ).rows[0];
  if (resumed?.status !== "processing" || resumed?.phase !== "delete_objects") {
    throw new Error(`Ripresa inattesa: ${JSON.stringify(resumed)}`);
  }

  let finalState = resumed;
  for (let iteration = 0; iteration < 30 && finalState?.status !== "completed"; iteration += 1) {
    finalState = (
      await db.query("SELECT * FROM app.advance_agency_deletion_v3($1,$2,$3,25)", [
        deletionJobId,
        targetAgencyId,
        workerB,
      ])
    ).rows[0];
  }
  if (finalState?.status !== "completed" || finalState?.phase !== "completed") {
    throw new Error(`Cancellazione non completata: ${JSON.stringify(finalState)}`);
  }
  await db.query("SELECT app.finalize_agency_deletion_identities_v3($1)", [deletionJobId]);

  const verification = (
    await db.query(
      `SELECT
        EXISTS(SELECT 1 FROM iam.agencies WHERE id=$1) target_agency_exists,
        EXISTS(SELECT 1 FROM ops.media_assets WHERE id=$2) target_asset_exists,
        EXISTS(SELECT 1 FROM iam.agencies WHERE id=$3 AND status='active') sentinel_agency_active,
        EXISTS(SELECT 1 FROM ops.media_assets WHERE id=$4 AND agency_id=$3 AND status='ready') sentinel_asset_ready`,
      [targetAgencyId, targetAssetId, sentinelAgencyId, sentinelAssetId],
    )
  ).rows[0];
  const targetObjectExists = await objectExists(targetKey);
  const sentinelObjectExists = await objectExists(sentinelKey);
  if (
    verification.target_agency_exists ||
    verification.target_asset_exists ||
    targetObjectExists ||
    !verification.sentinel_agency_active ||
    !verification.sentinel_asset_ready ||
    !sentinelObjectExists
  ) {
    throw new Error(
      `Verifica finale fallita: ${JSON.stringify({ ...verification, targetObjectExists, sentinelObjectExists })}`,
    );
  }

  await db.query("DELETE FROM ops.agency_deletion_jobs WHERE id=$1", [deletionJobId]);
  await removeFixtureAgency(targetAgencyId);
  await removeFixtureAgency(sentinelAgencyId);
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: targetKey }));
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: sentinelKey }));
  const fixtureRowsRemain = (
    await db.query(
      `SELECT EXISTS(
        SELECT 1 FROM iam.agencies WHERE id IN($1,$2)
        UNION ALL SELECT 1 FROM ops.media_assets WHERE id IN($3,$4)
        UNION ALL SELECT 1 FROM ops.agency_deletion_jobs WHERE id=$5
      ) value`,
      [targetAgencyId, sentinelAgencyId, targetAssetId, sentinelAssetId, deletionJobId],
    )
  ).rows[0]?.value;
  if (fixtureRowsRemain || (await objectExists(targetKey)) || (await objectExists(sentinelKey))) {
    throw new Error("Pulizia finale delle fixture non riuscita");
  }

  console.log(
    JSON.stringify({
      status: "passed",
      runId,
      actualR2ObjectDeleted: true,
      interruptionRecorded: true,
      resumedWithSecondWorker: true,
      targetTenantRemoved: true,
      sentinelTenantUnchanged: true,
      cleanupVerified: true,
      attempts: interrupted.attempt_count + 1,
    }),
  );
} finally {
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: targetKey })).catch(() => undefined);
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: sentinelKey })).catch(() => undefined);
  if (connected) {
    await db.query("DELETE FROM ops.agency_deletion_jobs WHERE id=$1", [deletionJobId]).catch(() => undefined);
    await removeFixtureAgency(targetAgencyId).catch(() => undefined);
    await removeFixtureAgency(sentinelAgencyId).catch(() => undefined);
    await db.end().catch(() => undefined);
  }
}
