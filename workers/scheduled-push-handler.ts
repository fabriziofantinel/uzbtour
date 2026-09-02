import { getSql } from "@/lib/db";
import { loadScheduledPushParameters } from "@/lib/platform/scheduled-push-parameters";
import { sendDeparturePush } from "@/lib/platform/web-push-core";

type ScheduledPushKind = "quiz_unlock" | "departure_reminder";

export async function handler() {
  const startedAt = Date.now();
  await loadScheduledPushParameters();
  const sql = getSql();
  const runs = await sql`
    SELECT run_id::text, departure_id::text, kind
    FROM app.claim_due_push_deliveries_v3()
  `;
  const results: Array<Record<string, unknown>> = [];

  for (const run of runs) {
    const runId = String(run.run_id);
    const departureId = String(run.departure_id);
    const kind = String(run.kind) as ScheduledPushKind;
    try {
      const result = await sendDeparturePush({ departureId, kind });
      await sql`SELECT app.complete_push_delivery_v3(${runId}::uuid,true,${result.sent},${result.revoked},NULL)`;
      results.push({ runId, departureId, kind, status: "sent", ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invio non riuscito";
      await sql`SELECT app.complete_push_delivery_v3(${runId}::uuid,false,0,0,${message})`;
      results.push({ runId, departureId, kind, status: "failed" });
    }
  }

  console.info(
    JSON.stringify({
      level: "info",
      message: "Scheduled push run completed",
      claimed: runs.length,
      results,
      durationMs: Date.now() - startedAt,
    }),
  );
  return { claimed: runs.length, results };
}
