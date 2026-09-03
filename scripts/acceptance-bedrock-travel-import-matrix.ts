import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { extractTravelProgrammeWithBedrock } from "../lib/platform/bedrock-travel-ai";
import { withAiTestReplay } from "../lib/platform/ai-test-replay";

type ExpectedImport = {
  scenario: string;
  filename: string;
  bytes: Uint8Array;
  days: number;
  countries: string[];
  cities: string[];
  currency: string;
  hotelFragments: string[];
  minimumVisits: number;
  provider: "pdf" | "docx" | "ocr-text";
  evidenceMethod: "bedrock_native" | "textract";
};

const norwaySource = [
  "PREVENTIVO NORVEGIA - FIORDI 2027",
  "Codice: NO-2027-04",
  "Cliente: Gruppo Aurora - 8 viaggiatori",
  "Periodo: 14-16 giugno 2027",
  "Valuta: NOK",
  "",
  "GIORNO 1 - 14 giugno 2027 - OSLO",
  "Arrivo a Oslo e trasferimento in centro.",
  "Visita del Palazzo Reale di Oslo e della Fortezza di Akershus a Oslo.",
  "Cena inclusa in ristorante locale.",
  "Pernottamento presso Thon Hotel Opera, Oslo, Norvegia.",
  "",
  "GIORNO 2 - 15 giugno 2027 - FLAM",
  "Treno panoramico da Oslo a Myrdal e proseguimento sulla Flamsbana fino a Flam.",
  "Passeggiata nel villaggio di Flam.",
  "Pernottamento presso Fretheim Hotel, Flam, Norvegia.",
  "",
  "GIORNO 3 - 16 giugno 2027 - BERGEN",
  "Navigazione sul Naeroyfjord e proseguimento verso Bergen.",
  "Visita del quartiere storico Bryggen.",
  "Fine dei servizi.",
  "",
  "SERVIZI INCLUSI",
  "Trasferimenti, treni e navigazione indicati, due pernottamenti con prima colazione e cena del primo giorno.",
];

const chileSource = [
  "PREVENTIVO CILE - SANTIAGO E VALPARAISO",
  "Codice preventivo: CL-2027-09",
  "Cliente: Gruppo Andes - 6 adulti",
  "Periodo: 5-7 novembre 2027",
  "Valuta: CLP",
  "",
  "GIORNO 1 - 5 novembre 2027 - SANTIAGO DEL CILE",
  "Arrivo e trasferimento in centro.",
  "Visita della Plaza de Armas e del Museo Cileno di Arte Precolombiana.",
  "Pernottamento presso Hotel Cumbres Lastarria, Santiago del Cile, Cile.",
  "",
  "GIORNO 2 - 6 novembre 2027 - VALPARAISO",
  "Trasferimento a Valparaiso.",
  "Visita dei quartieri Cerro Alegre e Cerro Concepcion.",
  "Pranzo incluso in ristorante locale.",
  "Pernottamento presso Hotel Casa Higueras, Valparaiso, Cile.",
  "",
  "GIORNO 3 - 7 novembre 2027 - SANTIAGO DEL CILE",
  "Rientro a Santiago del Cile e visita del Cerro San Cristobal.",
  "Trasferimento in aeroporto e fine dei servizi.",
  "",
  "LA QUOTA INCLUDE",
  "Trasferimenti descritti, due pernottamenti con prima colazione, pranzo del secondo giorno e visite indicate.",
].join("\n");

