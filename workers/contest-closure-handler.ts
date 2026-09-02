import { getSql } from "@/lib/db";
import { loadWorkerParameters } from "@/lib/platform/worker-parameters";

export async function handler() {
  await loadWorkerParameters();
  const rows = await getSql()`SELECT app.close_due_photo_contests_v3() closed`;
  const closed = Number(rows[0]?.closed || 0);
  console.info("Due photo contests closed", { closed });
  return { closed };
}
