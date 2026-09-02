import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");

const client = new Client(url);
const agencyId = randomUUID();
const slug = `acceptance-limits-${agencyId.slice(0, 8)}`;

async function resolvedLimits(jobType) {
  const result = await client.query(
    `SELECT active_limit, daily_limit, monthly_limit
       FROM ops.tenant_workload_limits limits
      WHERE (limits.agency_id = $1 OR limits.agency_id IS NULL)
        AND (limits.job_type = $2 OR limits.job_type = '*')
      ORDER BY
        (limits.agency_id = $1) DESC NULLS LAST,
        (limits.job_type = $2) DESC
      LIMIT 1`,
    [agencyId, jobType],
  );
  return result.rows[0];
}

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO iam.agencies(id, slug, name, reference_name, status)
     VALUES ($1, $2, 'Acceptance tenant limits', 'Acceptance', 'active')`,
    [agencyId, slug],
  );
  await client.query(
    `INSERT INTO ops.tenant_workload_limits(
       agency_id, job_type, active_limit, daily_limit, monthly_limit
     ) VALUES ($1, 'travel-programme.import', 1, 2, 3)`,
    [agencyId],
  );

  const functionDefinition = (
    await client.query(
      `SELECT pg_get_functiondef(
         'app.enqueue_platform_job_v3(text,uuid,text,text,jsonb,text,timestamptz)'::regprocedure
       ) AS definition`,
    )
  ).rows[0]?.definition;
  assert.match(functionDefinition, /agency_id = p_agency_id\) DESC NULLS LAST/);

  assert.deepEqual(await resolvedLimits("travel-programme.import"), {
    active_limit: 1,
    daily_limit: 2,
    monthly_limit: 3,
  });
  assert.deepEqual(await resolvedLimits("acceptance.unknown-job"), {
    active_limit: 5,
    daily_limit: 100,
    monthly_limit: 2000,
  });

  console.log(JSON.stringify({ status: "passed", agencyOverride: true, platformFallback: true }));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}
