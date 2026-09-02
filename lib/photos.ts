export const MAX_PHOTO_SIZE_BYTES = 25 * 1024 * 1024;
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

export function safeOriginalName(value: unknown) {
  if (typeof value !== "string") return "foto";
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, 255) || "foto";
}

export function photoExtensionForUpload(originalName: string, contentType: string) {
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  const normalizedType = contentType.trim().toLowerCase();
  if (!PHOTO_CONTENT_TYPES.includes(normalizedType as (typeof PHOTO_CONTENT_TYPES)[number])) {
    return null;
  }
  const extension = originalName.split(".").pop()?.toLowerCase();
  if (normalizedType === "image/jpeg" && extension === "jpeg") return "jpeg";
  return byType[normalizedType] ?? null;
}
