import { getSql } from "@/lib/db";
import { loadWorkerParameters } from "@/lib/platform/worker-parameters";

export async function handler() {
  await loadWorkerParameters();
  const rows = await getSql()`SELECT app.close_due_photo_contests_v3() closed,
    app.purge_expired_operational_alerts_v3() purged_alerts`;
  const closed = Number(rows[0]?.closed || 0);
  const purgedAlerts = Number(rows[0]?.purged_alerts || 0);
  console.info("Scheduled operational maintenance completed", { closed, purgedAlerts });
  return { closed, purgedAlerts };
}
