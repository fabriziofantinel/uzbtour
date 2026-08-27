import { PlatformRequestError } from "./errors";
import type { ObjectStorage } from "./ports/object-storage";
import { getPlatformProviderConfig } from "./provider-config";
import { R2ObjectStorage } from "./r2-object-storage";

let r2Storage: R2ObjectStorage | null = null;

export function getObjectStorage(provider = getPlatformProviderConfig().objectStorage): ObjectStorage {
  if (provider !== "r2") {
    throw new PlatformRequestError(
      "Il nuovo pannello agenzia richiede Cloudflare R2 come storage privato"
    );
  }
  r2Storage ??= new R2ObjectStorage();
  return r2Storage;
}
