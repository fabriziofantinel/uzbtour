import { getSql } from "./db";

export const MAX_PHOTO_SIZE_BYTES = 25 * 1024 * 1024;
export const PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
] as const;

let photosSchemaPromise: Promise<void> | null = null;

export async function ensurePhotosTable() {
  const sql = getSql();
  if (!photosSchemaPromise) {
    photosSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS trip_photos (
          id BIGSERIAL PRIMARY KEY,
          day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 13),
          pathname TEXT NOT NULL UNIQUE,
          original_name TEXT NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
          content_type TEXT NOT NULL,
          size_bytes BIGINT,
          uploaded_by_id TEXT NOT NULL,
          uploaded_by_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS trip_photos_day_created_idx
        ON trip_photos (day, created_at DESC)
      `;
    })().catch((error) => {
      photosSchemaPromise = null;
      throw error;
    });
  }
  await photosSchemaPromise;
}

export function validPhotoDay(day: unknown): day is number {
  return Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 13;
}

export function safeOriginalName(value: unknown) {
  if (typeof value !== "string") return "foto";
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, 255) || "foto";
}

export function validPhotoPath(pathname: unknown, day: number) {
  if (typeof pathname !== "string") return false;
  return new RegExp(
    `^uzbekistan-2026/giorno-${day}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|heic|heif)$`,
    "i"
  ).test(pathname);
}

export async function savePhotoMetadata(input: {
  day: number;
  pathname: string;
  originalName: string;
  contentType: string;
  sizeBytes?: number | null;
  user: { id: string; name: string };
}) {
  await ensurePhotosTable();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO trip_photos (
      day, pathname, original_name, content_type, size_bytes,
      uploaded_by_id, uploaded_by_name
    )
    VALUES (
      ${input.day}, ${input.pathname}, ${input.originalName}, ${input.contentType},
      ${input.sizeBytes ?? null}, ${input.user.id}, ${input.user.name}
    )
    ON CONFLICT (pathname) DO UPDATE SET
      original_name = EXCLUDED.original_name,
      content_type = EXCLUDED.content_type,
      size_bytes = COALESCE(EXCLUDED.size_bytes, trip_photos.size_bytes)
    RETURNING id, day, pathname, original_name, content_type, size_bytes,
              uploaded_by_id, uploaded_by_name, created_at
  `;
  return rows[0];
}

export function isPhotoAdmin(user: { initials: string }) {
  return user.initials.toUpperCase() === "FF";
}