const multiCountryOcr = `
TOUR ADRIATICO - ITALIA, SLOVENIA E CROAZIA
Codice: MC-2027-12
Cliente: Gruppo Confini - 10 viaggiatori
Periodo: 2-5 settembre 2027
Valuta: EUR

GIORNO 1 - 2 settembre 2027 - TRIESTE - ITALIA
Visita di Piazza Unita d'Italia e del Castello di Miramare.
Pernottamento presso Savoia Excelsior Palace, Trieste, Italia.

GIORNO 2 - 3 settembre 2027 - LUBIANA - SLOVENIA
Trasferimento a Lubiana. Visita del Ponte Triplo e del Castello di Lubiana.
Cena inclusa in ristorante locale.
Pernottamento presso Grand Plaza Hotel Ljubljana, Lubiana, Slovenia.

GIORNO 3 - 4 settembre 2027 - POSTUMIA E ROVIGNO
Visita delle Grotte di Postumia in Slovenia e proseguimento per Rovigno in Croazia.
Passeggiata nel centro storico di Rovigno.
Pernottamento presso Grand Park Hotel Rovinj, Rovigno, Croazia.

GIORNO 4 - 5 settembre 2027 - POLA - CROAZIA
Visita dell'Arena di Pola e rientro a Trieste.
Fine dei servizi.

SERVIZI INCLUSI
Trasferimenti, tre pernottamenti, visite indicate e cena del secondo giorno.
`;

async function pdfBytes(lines: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  let y = 805;
  for (const line of lines) {
    if (y < 45) {
      page = pdf.addPage([595, 842]);
      y = 805;
    }
    page.drawText(line, { x: 42, y, size: 10, font, color: rgb(0, 0, 0) });
    y -= 17;
  }
  return pdf.save({ useObjectStreams: true });
}

