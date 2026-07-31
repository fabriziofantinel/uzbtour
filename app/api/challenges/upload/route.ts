import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { head } from "@vercel/blob";
import { getCurrentUser } from "@/lib/current-user";
import {
  type ChallengeEvidenceType,
  saveChallengeEvidence,
  validChallengeEvidencePath
} from "@/lib/challenges";
import { bingoItems, isMissionUnlocked, missionDays } from "@/lib/challenge-data";
import {
  MAX_PHOTO_SIZE_BYTES,
  PHOTO_CONTENT_TYPES,
  safeOriginalName,
  validPhotoDay
} from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

type UploadPayload = {
  type?: ChallengeEvidenceType;
  day?: number;
  challengeId?: string;
  originalName?: string;
  note?: string;
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
  const body = await request.json().catch(() => null) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });

  const user = body.type === "blob.generate-client-token"
    ? await getCurrentUser()
    : null;
  if (body.type === "blob.generate-client-token" && !user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!user) throw new Error("Non autenticato");
        const payload = JSON.parse(clientPayload ?? "{}") as UploadPayload;
        if (
          !payload.type ||
          !validPhotoDay(payload.day) ||
          !validChallenge(payload) ||
          !validChallengeEvidencePath(pathname, payload.type, payload.day)
        ) {
          throw new Error("Percorso della prova non valido");
        }
        if (payload.type === "mission") {
          const day = missionDays.find((entry) => entry.day === payload.day)!;
          if (!isMissionUnlocked(day, user)) throw new Error("Missione non ancora sbloccata");
        }
        return {
          allowedContentTypes: [...PHOTO_CONTENT_TYPES],
          maximumSizeInBytes: MAX_PHOTO_SIZE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            type: payload.type,
            day: payload.day,
            challengeId: payload.challengeId,
            originalName: safeOriginalName(payload.originalName),
            note: typeof payload.note === "string" ? payload.note.slice(0, 240) : "",
            user: { id: user.id, name: user.name }
          })
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = JSON.parse(tokenPayload ?? "{}") as UploadPayload & {
          user?: { id?: string; name?: string };
        };
        if (
          !payload.type ||
          !validPhotoDay(payload.day) ||
          !validChallenge(payload) ||
          !validChallengeEvidencePath(blob.pathname, payload.type, payload.day) ||
          !payload.user?.id ||
          !payload.user.name ||
          !payload.challengeId
        ) {
          throw new Error("Metadati della prova non validi");
        }
        const metadata = await head(blob.pathname).catch(() => null);
        await saveChallengeEvidence({
          type: payload.type,
          day: payload.day,
          challengeId: payload.challengeId,
          pathname: blob.pathname,
          originalName: safeOriginalName(payload.originalName),
          contentType: blob.contentType,
          sizeBytes: metadata?.size ?? null,
          note: payload.note,
          user: { id: payload.user.id, name: payload.user.name }
        });
      }
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error("Caricamento prova Blob non riuscito", error);
    return NextResponse.json({ error: "Foto-prova non caricata" }, { status: 503 });
  }
}
