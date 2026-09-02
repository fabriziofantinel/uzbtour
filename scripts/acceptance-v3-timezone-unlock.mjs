import assert from "node:assert/strict";
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const client = new Client(url);

try {
  await client.connect();
  const unlocked = async (serviceDate, relativeDays, localTime, timeZone, now) =>
    Boolean(
      (
        await client.query(
          `SELECT ((($1::date + $2::integer) + $3::time) AT TIME ZONE $4) <= $5::timestamptz AS unlocked`,
          [serviceDate, relativeDays, localTime, timeZone, now],
        )
      ).rows[0]?.unlocked,
    );

  assert.equal(await unlocked("2026-08-02", 0, "20:00", "Europe/Rome", "2026-08-02T17:59:59Z"), false);
  assert.equal(await unlocked("2026-08-02", 0, "20:00", "Europe/Rome", "2026-08-02T18:00:00Z"), true);
  assert.equal(await unlocked("2026-08-02", 0, "20:00", "Asia/Tashkent", "2026-08-02T14:59:59Z"), false);
  assert.equal(await unlocked("2026-08-02", 0, "20:00", "Asia/Tashkent", "2026-08-02T15:00:00Z"), true);
  assert.equal(await unlocked("2026-08-02", 1, "20:00", "America/Santiago", "2026-08-03T23:59:59Z"), false);
  assert.equal(await unlocked("2026-08-02", 1, "20:00", "America/Santiago", "2026-08-04T00:00:00Z"), true);

  console.log(JSON.stringify({ status: "passed", cases: 6, dstAware: true }));
} finally {
  await client.end().catch(() => {});
}
