import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { assertTravelerPartyScope } from "@/lib/platform/traveler-experience";
import { isMediaObjectRegistered, registerV3MemoryUpload } from "@/lib/platform/v3-media-mutations";
import { MAX_PHOTO_SIZE_BYTES, PHOTO_CONTENT_TYPES, safeOriginalName } from "@/lib/photos";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let uploadedObjectKey = "";
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const departureId = String(body?.departureId || "");
    const partyId = String(body?.partyId || "");
    const dayId = String(body?.dayId || "");
    const objectKey = String(body?.objectKey || "");
    if (body?.privacyAttested !== true)
      return NextResponse.json({ error: "Conferma il consenso delle persone fotografate" }, { status: 400 });
    const agencyId = await assertTravelerPartyScope({ userId: user.id, departureId, partyId, dayId });
    const expectedPrefix = `agencies/${agencyId}/departures/${departureId}/parties/${partyId}/days/${dayId}/memories/`;
    if (!objectKey.startsWith(expectedPrefix))
      return NextResponse.json({ error: "Percorso foto non valido" }, { status: 400 });
    uploadedObjectKey = objectKey;
    const storage = getObjectStorage();
    const sql = getSql();
    const [, privacyRows] = await sql.transaction(
      (txn) => [
        txn`SELECT set_config('app.agency_id',${agencyId},true)`,
        txn`SELECT membership.member_type,COALESCE((SELECT record.decision FROM privacy.consent_records record
        WHERE record.agency_id=membership.agency_id AND record.departure_id=membership.departure_id
          AND record.party_id=membership.party_id AND record.subject_traveler_id=membership.traveler_id
          AND record.consent_type='minor_image_upload' AND record.consent_scope='party'
        ORDER BY record.effective_at DESC,record.id DESC LIMIT 1),'missing') decision
        FROM travel.party_memberships membership JOIN travel.traveler_profiles profile
          ON profile.id=membership.traveler_id AND profile.agency_id=membership.agency_id
        WHERE membership.agency_id=${agencyId} AND membership.departure_id=${departureId}
          AND membership.party_id=${partyId} AND profile.user_id=${user.nativeId}::uuid
          AND membership.status<>'removed' LIMIT 1`,
      ],
      { readOnly: true },
    );
    if (privacyRows[0]?.member_type === "dependent_minor" && privacyRows[0]?.decision !== "granted") {
      await storage.delete(objectKey).catch(() => undefined);
      uploadedObjectKey = "";
      return NextResponse.json(
        { error: "Il consenso immagini del minore non è stato concesso dall’agenzia" },
        { status: 403 },
      );
    }
    const metadata = await storage.head(objectKey);
    if (
      !PHOTO_CONTENT_TYPES.includes(metadata.contentType as (typeof PHOTO_CONTENT_TYPES)[number]) ||
      metadata.sizeBytes <= 0 ||
      metadata.sizeBytes > MAX_PHOTO_SIZE_BYTES
    ) {
      await storage.delete(objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il file caricato non è una foto valida" }, { status: 400 });
    }
    const mediaId = crypto.randomUUID();
    const memoryId = crypto.randomUUID();
    const originalName = safeOriginalName(body?.originalName);
    const memory = await registerV3MemoryUpload({
      userId: user.nativeId,
      departureId,
      partyId,
      dayId,
      mediaId,
      memoryId,
      provider: storage.provider,
      bucket: storage.bucket,
      objectKey,
      originalName,
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
    });
    return NextResponse.json({
      photo: {
        id: memory.id,
        mediaId,
        dayId,
        originalName,
        contentType: metadata.contentType,
        sizeBytes: metadata.sizeBytes,
        addedBy: user.name,
        createdAt: memory.createdAt,
        contentUrl: `/api/traveler/photos/${memory.id}/content`,
        downloadUrl: `/api/traveler/photos/${memory.id}/content?download=1`,
        canDelete: true,
      },
    });
  } catch (error) {
    if (uploadedObjectKey) {
      const registered = await isMediaObjectRegistered(uploadedObjectKey).catch(() => true);
      if (!registered)
        await getObjectStorage()
          .delete(uploadedObjectKey)
          .catch(() => undefined);
    }
    console.error("Registrazione foto viaggio non riuscita", error);
    return NextResponse.json({ error: "Foto caricata ma non registrata" }, { status: 503 });
  }
}
