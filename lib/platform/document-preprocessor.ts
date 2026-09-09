import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import type { ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { travelDocumentType } from "./travel-document";

export type BedrockDocumentPart = {
  format: "pdf" | "doc" | "docx" | "txt";
  name: string;
  bytes: Uint8Array;
};

export class OcrRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrRequiredError";
  }
}

function safeName(filename: string, suffix = "") {
  const stem =
    filename
      .replace(/\.(pdf|docx?)$/i, "")
      .replace(/[^a-zA-Z0-9 _\-()[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "programma-viaggio";
  return `${stem.slice(0, Math.max(1, 110 - suffix.length))}${suffix}`;
}

async function splitPdf(bytes: Uint8Array, maxBytes: number): Promise<BedrockDocumentPart[]> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const parts: BedrockDocumentPart[] = [];
  let current = await PDFDocument.create();
  let currentPages = 0;

  for (let index = 0; index < source.getPageCount(); index += 1) {
    const [page] = await current.copyPages(source, [index]);
    current.addPage(page);
    currentPages += 1;
    const candidate = await current.save({ useObjectStreams: true, addDefaultPage: false });
    if (candidate.byteLength <= maxBytes) continue;
    if (currentPages === 1) throw new OcrRequiredError(`La pagina PDF ${index + 1} supera da sola il limite Bedrock`);
    current.removePage(current.getPageCount() - 1);
    const completed = await current.save({ useObjectStreams: true, addDefaultPage: false });
    parts.push({ format: "pdf", name: safeName("programma.pdf", ` parte ${parts.length + 1}`), bytes: completed });
    current = await PDFDocument.create();
    const [retryPage] = await current.copyPages(source, [index]);
    current.addPage(retryPage);
    currentPages = 1;
  }
  if (currentPages > 0) {
    parts.push({
      format: "pdf",
      name: safeName("programma.pdf", ` parte ${parts.length + 1}`),
      bytes: await current.save({ useObjectStreams: true, addDefaultPage: false }),
    });
  }
  if (parts.length > 5) {
    throw new OcrRequiredError("Il PDF richiede più di 5 segmenti Bedrock");
  }
  return parts;
}

function decodeXmlText(xml: string) {
  return xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractTravelDocumentTextForValidation(bytes: Uint8Array, filename: string) {
  if (filename.toLowerCase().endsWith(".ocr.txt")) return new TextDecoder().decode(bytes);
  if (!filename.toLowerCase().endsWith(".docx")) return "";
  const zip = await JSZip.loadAsync(bytes);
  const xmlFiles = Object.keys(zip.files).filter((path) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(path),
  );
  return (await Promise.all(xmlFiles.map(async (path) => decodeXmlText(await zip.file(path)!.async("text")))))
    .filter(Boolean)
    .join("\n\n");
}

async function compactDocx(bytes: Uint8Array, maxBytes: number): Promise<BedrockDocumentPart[]> {
  const zip = await JSZip.loadAsync(bytes);
  for (const path of Object.keys(zip.files)) {
    if (path.startsWith("word/media/") || path.startsWith("word/embeddings/")) zip.remove(path);
  }
  const compact = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  if (compact.byteLength <= maxBytes) return [{ format: "docx", name: safeName("programma.docx"), bytes: compact }];

  const xmlFiles = Object.keys(zip.files).filter((path) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(path),
  );
  const text = (await Promise.all(xmlFiles.map(async (path) => decodeXmlText(await zip.file(path)!.async("text")))))
    .filter(Boolean)
    .join("\n\n");
  const textBytes = new TextEncoder().encode(text);
  if (!text.trim() || textBytes.byteLength > maxBytes) {
    throw new Error("Il DOCX non può essere compresso entro il limite Bedrock");
  }
  return [{ format: "txt", name: safeName("programma.docx", " testo"), bytes: textBytes }];
}

export async function prepareBedrockDocuments(
  bytes: Uint8Array,
  filename: string,
  maxBytes: number,
): Promise<BedrockDocumentPart[]> {
  if (filename.toLowerCase().endsWith(".ocr.txt")) {
    if (bytes.byteLength > maxBytes) throw new Error("Il testo OCR supera il limite Bedrock");
    return [{ format: "txt", name: safeName(filename), bytes }];
  }
  const type = travelDocumentType(filename);
  if (!type) throw new Error("Formato del programma non supportato");
  if (bytes.byteLength <= maxBytes) {
    return [{ format: type.bedrockFormat, name: safeName(filename), bytes } as BedrockDocumentPart];
  }
  if (type.extension === "pdf") return splitPdf(bytes, maxBytes);
  if (type.extension === "docx") return compactDocx(bytes, maxBytes);
  throw new Error("I file DOC oltre 4,5 MB devono essere convertiti in PDF o DOCX");
}

export function bedrockDocumentBlocks(parts: BedrockDocumentPart[]): ContentBlock[] {
  return parts.map(
    (part) =>
      ({
        document: {
          format: part.format,
          name: part.name,
          source: { bytes: part.bytes },
        },
      }) as ContentBlock,
  );
}
