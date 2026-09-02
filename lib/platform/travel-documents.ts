import { safeOriginalName } from "@/lib/photos";

export const MAX_TICKET_SIZE_BYTES = 25 * 1024 * 1024;
export const TICKET_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

export const DAY_DOCUMENT_CONTENT_TYPES = [
  ...TICKET_CONTENT_TYPES,
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export function ticketFileDetails(originalNameValue: unknown, contentTypeValue: unknown) {
  const originalName = safeOriginalName(originalNameValue);
  const contentType = String(contentTypeValue || "")
    .trim()
    .toLowerCase();
  if (!TICKET_CONTENT_TYPES.includes(contentType as (typeof TICKET_CONTENT_TYPES)[number])) return null;
  const byType: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const originalExtension = originalName.split(".").pop()?.toLowerCase();
  const extension = contentType === "image/jpeg" && originalExtension === "jpeg" ? "jpeg" : byType[contentType];
  return extension ? { originalName, contentType, extension } : null;
}

export function dayDocumentFileDetails(originalNameValue: unknown, contentTypeValue: unknown) {
  const originalName = safeOriginalName(originalNameValue);
  const contentType = String(contentTypeValue || "")
    .trim()
    .toLowerCase();
  if (!DAY_DOCUMENT_CONTENT_TYPES.includes(contentType as (typeof DAY_DOCUMENT_CONTENT_TYPES)[number])) return null;
  const extensions: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  };
  const extension = extensions[contentType];
  return extension ? { originalName, contentType, extension } : null;
}
