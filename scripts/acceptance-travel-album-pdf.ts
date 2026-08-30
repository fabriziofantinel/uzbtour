import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { createTravelAlbumPdfDocument } from "../lib/platform/travel-album-pdf-core";
import type { TravelerExperience } from "../lib/platform/traveler-experience";

async function main() {
const allowedPhotoId = "photo-party-alpha";
const forbiddenPhotoId = "photo-party-beta";
const loaded: string[] = [];
const png = await sharp({ create: { width: 720, height: 480, channels: 3, background: "#22b8c7" } }).png().toBuffer();
const experience = {
  journey: {
    agencyId: "agency-1", departureId: "departure-1", partyId: "party-alpha",
    agencyName: "Agenzia Demo", partyName: "Gruppo Alpha", title: "Vietnam autentico",
    startsOn: "2026-09-10", endsOn: "2026-09-12",
  },
  days: [
    { id: "day-1", number: 1, date: "2026-09-10", title: "Arrivo ad Hanoi", city: "Hanoi", description: "Accoglienza e prima passeggiata nel quartiere antico." },
    { id: "day-2", number: 2, date: "2026-09-11", title: "La baia", city: "Ha Long", description: "Navigazione e incontro con il paesaggio della baia." },
  ],
  notes: [{ id: "note-1", dayId: "day-1", dayNumber: 1, text: "Il primo caffe vietnamita del gruppo.", updatedBy: "Capogruppo", updatedAt: "2026-09-10T18:00:00Z" }],
  photos: [{ id: allowedPhotoId, mediaId: "media-alpha", dayId: "day-1", dayNumber: 1, originalName: "hanoi.png", contentType: "image/png", sizeBytes: png.length, addedBy: "Viaggiatore Alpha", createdAt: "2026-09-10T17:00:00Z", contentUrl: "", downloadUrl: "", canDelete: true }],
  challengeResults: [{ id: "result-1", travelerId: "traveler-alpha", travelerName: "Viaggiatore Alpha", dayId: "day-1", contentId: "content-1", type: "mission", score: 10, maxScore: 10, status: "approved", result: {}, submittedAt: "2026-09-10T17:00:00Z", evidenceUrl: "" }],
} as unknown as TravelerExperience;

const bytes = await createTravelAlbumPdfDocument(experience, async (photo) => {
  loaded.push(photo.id);
  if (photo.id === forbiddenPhotoId) throw new Error("Cross-party photo requested");
  return { bytes: png, contentType: "image/png" };
});
assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-");
assert.deepEqual(loaded, [allowedPhotoId]);
const parsed = await PDFDocument.load(bytes);
assert.equal(parsed.getTitle(), "Vietnam autentico");
assert.equal(parsed.getAuthor(), "Agenzia Demo");
assert.equal(parsed.getCreator(), "SMF Travel");
assert.ok(parsed.getPageCount() >= 2);
const outputDir = resolve("tmp/pdfs");
await mkdir(outputDir, { recursive: true });
const output = resolve(outputDir, "acceptance-travel-album.pdf");
await writeFile(output, bytes);
console.log(JSON.stringify({ status: "passed", output, pages: parsed.getPageCount(), loadedPhotos: loaded.length, partyId: experience.journey.partyId }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
