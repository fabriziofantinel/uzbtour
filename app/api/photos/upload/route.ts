import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { head } from "@vercel/blob";
import { getCurrentUser } from "@/lib/current-user";
import {
  MAX_PHOTO_SIZE_BYTES,
  PHOTO_CONTENT_TYPES,
  safeOriginalName,
  savePhotoMetadata,
  validPhotoDay,
  validPhotoPath
} from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

type UploadPayload = {
  day?: number;
  originalName?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
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
        if (!validPhotoDay(payload.day) || !validPhotoPath(pathname, payload.day)) {
          throw new Error("Percorso della foto non valido");
        }

        return {
          allowedContentTypes: [...PHOTO_CONTENT_TYPES],
          maximumSizeInBytes: MAX_PHOTO_SIZE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            day: payload.day,
            originalName: safeOriginalName(payload.originalName),
            user: { id: user.id, name: user.name }
          })
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = JSON.parse(tokenPayload ?? "{}") as UploadPayload & {
          user?: { id?: string; name?: string };
        };
        if (
          !validPhotoDay(payload.day) ||
          !validPhotoPath(blob.pathname, payload.day) ||
          !payload.user?.id ||
          !payload.user.name
        ) {
          throw new Error("Metadati della foto non validi");
        }

        const metadata = await head(blob.pathname).catch(() => null);
        await savePhotoMetadata({
          day: payload.day,
          pathname: blob.pathname,
          originalName: safeOriginalName(payload.originalName),
          contentType: blob.contentType,
          sizeBytes: metadata?.size ?? null,
          user: { id: payload.user.id, name: payload.user.name }
        });
      }
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error("Caricamento Blob non riuscito", error);
    return NextResponse.json(
      { error: "Archivio foto non disponibile o non ancora configurato" },
      { status: 503 }
    );
  }
}
