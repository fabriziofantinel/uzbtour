import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import type { ChallengeEvidenceType } from "@/lib/challenges";
import { bingoItems, isMissionUnlocked, missionDays } from "@/lib/challenge-data";
import {
  MAX_PHOTO_SIZE_BYTES,
  photoExtensionForUpload,
  safeOriginalName,
  validPhotoDay
} from "@/lib/photos";
import { getObjectStorage } from "@/lib/platform/object-storage";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

type UploadPayload = {
  type?: ChallengeEvidenceType;
  day?: number;
  challengeId?: string;
  originalName?: string;
  note?: string;
  contentType?: string;
  sizeBytes?: number;
};

function validChallenge(payload: UploadPayload) {
  if (!payload.challengeId) return false;
  if (payload.type === "mission") {
    return missionDays.some((day) =>
      day.day === payload.day && day.missions.some((mission) => mission.id === payload.challengeId)
    );
  }
  return payload.type === "bingo" && bingoItems.some((item) => item.id === payload.challengeId);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as UploadPayload | null;
  if (!body) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    const originalName = safeOriginalName(body.originalName);
    const contentType = typeof body.contentType === "string" ? body.contentType : "";
    const extension = photoExtensionForUpload(originalName, contentType);
    const sizeBytes = Number(body.sizeBytes);
    if (!body.type || !validPhotoDay(body.day) || !validChallenge(body)
      || !extension || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
      || sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      return NextResponse.json({ error: "Foto-prova non valida o superiore a 25 MB" }, { status: 400 });
    }
    if (body.type === "mission") {
      const day = missionDays.find((entry) => entry.day === body.day)!;
      if (!isMissionUnlocked(day, user)) {
        return NextResponse.json({ error: "Missione non ancora sbloccata" }, { status: 403 });
      }
    }
    const folder = body.type === "mission" ? "missione" : "bingo";
    const key = `uzbekistan-2026/prove/${folder}/giorno-${body.day}/${crypto.randomUUID()}.${extension}`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(
      key,
      contentType,
      10 * 60
    ));
  } catch (error) {
    console.error("Preparazione caricamento prova R2 non riuscita", error);
    return NextResponse.json({ error: "Foto-prova non caricata" }, { status: 503 });
  }
}
