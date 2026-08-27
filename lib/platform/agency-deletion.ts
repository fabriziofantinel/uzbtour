import { getSql } from "@/lib/db";
import { getObjectStorage } from "./object-storage";

type Step = { status: string; phase: string; affected: number };

export async function processAgencyDeletion(jobId: string, agencyId: string, deletionJobId: string) {
  const sql = getSql();
  const workerId = `lambda:${jobId}`;
  const claimed = await sql`SELECT status,phase FROM app.claim_agency_deletion_v3(
    ${deletionJobId},${agencyId},${workerId},600)`;
  if (!claimed[0]) throw new Error("Cancellazione agenzia già elaborata o non disponibile");
  if (String(claimed[0].status) === "completed" || String(claimed[0].status) === "blocked") {
    return { status: String(claimed[0].status), phase: String(claimed[0].phase) };
  }
  try {
    for (let iteration = 0; iteration < 500; iteration += 1) {
      let phase = String((claimed[0] as { phase: string }).phase);
      if (phase === "delete_objects") {
        const assets = await sql`SELECT id::text,provider,bucket,object_key FROM app.read_agency_deletion_assets_v3(
          ${deletionJobId},${agencyId},${workerId},100)`;
        const storage = getObjectStorage("r2");
        for (const asset of assets) {
          if (String(asset.provider) !== storage.provider || String(asset.bucket) !== storage.bucket) {
            throw new Error("Storage del media non coerente con la configurazione del worker");
          }
          await storage.delete(String(asset.object_key));
          await sql`SELECT app.mark_agency_deletion_asset_v3(${deletionJobId},${agencyId},
            ${workerId},${String(asset.id)})`;
        }
      }
      const rows = await sql`SELECT status,phase,affected FROM app.advance_agency_deletion_v3(
        ${deletionJobId},${agencyId},${workerId},250)`;
      const step = rows[0] as Step | undefined;
      if (!step) throw new Error("Stato cancellazione agenzia non disponibile");
      phase = step.phase;
      if (step.status === "completed") return { status: step.status, phase };
      if (step.status === "blocked") return { status: step.status, phase };
      (claimed[0] as { phase: string }).phase = phase;
    }
    throw new Error("Cancellazione agenzia oltre il limite operativo del worker");
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1200);
    await sql`SELECT app.release_agency_deletion_v3(${deletionJobId},${agencyId},${workerId},${message})`;
    throw error;
  }
}
