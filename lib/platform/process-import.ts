import { extractTravelProgramme } from "./gemini-travel-ai";
import {
  claimImportJob,
  completeImport,
  failImport,
  markImportGenerating,
} from "./import-repository";
import { getObjectStorage } from "./object-storage";

export async function processTravelImport(importId: string) {
  const source = await claimImportJob(importId);
  try {
    const storage = getObjectStorage(source.provider === "r2" ? "r2" : "vercel-blob");
    if (storage.bucket !== source.bucket) throw new Error("Bucket del documento non valido");
    const object = await storage.get(source.object_key);
    if (object.contentType !== "application/pdf" || source.content_type !== "application/pdf") {
      throw new Error("Il documento non è un PDF");
    }
    if (object.sizeBytes > 30 * 1024 * 1024 || (source.size_bytes ?? 0) > 30 * 1024 * 1024) {
      throw new Error("Il PDF supera il limite di 30 MB");
    }

    const bytes = object.bytes;
    await markImportGenerating(importId);
    const extraction = await extractTravelProgramme(bytes, source.original_name);
    await completeImport({ importId, ...extraction });
    return { status: "ready_for_review", model: extraction.model, days: extraction.draft.days.length };
  } catch (error) {
    await failImport(importId, error).catch((failure) => console.error("Salvataggio errore import", failure));
    throw error;
  }
}
