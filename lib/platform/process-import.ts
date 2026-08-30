import { createHash } from "node:crypto";
import { extractTravelProgramme } from "./travel-ai";
import {
  claimImportJob,
  completeImport,
  failImport,
  markImportGenerating,
  saveNormalizedImportDocument,
} from "./import-repository";
import { getObjectStorage } from "./object-storage";
import {
  createNormalizedTravelDocument,
  NORMALIZED_TRAVEL_DOCUMENT_CONTENT_TYPE,
  normalizedTravelDocumentName,
  readNormalizedTravelDocument,
} from "./normalized-travel-document";
import { assertNormalizedImportSchema } from "./schema-readiness";
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
  await assertNormalizedImportSchema();
  const source = await claimImportJob(importId, expected);
  let unregisteredNormalizedKey: string | null = null;
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
      throw new Error(`Il documento ${travelDocumentLabel(source.original_name)} supera il limite di 20 MB`);
    }

    const bytes = object.bytes;
    if (!hasTravelDocumentSignature(source.original_name, bytes)) {
      throw new Error(`Il contenuto del file non corrisponde al formato ${travelDocumentLabel(source.original_name)}`);
    }
    await markImportGenerating(importId);
    const extraction = await extractTravelProgramme(bytes, source.original_name);
    const programmeDraft = {
      ...extraction.draft,
      days: extraction.draft.days.map((day) => ({
        ...day,
        activities: day.activities.map((activity) => activity.type === "meal"
          ? { ...activity, includedInQuote: true }
          : activity),
      })),
    };
    const normalizedName = normalizedTravelDocumentName(programmeDraft.title);
    const normalizedKey = `agencies/${source.agency_id}/trips/${source.template_id}/normalized/${importId}/${normalizedName}`;
    const normalizedBytes = await createNormalizedTravelDocument(programmeDraft, source.original_name);
    const checksumSha256 = createHash("sha256").update(normalizedBytes).digest("hex");
    const normalizedObject = await storage.put(
      normalizedKey,
      normalizedBytes,
      NORMALIZED_TRAVEL_DOCUMENT_CONTENT_TYPE
    );
    unregisteredNormalizedKey = normalizedKey;
    if (normalizedObject.provider !== "r2") {
      throw new Error("Il preventivo normalizzato deve essere salvato su Cloudflare R2");
    }
    await saveNormalizedImportDocument({
      importId,
      agencyId: source.agency_id,
      templateId: source.template_id,
      uploadedByUserId: source.uploaded_by_user_id,
      provider: "r2",
      bucket: normalizedObject.bucket,
      objectKey: normalizedObject.key,
      originalName: normalizedName,
      contentType: normalizedObject.contentType,
      sizeBytes: normalizedObject.sizeBytes,
      checksumSha256,
    });
    unregisteredNormalizedKey = null;

    const savedNormalizedObject = await storage.get(normalizedKey);
    const savedChecksum = createHash("sha256").update(savedNormalizedObject.bytes).digest("hex");
    if (savedChecksum !== checksumSha256) {
      throw new Error("Il preventivo normalizzato salvato non supera il controllo di integrità");
    }
    const importedDraft = await readNormalizedTravelDocument(savedNormalizedObject.bytes);
    await completeImport({ importId, ...extraction, draft: importedDraft });
    return {
      status: "ready_for_review",
      model: extraction.model,
      days: importedDraft.days.length,
      normalizedDocument: normalizedName,
    };
  } catch (error) {
    if (unregisteredNormalizedKey) {
      await getObjectStorage("r2").delete(unregisteredNormalizedKey).catch((cleanupError) => {
        console.error("Normalized import cleanup failed", {
          importId,
          objectKey: unregisteredNormalizedKey,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      });
    }
    await failImport(importId, error).catch((failure) => console.error("Import failure persistence failed", {
      importId,
      error: failure instanceof Error ? failure.message : String(failure),
    }));
    throw error;
  }
}
