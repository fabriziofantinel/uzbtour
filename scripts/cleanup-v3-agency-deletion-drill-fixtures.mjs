import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Client } from "@neondatabase/serverless";

if (process.env.DESTRUCTIVE_TEST_CONFIRM !== "1") {
  throw new Error("Bonifica disattivata: impostare DESTRUCTIVE_TEST_CONFIRM=1");
}
const ids = process.argv.slice(2);
if (!ids.length || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
  throw new Error("Specificare gli UUID esatti delle fixture da bonificare");
}
const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!databaseUrl) throw new Error("Connessione diretta Neon owner non configurata");
const parameterName = process.env.R2_PARAMETER_NAME?.trim();
if (!parameterName?.startsWith("/")) throw new Error("R2_PARAMETER_NAME non configurato");
const parameter = await new SSMClient({ region: process.env.AWS_REGION ?? "eu-central-1" }).send(
  new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
);
const credentials = JSON.parse(parameter.Parameter?.Value ?? "{}");
const accountId = process.env.R2_ACCOUNT_ID?.trim();
const jurisdiction = process.env.R2_JURISDICTION?.trim();
const bucket = process.env.R2_BUCKET?.trim();
if (!accountId || !jurisdiction || !bucket) throw new Error("Configurazione R2 incompleta");
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: String(credentials.R2_ACCESS_KEY_ID ?? ""),
    secretAccessKey: String(credentials.R2_SECRET_ACCESS_KEY ?? ""),
  },
});
const db = new Client(databaseUrl);
try {
  await db.connect();
  const fixtures = (
    await db.query(`SELECT id::text,slug,name FROM iam.agencies WHERE id=ANY($1::uuid[]) ORDER BY id`, [ids])
  ).rows;
  if (fixtures.length !== ids.length) throw new Error("Uno o più UUID non esistono");
  for (const fixture of fixtures) {
    if (!fixture.slug.startsWith("delete-target-") && !fixture.slug.startsWith("delete-sentinel-")) {
      throw new Error(`UUID non appartenente alle fixture del drill: ${fixture.id}`);
    }
    if (!fixture.name.startsWith("Destructive deletion ")) {
      throw new Error(`Nome fixture inatteso: ${fixture.id}`);
    }
  }
  for (const fixture of fixtures) {
    const assets = (await db.query("SELECT object_key FROM ops.media_assets WHERE agency_id=$1", [fixture.id])).rows;
    for (const asset of assets) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.object_key }));
    }
    await db.query("DELETE FROM ops.agency_deletion_jobs WHERE agency_id=$1", [fixture.id]);
    await db.query("DELETE FROM ops.media_assets WHERE agency_id=$1", [fixture.id]);
    await db.query("DELETE FROM ops.audit_events WHERE agency_id=$1", [fixture.id]);
    await db.query("UPDATE iam.agencies SET status='closed' WHERE id=$1", [fixture.id]);
    await db.query("DELETE FROM iam.agencies WHERE id=$1", [fixture.id]);
  }
  const remaining = (await db.query("SELECT count(*)::integer value FROM iam.agencies WHERE id=ANY($1::uuid[])", [ids]))
    .rows[0]?.value;
  if (remaining !== 0) throw new Error("Bonifica fixture incompleta");
  console.log(JSON.stringify({ status: "passed", removedFixtureIds: ids.sort() }));
} finally {
  await db.end().catch(() => undefined);
}
