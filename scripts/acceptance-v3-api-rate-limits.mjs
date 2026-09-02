import { createHash, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const key = createHash("sha256").update(randomUUID()).digest("hex");
  await client.query(
    `INSERT INTO ops.api_rate_limit_buckets(scope,key_hash,bucket_started_at,request_count,expires_at)
     VALUES($1,$2,date_trunc('minute',clock_timestamp())-interval '2 minutes',99,clock_timestamp()-interval '1 second')`,
    ["acceptance.api", key],
  );
  const consume = async () =>
    (await client.query("SELECT * FROM app.consume_api_rate_limit_v3($1,$2,$3,$4)", ["acceptance.api", key, 2, 60]))
      .rows[0];
  const first = await consume(),
    second = await consume(),
    third = await consume();
  if (
    first.allowed !== true ||
    first.remaining !== 1 ||
    second.allowed !== true ||
    second.remaining !== 0 ||
    third.allowed !== false ||
    third.remaining !== 0 ||
    third.retry_after_seconds < 1
  ) {
    throw new Error(`Contratto rate limit non rispettato: ${JSON.stringify({ first, second, third })}`);
  }
  const expired = await client.query(
    "SELECT count(*)::int AS count FROM ops.api_rate_limit_buckets WHERE scope=$1 AND key_hash=$2 AND expires_at<clock_timestamp()",
    ["acceptance.api", key],
  );
  if (expired.rows[0]?.count !== 0) throw new Error("La finestra scaduta del rate limiter non è stata rimossa");
  await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: "passed", requests: [first, second, third] }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
