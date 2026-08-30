import type { ImageFormat } from "@aws-sdk/client-bedrock-runtime";

const MAX_BEDROCK_IMAGE_BYTES = 3_500_000;

export function bedrockImage(bytes: Uint8Array, contentType: string) {
  if (bytes.byteLength > MAX_BEDROCK_IMAGE_BYTES) {
    throw new Error("La foto supera 3,5 MB dopo l'ottimizzazione e non può essere valutata");
  }
  const formats: Record<string, ImageFormat> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const format = formats[contentType.toLowerCase()];
  if (!format) throw new Error("Formato foto non supportato dalla valutazione AI");
  return { format, source: { bytes } };
}
