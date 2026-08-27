import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
} from "docx";
import JSZip from "jszip";
import { travelProgrammeDraftSchema, type TravelProgrammeDraft } from "./import-schema";

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PAYLOAD_BEGIN = "SMF_TRAVEL_CANONICAL_V1_BEGIN";
const PAYLOAD_END = "SMF_TRAVEL_CANONICAL_V1_END";
const TEAL = "0B6462";
const ORANGE = "D46239";
const TEXT = "183C3C";
const MUTED = "687B78";

export const NORMALIZED_TRAVEL_DOCUMENT_CONTENT_TYPE = CONTENT_TYPE;

function safeFilenamePart(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "viaggio";
}

export function normalizedTravelDocumentName(title: string) {
  return `SMF-${safeFilenamePart(title)}.docx`;
}

function text(value: string, options: IRunOptions = {}) {
  return new TextRun({ text: value || "-", color: TEXT, font: "Arial", size: 19, ...options });
}

function paragraph(value: string, options?: { bold?: boolean; color?: string; before?: number; after?: number }) {
  return new Paragraph({
    spacing: { before: options?.before ?? 0, after: options?.after ?? 100 },
    children: [text(value, { bold: options?.bold, color: options?.color })],
  });
}

function labelValue(label: string, value: string) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      text(`${label}: `, { bold: true, color: TEAL }),
      text(value || "Non indicato"),
    ],
  });
}

function cell(value: string, options?: { header?: boolean; width?: number }) {
  return new TableCell({
    width: options?.width ? { size: options.width, type: WidthType.DXA } : undefined,
    shading: options?.header ? { fill: TEAL } : undefined,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    children: [new Paragraph({
      spacing: { after: 0 },
      children: [text(value || "-", {
        bold: options?.header,
        color: options?.header ? "FFFFFF" : TEXT,
        size: options?.header ? 17 : 18,
      })],
    })],
  });
}

function activityRows(day: TravelProgrammeDraft["days"][number]) {
  const headers = new TableRow({
    tableHeader: true,
    children: [
      cell("Ordine", { header: true, width: 650 }),
      cell("Tipo", { header: true, width: 1050 }),
      cell("Attività / sito", { header: true, width: 2250 }),
      cell("Dettagli e note", { header: true, width: 3650 }),
    ],
  });
  const rows = day.activities.map((activity, index) => new TableRow({
    cantSplit: true,
    children: [
      cell(String(index + 1).padStart(2, "0")),
      cell(activity.type),
      cell(activity.type === "visit" ? activity.placeName || activity.title : activity.title),
      cell([
        activity.description,
        activity.placeCity,
        activity.placeCountry,
        activity.startsAt || activity.endsAt
          ? `Orario ${activity.startsAt || "da definire"} - ${activity.endsAt || "da definire"}`
          : "",
      ].filter(Boolean).join(" | ")),
    ],
  }));
  return [headers, ...rows];
}

function canonicalPayloadParagraphs(draft: TravelProgrammeDraft) {
  const encoded = Buffer.from(JSON.stringify(draft), "utf8").toString("base64url");
  const chunks = encoded.match(/.{1,24000}/g) ?? [];
  return [new Paragraph({
    children: [
      new TextRun({ text: PAYLOAD_BEGIN, vanish: true }),
      ...chunks.map((chunk) => new TextRun({ text: chunk, vanish: true })),
      new TextRun({ text: PAYLOAD_END, vanish: true }),
    ],
  })];
}

export async function createNormalizedTravelDocument(
  draftInput: TravelProgrammeDraft,
  sourceName: string
): Promise<Uint8Array> {
  const draft = travelProgrammeDraftSchema.parse(draftInput);
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 180, after: 70 },
      children: [text("SMF TRAVEL", { bold: true, color: ORANGE, size: 20, characterSpacing: 90 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      spacing: { after: 100 },
      children: [text(draft.title, { bold: true, color: TEAL, size: 38 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [text("Preventivo normalizzato per l'importazione", { color: MUTED, italics: true, size: 19 })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: [cell("Paese", { header: true }), cell("Data inizio", { header: true }), cell("Data fine", { header: true })] }),
        new TableRow({ children: [cell(draft.destinationCountry), cell(draft.startDate), cell(draft.endDate)] }),
      ],
    }),
    paragraph(draft.summary, { before: 220, after: 200 }),
    labelValue("Documento originale", sourceName),
    labelValue("Formato normalizzato", "SMF Travel Canonical v1"),
  ];

  for (const [index, day] of draft.days.entries()) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: index > 0,
        spacing: { before: 260, after: 90 },
        children: [text(`Giorno ${index + 1} - ${day.title}`, { bold: true, color: ORANGE, size: 29 })],
      }),
      labelValue("Data", day.date),
      labelValue("Paese e località", [day.country, day.city].filter(Boolean).join(" - ")),
      paragraph(day.description),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        columnWidths: [650, 1050, 2250, 3650],
        rows: activityRows(day),
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
          new TableRow({ children: [cell("Pernottamento", { header: true }), cell("Località", { header: true }), cell("Note", { header: true })] }),
          ...[day.accommodation, ...day.additionalAccommodations].map((accommodation) => new TableRow({ children: [cell(accommodation.name), cell([accommodation.city, accommodation.country].filter(Boolean).join(", ")), cell(accommodation.notes)] })),
        ],
      })
    );
  }

  if (draft.usefulInformation.length > 0) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [text("Informazioni utili", { bold: true, color: ORANGE, size: 29 })],
    }));
    for (const item of draft.usefulInformation) {
      children.push(
        paragraph(`${item.category} - ${item.title}`, { bold: true, color: TEAL, before: 120, after: 40 }),
        paragraph([item.body, item.phone, item.url].filter(Boolean).join(" | "))
      );
    }
  }
  children.push(...canonicalPayloadParagraphs(draft));

  const document = new Document({
    title: draft.title,
    subject: "Preventivo di viaggio normalizzato SMF Travel",
    creator: "SMF Travel",
    lastModifiedBy: "SMF Travel import worker",
    description: `Documento normalizzato dal file ${sourceName}`,
    sections: [{
      properties: { page: { margin: { top: 900, right: 850, bottom: 900, left: 850 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [text("SMF Travel | Preventivo normalizzato", { color: MUTED, size: 15 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [text("Pagina ", { color: MUTED, size: 15 }), new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 15 })] })] }) },
      children,
    }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

function decodeXmlText(xml: string) {
  return xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function readNormalizedTravelDocument(bytes: Uint8Array): Promise<TravelProgrammeDraft> {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("Il DOCX normalizzato non contiene il documento principale");
  const documentText = decodeXmlText(documentXml);
  const begin = documentText.indexOf(PAYLOAD_BEGIN);
  const end = documentText.indexOf(PAYLOAD_END, begin + PAYLOAD_BEGIN.length);
  if (begin < 0 || end < 0) throw new Error("Il DOCX non contiene il payload canonico SMF Travel v1");
  const payload = documentText.slice(begin + PAYLOAD_BEGIN.length, end).replace(/\s/g, "");
  if (!payload) throw new Error("Il payload canonico SMF Travel è vuoto");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return travelProgrammeDraftSchema.parse(parsed);
}
