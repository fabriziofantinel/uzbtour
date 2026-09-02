import { Client } from "@neondatabase/serverless";
import { getObjectStorage } from "../lib/platform/object-storage";
import { judgePhotoContest } from "../lib/platform/photo-contest-ai";
import { loadWorkerParameters } from "../lib/platform/worker-parameters";

async function main() {
  const username = String(
    process.argv.find((value) => value.startsWith("--username="))?.split("=")[1] || "ffantinel",
  ).toLowerCase();
  const repetitions = Number(process.argv.find((value) => value.startsWith("--runs="))?.split("=")[1] || 6);
  const ownerUrl = process.env.DATABASE_MIGRATION_URL;
  if (!ownerUrl) throw new Error("Connessione owner Neon non configurata");
  await loadWorkerParameters();
  const db = new Client(ownerUrl);
  await db.connect();
  try {
    const rows = (
      await db.query(
        `SELECT entry.id::text,entry.is_winner,asset.object_key,activity.title,activity.instructions,activity.contest_category FROM journey.photo_contest_entries entry JOIN travel.traveler_profiles traveler ON traveler.id=entry.traveler_id JOIN iam.users account ON account.id=traveler.user_id JOIN content.activities activity ON activity.id=entry.activity_id JOIN ops.media_assets asset ON asset.id=entry.media_asset_id WHERE account.normalized_username=$1 AND entry.activity_id=(SELECT recent.activity_id FROM journey.photo_contest_entries recent JOIN travel.traveler_profiles profile ON profile.id=recent.traveler_id JOIN iam.users recent_account ON recent_account.id=profile.user_id WHERE recent_account.normalized_username=$1 ORDER BY recent.submitted_at DESC LIMIT 1) ORDER BY entry.participant_slot`,
        [username],
      )
    ).rows;
    if (rows.length !== 2 || rows.filter((row) => row.is_winner).length !== 1)
      throw new Error("Fixture del contest non valida");
    const fixtures = await Promise.all(
      rows.map(async (row) => {
        const object = await getObjectStorage("r2").get(String(row.object_key));
        return { ...row, bytes: object.bytes, contentType: object.contentType };
      }),
    );
    const expectedWinner = String(fixtures.find((row) => row.is_winner)!.id),
      expectedRejected = String(fixtures.find((row) => !row.is_winner)!.id),
      runs = [];
    for (let run = 0; run < repetitions; run += 1) {
      const ordered = run % 2 === 0 ? fixtures : [...fixtures].reverse();
      const evaluations = await judgePhotoContest({
        title: String(rows[0].title),
        instructions: String(rows[0].instructions || ""),
        category: String(rows[0].contest_category || "theme"),
        photos: ordered.map((row) => ({ entryId: String(row.id), bytes: row.bytes, contentType: row.contentType })),
      });
      const positive = evaluations.find((item) => item.entryId === expectedWinner)!,
        negative = evaluations.find((item) => item.entryId === expectedRejected)!;
      runs.push({
        run: run + 1,
        order: ordered.map((row) => String(row.id)),
        positive: { eligible: positive.eligible, total: positive.total },
        negative: { eligible: negative.eligible, total: negative.total },
        passed:
          positive.eligible &&
          !negative.eligible &&
          positive.total > negative.total &&
          negative.total === 0 &&
          [positive, negative].every(
            (item) =>
              item.composition <= 25 &&
              item.technical <= 20 &&
              item.storytelling <= 25 &&
              item.originality <= 15 &&
              item.relevance <= 15 &&
              item.reason.length > 0,
          ),
      });
    }
    const totals = runs.map((run) => run.positive.total),
      mean = totals.reduce((sum, value) => sum + value, 0) / totals.length,
      variance = totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / totals.length;
    const report = {
      status: runs.every((run) => run.passed) ? "passed" : "failed",
      fixture: { username, title: String(rows[0].title), expectedWinner, expectedRejected },
      metrics: {
        runs: repetitions,
        accuracy: runs.filter((run) => run.passed).length / repetitions,
        positiveEligibilityRate: runs.filter((run) => run.positive.eligible).length / repetitions,
        negativeRejectionRate: runs.filter((run) => !run.negative.eligible).length / repetitions,
        orderInvarianceRate: runs.filter((run) => run.passed).length / repetitions,
        positiveMeanScore: Number(mean.toFixed(2)),
        positiveScoreStdDev: Number(Math.sqrt(variance).toFixed(2)),
        positiveScoreRange: Math.max(...totals) - Math.min(...totals),
      },
      runs,
    };
    console.log(JSON.stringify(report));
    if (report.status !== "passed") process.exitCode = 1;
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
