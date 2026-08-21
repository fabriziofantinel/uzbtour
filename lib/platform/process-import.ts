import { get } from "@vercel/blob";
import { extractTravelProgramme } from "./gemini-travel-ai";
import {
  claimImportJob,
  completeImport,
  failImport,
  markImportGenerating,
} from "./import-repository";

export async function processTravelImport(importId: string) {
  const source = await claimImportJob(importId);
  try {
    const blob = await get(source.object_key, { access: "private" });
    if (!blob || blob.statusCode !== 200) throw new Error("PDF privato non trovato");
    if (blob.blob.contentType !== "application/pdf") throw new Error("Il documento non è un PDF");
    if (blob.blob.size > 30 * 1024 * 1024) throw new Error("Il PDF supera il limite di 30 MB");

    const bytes = new Uint8Array(await new Response(blob.stream).arrayBuffer());
    await markImportGenerating(importId);
    const extraction = await extractTravelProgramme(bytes, source.original_name);
    await completeImport({ importId, ...extraction });
    return { status: "ready_for_review", model: extraction.model, days: extraction.draft.days.length };
  } catch (error) {
    await failImport(importId, error).catch((failure) => console.error("Salvataggio errore import", failure));
    throw error;
  }
}
