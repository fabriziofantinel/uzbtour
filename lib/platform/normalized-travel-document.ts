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
const TABLE_WIDTH = 9360;

const activityTypeLabels: Record<string, string> = {
  visit: "Visita", transport: "Trasferimento", flight: "Volo", train: "Treno",
  hotel: "Hotel", meal: "Pasto", free_time: "Tempo libero", meeting: "Incontro", other: "Altro",
};

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

function displayDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || "Non indicato";
}

function sectionHeading(title: string, pageBreakBefore = false) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore,
    spacing: { before: 300, after: 120 },
    children: [text(title, { bold: true, color: ORANGE, size: 28 })],
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
      cell(activityTypeLabels[activity.type] ?? activity.type),
      cell(activity.type === "visit" ? activity.placeName || activity.title : activity.title),
      cell([
        activity.description,
        [activity.placeCity, activity.placeCountry].filter(Boolean).join(", "),
        activity.startsAt || activity.endsAt
          ? `Orario ${activity.startsAt || "da definire"}${activity.endsAt ? ` - ${activity.endsAt}` : ""}`
          : "",
      ].filter(Boolean).join(" | ")),
    ],
  }));
  return [headers, ...rows];
}

function inferredServices(draft: TravelProgrammeDraft) {
  const commercial = draft.commercialDetails.includedServices;
  if (commercial.length) return commercial;
  const activities = draft.days.flatMap((day) => day.activities);
  const stays = draft.days.flatMap((day) => [day.accommodation, ...day.additionalAccommodations])
    .filter((stay) => stay.name.trim());
  const count = (type: string) => activities.filter((activity) => activity.type === type).length;
  return [
    { service: "Voli", included: count("flight") > 0, details: `${count("flight")} tratte nel programma` },
    { service: "Treni", included: count("train") > 0, details: `${count("train")} tratte nel programma` },
    { service: "Trasferimenti", included: count("transport") > 0, details: `${count("transport")} trasferimenti nel programma` },
    { service: "Pernottamenti", included: stays.length > 0, details: `${stays.length} pernottamenti indicati` },
    { service: "Pasti", included: count("meal") > 0, details: `${count("meal")} pasti indicati` },
    { service: "Visite", included: count("visit") > 0, details: `${count("visit")} visite indicate` },
  ];
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
  const commercial = draft.commercialDetails;
  const nights = Math.max(0, draft.days.flatMap((day) => [day.accommodation, ...day.additionalAccommodations])
    .filter((stay) => stay.name.trim()).length);
  const travelers = commercial.travelerCount ?? (
    commercial.adults !== null || commercial.minors !== null
      ? (commercial.adults ?? 0) + (commercial.minors ?? 0)
      : null
  );
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
      children: [text("Preventivo completo revisionato dall’agenzia", { color: MUTED, italics: true, size: 19 })],
    }),
    new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: [4680, 4680],
      rows: [
        new TableRow({ children: [cell("AGENZIA", { header: true, width: 4680 }), cell("PREVENTIVO", { header: true, width: 4680 })] }),
        new TableRow({ children: [cell(commercial.agencyName || "Agenzia non indicata"), cell(commercial.quoteCode || "Codice non indicato")] }),
        new TableRow({ children: [cell(commercial.agencyContact || "Contatti non indicati"), cell([commercial.quoteVersion && `Versione ${commercial.quoteVersion}`, commercial.quoteDate && `del ${displayDate(commercial.quoteDate)}`].filter(Boolean).join(" ") || "Versione non indicata")] }),
      ],
    }),
    sectionHeading("1. TESTATA DEL VIAGGIO"),
    new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: [3000, 6360],
      rows: [
        new TableRow({ children: [cell("CAMPO", { header: true, width: 3000 }), cell("VALORE", { header: true, width: 6360 })] }),
        new TableRow({ children: [cell("Titolo del viaggio"), cell(draft.title)] }),
        new TableRow({ children: [cell("Cliente / famiglia"), cell(commercial.clientName || "Non indicato")] }),
        new TableRow({ children: [cell("Paese o Paesi"), cell(draft.destinationCountry || "Non indicato")] }),
        new TableRow({ children: [cell("Data inizio"), cell(displayDate(draft.startDate))] }),
        new TableRow({ children: [cell("Data fine"), cell(displayDate(draft.endDate))] }),
        new TableRow({ children: [cell("Numero giorni / notti"), cell(`${draft.days.length} giorni / ${nights} notti`)] }),
        new TableRow({ children: [cell("Numero viaggiatori"), cell(travelers === null ? "Non indicato" : String(travelers))] }),
        new TableRow({ children: [cell("Lingua della guida"), cell(commercial.guideLanguage || "Non indicata")] }),
        new TableRow({ children: [cell("Valuta del preventivo"), cell(commercial.currency || "Non indicata")] }),
        new TableRow({ children: [cell("Descrizione sintetica"), cell(draft.summary || "Non indicata")] }),
      ],
    }),
    sectionHeading("2. QUOTAZIONE"),
    new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: [2800, 1800, 1200, 3560],
      rows: [
        new TableRow({ children: [cell("VOCE", { header: true, width: 2800 }), cell("IMPORTO", { header: true, width: 1800 }), cell("VALUTA", { header: true, width: 1200 }), cell("NOTE", { header: true, width: 3560 })] }),
        ...(commercial.pricingRows.length ? commercial.pricingRows : [{ item: "Quotazione", amount: "Non indicata", currency: commercial.currency, notes: "Dato non presente nella revisione strutturata" }])
          .map((row) => new TableRow({ children: [cell(row.item), cell(row.amount), cell(row.currency || commercial.currency), cell(row.notes)] })),
      ],
    }),
    labelValue("Documento di origine", sourceName),
  ];

  for (const [index, day] of draft.days.entries()) {
    children.push(
      sectionHeading(`3.${index + 1} GIORNO ${index + 1} - ${day.title}`, true),
      labelValue("Data", day.date),
      labelValue("Paese e località", [day.country, day.city].filter(Boolean).join(" - ")),
      paragraph("Descrizione estesa della giornata", { bold: true, color: TEAL, before: 100, after: 40 }),
      paragraph(day.description || "Non indicata", { after: 160 }),
      new Table({
        width: { size: TABLE_WIDTH, type: WidthType.DXA },
        layout: TableLayoutType.FIXED,
        columnWidths: [650, 1350, 2700, 4660],
        rows: activityRows(day),
      }),
      new Table({
        width: { size: TABLE_WIDTH, type: WidthType.DXA },
        layout: TableLayoutType.FIXED,
        columnWidths: [3000, 1800, 1600, 2960],
        rows: [
          new TableRow({ children: [cell("NOME HOTEL", { header: true, width: 3000 }), cell("CITTÀ", { header: true, width: 1800 }), cell("PAESE", { header: true, width: 1600 }), cell("NOTE", { header: true, width: 2960 })] }),
          ...[day.accommodation, ...day.additionalAccommodations].filter((accommodation) => accommodation.name.trim()).map((accommodation) => new TableRow({ children: [cell(accommodation.name), cell(accommodation.city), cell(accommodation.country), cell(accommodation.notes)] })),
        ],
      })
    );
  }

  children.push(
    sectionHeading("4. SERVIZI INCLUSI E NON INCLUSI", true),
    new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA }, layout: TableLayoutType.FIXED,
      columnWidths: [2800, 1300, 5260],
      rows: [
        new TableRow({ children: [cell("SERVIZIO", { header: true, width: 2800 }), cell("INCLUSO", { header: true, width: 1300 }), cell("DETTAGLIO", { header: true, width: 5260 })] }),
        ...inferredServices(draft).map((service) => new TableRow({ children: [cell(service.service), cell(service.included ? "Sì" : "No"), cell(service.details)] })),
      ],
    }),
    sectionHeading("5. NOTE, CONDIZIONI E INFORMAZIONI UTILI")
  );
  if (commercial.conditions.length) {
    children.push(new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA }, layout: TableLayoutType.FIXED,
      columnWidths: [2800, 6560],
      rows: [
        new TableRow({ children: [cell("CAMPO", { header: true, width: 2800 }), cell("VALORE", { header: true, width: 6560 })] }),
        ...commercial.conditions.map((condition) => new TableRow({ children: [cell(condition.field), cell(condition.value)] })),
      ],
    }));
  }
  if (draft.usefulInformation.length > 0) {
    for (const item of draft.usefulInformation) {
      children.push(
        paragraph(`${item.category} - ${item.title}`, { bold: true, color: TEAL, before: 120, after: 40 }),
        paragraph([item.body, item.phone, item.url].filter(Boolean).join(" | "))
      );
    }
  }
  children.push(sectionHeading("6. REFERENTI OPERATIVI"));
  children.push(new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA }, layout: TableLayoutType.FIXED,
    columnWidths: [1700, 2100, 1500, 2400, 1660],
    rows: [
      new TableRow({ children: [cell("RUOLO", { header: true, width: 1700 }), cell("NOME", { header: true, width: 2100 }), cell("TELEFONO", { header: true, width: 1500 }), cell("EMAIL / APP", { header: true, width: 2400 }), cell("DISPONIBILITÀ", { header: true, width: 1660 })] }),
      ...(commercial.contacts.length ? commercial.contacts : [{ role: "Agenzia", name: commercial.agencyName, phone: "", email: commercial.agencyContact, availability: "" }])
        .map((contact) => new TableRow({ children: [cell(contact.role), cell(contact.name), cell(contact.phone), cell(contact.email), cell(contact.availability)] })),
    ],
  }));
  children.push(
    sectionHeading("7. ACCETTAZIONE DEL PREVENTIVO"),
    paragraph("Il cliente dichiara di aver letto programma, servizi inclusi e non inclusi, condizioni e scadenze di pagamento."),
    new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA }, layout: TableLayoutType.FIXED,
      columnWidths: [2340, 2340, 2340, 2340],
      rows: [
        new TableRow({ children: [cell("LUOGO E DATA", { header: true, width: 2340 }), cell("NOME CLIENTE", { header: true, width: 2340 }), cell("FIRMA CLIENTE", { header: true, width: 2340 }), cell("FIRMA AGENZIA", { header: true, width: 2340 })] }),
        new TableRow({ children: [cell(""), cell(commercial.clientName), cell(""), cell("")] }),
      ],
    })
  );
  children.push(...canonicalPayloadParagraphs(draft));

  const document = new Document({
    title: draft.title,
    subject: "Preventivo di viaggio revisionato SMF Travel",
    creator: "SMF Travel",
    lastModifiedBy: "SMF Travel",
    description: `Documento normalizzato dal file ${sourceName}`,
    sections: [{
      properties: { page: { margin: { top: 900, right: 850, bottom: 900, left: 850 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [text("SMF Travel | Preventivo revisionato", { color: MUTED, size: 15 })] })] }) },
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
