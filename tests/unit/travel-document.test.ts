import { describe, expect, it } from "vitest";
import {
  hasTravelDocumentSignature,
  isMatchingTravelDocument,
  travelDocumentExtension,
} from "../../lib/platform/travel-document";

describe("travel document validation", () => {
  it("riconosce estensioni e MIME supportati senza fidarsi del solo nome", () => {
    expect(travelDocumentExtension("Preventivo.DOCX")).toBe("docx");
    expect(travelDocumentExtension("preventivo.exe")).toBeNull();
    expect(isMatchingTravelDocument("programma.pdf", "application/pdf")).toBe(true);
    expect(isMatchingTravelDocument("programma.pdf", "text/plain")).toBe(false);
  });

  it("verifica le firme binarie PDF e DOCX", () => {
    expect(hasTravelDocumentSignature("programma.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(hasTravelDocumentSignature("programma.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(hasTravelDocumentSignature("programma.pdf", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });
});
