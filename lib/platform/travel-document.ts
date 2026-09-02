export const TRAVEL_DOCUMENT_MAX_BYTES = 20_000_000;

export const TRAVEL_DOCUMENT_TYPES = {
  pdf: {
    contentType: "application/pdf",
    bedrockFormat: "pdf",
  },
  doc: {
    contentType: "application/msword",
    bedrockFormat: "doc",
  },
  docx: {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bedrockFormat: "docx",
  },
} as const;

export type TravelDocumentExtension = keyof typeof TRAVEL_DOCUMENT_TYPES;

export function travelDocumentExtension(filename: string): TravelDocumentExtension | null {
  const match = filename
    .trim()
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  const extension = match?.[1] as TravelDocumentExtension | undefined;
  return extension && extension in TRAVEL_DOCUMENT_TYPES ? extension : null;
}

export function travelDocumentType(filename: string) {
  const extension = travelDocumentExtension(filename);
  return extension ? { extension, ...TRAVEL_DOCUMENT_TYPES[extension] } : null;
}

export function isMatchingTravelDocument(filename: string, contentType: string) {
  const type = travelDocumentType(filename);
  return Boolean(type && type.contentType === contentType.trim().toLowerCase());
}

export function travelDocumentLabel(filename: string) {
  return travelDocumentExtension(filename)?.toUpperCase() ?? "documento";
}

export function hasTravelDocumentSignature(filename: string, bytes: Uint8Array) {
  const extension = travelDocumentExtension(filename);
  if (!extension) return false;
  if (extension === "pdf") {
    return (
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d
    );
  }
  if (extension === "doc") {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return bytes.length >= ole.length && ole.every((value, index) => bytes[index] === value);
  }
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}
