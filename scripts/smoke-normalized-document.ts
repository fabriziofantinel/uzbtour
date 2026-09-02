import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  createNormalizedTravelDocument,
  readNormalizedTravelDocument,
} from "../lib/platform/normalized-travel-document";
import type { TravelProgrammeDraft } from "../lib/platform/import-schema";

const validation = { needsValidation: true, reason: "Da verificare" };
const draft: TravelProgrammeDraft = {
  title: "Viaggio prova in Uzbekistan",
  destinationCountry: "Uzbekistan",
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  summary: "Itinerario di prova per verificare il formato normalizzato.",
  commercialDetails: {
    agencyName: "SMF Travel",
    agencyContact: "agenzia@example.com",
    quoteCode: "UZB-2026",
    quoteVersion: "2",
    quoteDate: "2026-07-01",
    clientName: "Famiglia Prova",
    travelerCount: 3,
    adults: 3,
    minors: 0,
    guideLanguage: "Italiano",
    currency: "EUR",
    pricingRows: [{ item: "Quota individuale", amount: "2.000", currency: "EUR", notes: "Camera doppia" }],
    includedServices: [{ service: "Pernottamenti", included: true, details: "Hotel da programma" }],
    conditions: [{ field: "Validità", value: "30 giorni" }],
    contacts: [
      {
        role: "Agente",
        name: "Mario Rossi",
        phone: "+39 000",
        email: "agenzia@example.com",
        availability: "Orario ufficio",
      },
    ],
  },
  days: [
    {
      dayNumber: 1,
      date: "2026-08-01",
      label: "Giorno 1",
      title: "Arrivo a Tashkent",
      country: "Uzbekistan",
      countryValidation: validation,
      city: "Tashkent",
      cityValidation: validation,
      description: "Arrivo e prima visita della città.",
      activities: [
        {
          type: "visit",
          title: "Piazza Amir Temur",
          description: "Visita guidata.",
          startsAt: "",
          endsAt: "",
          includedInQuote: true,
          placeName: "Piazza Amir Temur",
          placeCity: "Tashkent",
          placeCountry: "Uzbekistan",
          placeValidation: validation,
        },
        {
          type: "meal",
          title: "Colazione in hotel",
          description: "Colazione prevista dal programma.",
          startsAt: "",
          endsAt: "",
          includedInQuote: true,
          placeName: "",
          placeCity: "",
          placeCountry: "",
          placeValidation: validation,
        },
      ],
      accommodation: {
        name: "Hotel prova",
        city: "Tashkent",
        country: "Uzbekistan",
        notes: "Prima colazione inclusa",
        validation,
      },
      additionalAccommodations: [
        {
          name: "Hotel seconda notte",
          city: "Tashkent",
          country: "Uzbekistan",
          notes: "Pernottamento dopo la giornata",
          validation,
        },
      ],
    },
  ],
  usefulInformation: [
    {
      category: "Emergenze",
      title: "Numero unico",
      body: "Contattare il referente locale in caso di necessità.",
      phone: "112",
      url: "",
    },
  ],
  extractionEvidence: [],
  reconciliationIssues: [],
};

async function main() {
  const bytes = await createNormalizedTravelDocument(draft, "preventivo-originale.pdf");
  assert.ok(bytes.byteLength > 10_000, "Il DOCX generato è troppo piccolo");
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  assert.ok(xml, "Il DOCX non contiene word/document.xml");
  const visibleText = xml.replace(/<[^>]+>/g, "");
  assert.match(visibleText, /Hotel seconda notte/, "Il secondo pernottamento non è presente nel DOCX");
  assert.doesNotMatch(visibleText, /Incluso|Non incluso|N\/S/, "Il DOCX non deve mostrare una colonna di inclusione");
  const reread = await readNormalizedTravelDocument(bytes);
  assert.deepEqual(reread, draft, "Il payload riletto non coincide con la bozza normalizzata");
  if (process.argv[2]) await writeFile(process.argv[2], bytes);
  console.log(JSON.stringify({ ok: true, bytes: bytes.byteLength, title: reread.title, days: reread.days.length }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