async function docxBytes(text: string) {
  const document = new Document({
    sections: [{ children: text.split("\n").map((line) => new Paragraph({ children: [new TextRun(line)] })) }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function countryMatches(actual: string, expected: string) {
  const aliases: Record<string, string[]> = {
    norvegia: ["norvegia", "norway"],
    cile: ["cile", "chile"],
    italia: ["italia", "italy"],
    slovenia: ["slovenia"],
    croazia: ["croazia", "croatia"],
  };
  const expectedKey = normalized(expected);
  return (aliases[expectedKey] ?? [expectedKey]).some((alias) => normalized(actual).includes(alias));
}

async function validateImport(expected: ExpectedImport) {
  const extracted = await withAiTestReplay(expected.scenario, () =>
    extractTravelProgrammeWithBedrock(expected.bytes, expected.filename),
  );
  const { draft } = extracted;
  if (process.env.AI_TEST_MODE === "live" && !extracted.usage.specializedExtraction) {
    throw new Error(`${expected.scenario}: telemetria dell'estrazione specialistica accorpata mancante`);
  }
  if (extracted.provider !== `amazon-bedrock-native-${expected.provider}`) {
    throw new Error(`${expected.scenario}: provider inatteso ${extracted.provider}`);
  }
  if (draft.days.length !== expected.days) {
    throw new Error(`${expected.scenario}: attese ${expected.days} giornate, ottenute ${draft.days.length}`);
  }
  if (draft.startDate !== draft.days[0]?.date || draft.endDate !== draft.days.at(-1)?.date) {
    throw new Error(`${expected.scenario}: date complessive non coerenti con le giornate`);
  }
  if (draft.days.some((day) => day.activities.some((activity) => activity.startsAt || activity.endsAt))) {
    throw new Error(`${expected.scenario}: sono stati inventati orari assenti dalla fonte`);
  }
  for (const country of expected.countries) {
    if (!draft.days.some((day) => countryMatches(day.country, country))) {
      throw new Error(`${expected.scenario}: paese per giornata non estratto: ${country}`);
    }
  }
  const cities = draft.days.map((day) => normalized(day.city));
  for (const city of expected.cities) {
    if (!cities.some((value) => value.includes(normalized(city)))) {
      throw new Error(`${expected.scenario}: città predominante non estratta: ${city}`);
    }
  }
  if (normalized(draft.commercialDetails.currency) !== normalized(expected.currency)) {
    throw new Error(`${expected.scenario}: valuta inattesa ${draft.commercialDetails.currency}`);
  }
  const hotels = draft.days
    .flatMap((day) => [day.accommodation, ...day.additionalAccommodations])
    .map((hotel) => normalized(hotel.name))
    .filter(Boolean);
  for (const hotel of expected.hotelFragments) {
    if (!hotels.some((value) => value.includes(normalized(hotel)))) {
      throw new Error(`${expected.scenario}: hotel non estratto: ${hotel}`);
    }
  }
  if (!draft.extractionEvidence.some((evidence) => evidence.method === expected.evidenceMethod)) {
    throw new Error(`${expected.scenario}: evidenze ${expected.evidenceMethod} mancanti`);
  }
  if (!draft.extractionEvidence.some((evidence) => evidence.fieldPath.includes("commercialDetails"))) {
    throw new Error(`${expected.scenario}: evidenze commerciali mancanti`);
  }
  const activities = draft.days.flatMap((day) => day.activities);
  const visits = activities.filter((activity) => activity.type === "visit");
  if (visits.length < expected.minimumVisits) {
    throw new Error(`${expected.scenario}: visite insufficienti ${visits.length}/${expected.minimumVisits}`);
  }
  for (const day of draft.days) {
    const keys = day.activities.map((activity) => `${activity.type}:${normalized(activity.title)}`);
    if (new Set(keys).size !== keys.length)
      throw new Error(`${expected.scenario}: attività duplicate nel giorno ${day.dayNumber}`);
  }
  return {
    scenario: expected.scenario,
    provider: extracted.provider,
    days: draft.days.length,
    countries: [...new Set(draft.days.map((day) => day.country))],
    cities: draft.days.map((day) => day.city),
    visits: visits.length,
    hotels: hotels.length,
    currency: draft.commercialDetails.currency,
    evidence: draft.extractionEvidence.length,
    reconciliationIssues: draft.reconciliationIssues.length,
    usage: extracted.usage,
  };
}

async function main() {
  const scenarios: ExpectedImport[] = [
    {
      scenario: "travel-import-norvegia-pdf-v1",
      filename: "preventivo-norvegia.pdf",
      bytes: await pdfBytes(norwaySource),
      days: 3,
      countries: ["Norvegia"],
      cities: ["Oslo", "Flam", "Bergen"],
      currency: "NOK",
      hotelFragments: ["Thon Hotel Opera", "Fretheim Hotel"],
      minimumVisits: 4,
      provider: "pdf",
      evidenceMethod: "bedrock_native",
    },
    {
      scenario: "travel-import-cile-docx-v1",
      filename: "preventivo-cile.docx",
      bytes: await docxBytes(chileSource),
      days: 3,
      countries: ["Cile"],
      cities: ["Santiago", "Valparaiso"],
      currency: "CLP",
      hotelFragments: ["Cumbres Lastarria", "Casa Higueras"],
      minimumVisits: 5,
      provider: "docx",
      evidenceMethod: "bedrock_native",
    },
    {
      scenario: "travel-import-multipaese-ocr-v1",
      filename: "preventivo-multipaese.pdf.ocr.txt",
      bytes: new TextEncoder().encode(multiCountryOcr),
      days: 4,
      countries: ["Italia", "Slovenia", "Croazia"],
      cities: ["Trieste", "Lubiana", "Rovigno", "Pola"],
      currency: "EUR",
      hotelFragments: ["Savoia Excelsior", "Grand Plaza", "Grand Park"],
      minimumVisits: 7,
      provider: "ocr-text",
      evidenceMethod: "textract",
    },
  ];
  const selectedScenario = process.argv[2]?.trim();
  const selected = selectedScenario
    ? scenarios.filter((scenario) => scenario.scenario === selectedScenario)
    : scenarios;
  if (selected.length === 0) throw new Error(`Scenario non trovato: ${selectedScenario}`);
  const results = [];
  for (const scenario of selected) results.push(await validateImport(scenario));
  console.log(JSON.stringify({ status: "passed", scenarios: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
