import "server-only";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

export type StorageCategory = "photo" | "document";

export async function assertTenantStorageCapacity(agencyId: string, sizeBytes: number, category: StorageCategory) {
  try {
    const sql = getSql();
    await sql`SELECT app.assert_tenant_storage_capacity_v3(
      ${agencyId}::uuid,
      ${sizeBytes}::bigint,
      ${category},
      NULL::uuid
    )`;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("storage quota")) {
      throw new PlatformRequestError(
        category === "photo"
          ? "Spazio foto dell’agenzia esaurito. Elimina contenuti non necessari o richiedi un aumento della quota."
          : "Spazio documenti dell’agenzia esaurito. Elimina contenuti non necessari o richiedi un aumento della quota.",
      );
    }
    throw error;
  }
}
