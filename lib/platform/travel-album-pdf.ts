import "server-only";

import { getObjectStorage } from "./object-storage";
import { resolveV3MemoryDownload } from "./v3-media-download";
import type { TravelerExperience } from "./traveler-experience";
import { createTravelAlbumPdfDocument } from "./travel-album-pdf-core";

export async function createTravelAlbumPdf(userId: string, experience: TravelerExperience) {
  const storage = getObjectStorage();
  return createTravelAlbumPdfDocument(experience, async (photo) => {
    const asset = await resolveV3MemoryDownload(userId, photo.id);
    if (!asset) return null;
    const object = await storage.get(asset.objectKey);
    return { bytes: object.bytes, contentType: asset.contentType };
  });
}
