import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getImportAgency } from "@/lib/platform/import-repository";
import { processTravelImport } from "@/lib/platform/process-import";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Importazione non valida" }, { status: 400 });
    }
    const agencyId = await getImportAgency(id);
    await requireAgencyAdmin(agencyId);
    const result = await processTravelImport(id);
    return NextResponse.json({ import: result });
  } catch (error) {
    return platformApiError(error, "Elaborazione del PDF non riuscita");
  }
}
