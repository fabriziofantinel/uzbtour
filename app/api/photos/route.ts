import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { getObjectStorage } from "@/lib/platform/object-storage";
import {
  ensurePhotosTable,
  isPhotoAdmin,
  MAX_PHOTO_SIZE_BYTES,
  PHOTO_CONTENT_TYPES,
  safeOriginalName,
  savePhotoMetadata,
  validPhotoDay,
  validPhotoPath
} from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

function photoFromRow(row: Record<string, unknown>, user: { id: string; initials: string }) {
  const id = String(row.id);
  return {
    id,
    day: Number(row.day),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    addedBy: String(row.uploaded_by_name),
    createdAt: row.created_at,
    contentUrl: `/api/photos/${id}/content`,
    downloadUrl: `/api/photos/${id}/content?download=1`,
    canDelete: String(row.uploaded_by_id) === user.id || isPhotoAdmin(user)
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    await ensurePhotosTable();
    const sql = getSql();
    const rows = await sql`
      SELECT id, day, original_name, content_type, size_bytes,
             uploaded_by_id, uploaded_by_name, created_at
      FROM trip_photos
      ORDER BY day, created_at DESC
    `;
    return NextResponse.json({ photos: rows.map((row) => photoFromRow(row, user)) });
  } catch (error) {
    console.error("Impossibile leggere le foto", error);
    return NextResponse.json({ error: "Galleria temporaneamente non disponibile" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    day?: number;
    objectKey?: string;
    originalName?: string;
  } | null;

  if (
    !body ||
    !validPhotoDay(body.day) ||
    typeof body.objectKey !== "string" ||
    !validPhotoPath(body.objectKey, body.day)
  ) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }

  try {
    const storage = getObjectStorage();
    const metadata = await storage.head(body.objectKey);
    if (!PHOTO_CONTENT_TYPES.includes(metadata.contentType as typeof PHOTO_CONTENT_TYPES[number])
      || metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      await storage.delete(body.objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il file caricato non è una foto valida" }, { status: 400 });
    }
    const row = await savePhotoMetadata({
      day: body.day,
      pathname: body.objectKey,
      originalName: safeOriginalName(body.originalName),
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
      user
    });
    return NextResponse.json({ photo: photoFromRow(row, user) });
  } catch (error) {
    console.error("Conferma della foto non riuscita", error);
    return NextResponse.json({ error: "Foto caricata ma non ancora registrata" }, { status: 503 });
  }
}
