import { extractTravelProgramme } from "./travel-ai";
import {
  claimImportJob,
  completeImport,
  failImport,
  markImportGenerating,
} from "./import-repository";
import { getObjectStorage } from "./object-storage";
import {
  hasTravelDocumentSignature,
  isMatchingTravelDocument,
  TRAVEL_DOCUMENT_MAX_BYTES,
  travelDocumentLabel,
} from "./travel-document";

export async function processTravelImport(
  importId: string,
  expected?: { jobId?: string; agencyId?: string }
) {
  const source = await claimImportJob(importId, expected);
  try {
    const storage = getObjectStorage(source.provider === "r2" ? "r2" : "vercel-blob");
    if (storage.bucket !== source.bucket) throw new Error("Bucket del documento non valido");
    const object = await storage.get(source.object_key);
    if (
      object.contentType !== source.content_type ||
      !isMatchingTravelDocument(source.original_name, object.contentType)
    ) {
      throw new Error("Il formato del documento non è valido");
    }
    if (object.sizeBytes > TRAVEL_DOCUMENT_MAX_BYTES || (source.size_bytes ?? 0) > TRAVEL_DOCUMENT_MAX_BYTES) {
      throw new Error(`Il documento ${travelDocumentLabel(source.original_name)} supera il limite di 4,5 MB`);
    }

    const bytes = object.bytes;
    if (!hasTravelDocumentSignature(source.original_name, bytes)) {
      throw new Error(`Il contenuto del file non corrisponde al formato ${travelDocumentLabel(source.original_name)}`);
    }
    await markImportGenerating(importId);
    const extraction = await extractTravelProgramme(bytes, source.original_name);
    await completeImport({ importId, ...extraction });
    return { status: "ready_for_review", model: extraction.model, days: extraction.draft.days.length };
  } catch (error) {
    await failImport(importId, error).catch((failure) => console.error("Import failure persistence failed", {
      importId,
      error: failure instanceof Error ? failure.message : String(failure),
    }));
    throw error;
  }
}
