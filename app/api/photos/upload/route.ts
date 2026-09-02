import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { enforceApiRateLimit } from "@/lib/platform/api-rate-limit";
import { MAX_PHOTO_SIZE_BYTES, photoExtensionForUpload, safeOriginalName, validPhotoDay } from "@/lib/photos";

export const runtime = "nodejs";

type UploadPayload = {
  day?: number;
  originalName?: string;
  contentType?: string;
  sizeBytes?: number;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as UploadPayload | null;
  if (!body) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const limited = await enforceApiRateLimit(request, { scope: "upload.photo", limit: 30, windowSeconds: 600 }, user.id);
  if (limited) return limited;

  try {
    const originalName = safeOriginalName(body.originalName);
    const contentType = typeof body.contentType === "string" ? body.contentType : "";
    const extension = photoExtensionForUpload(originalName, contentType);
    const sizeBytes = Number(body.sizeBytes);
    if (
      !validPhotoDay(body.day) ||
      !extension ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > MAX_PHOTO_SIZE_BYTES
    ) {
      return NextResponse.json({ error: "Foto non valida o superiore a 25 MB" }, { status: 400 });
    }
    const key = `uzbekistan-2026/giorno-${body.day}/${crypto.randomUUID()}.${extension}`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(key, contentType, 10 * 60));
  } catch (error) {
    console.error("Preparazione caricamento R2 non riuscita", error);
    return NextResponse.json({ error: "Archivio foto non disponibile o non ancora configurato" }, { status: 503 });
  }
}
