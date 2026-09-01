import { extractTravelProgrammeWithBedrock } from "../lib/platform/bedrock-travel-ai";
import { catalogValidationIssues } from "../lib/platform/import-schema";
import { createNormalizedTravelDocument, readNormalizedTravelDocument } from "../lib/platform/normalized-travel-document";

const source = `
PREVENTIVO DI VIAGGIO - BELGIO
Codice: ACC-BE-2026-01
Cliente: Gruppo Acceptance
Periodo: 10-11 ottobre 2026
Valuta: EUR

GIORNO 1 - 10 ottobre 2026 - BRUXELLES
Arrivo a Bruxelles e trasferimento in centro.
Visita della Grand-Place di Bruxelles.
Visita delle Galeries Royales Saint-Hubert.
Cena inclusa in ristorante locale.
Pernottamento presso Hotel Amigo, Bruxelles, Belgio.

GIORNO 2 - 11 ottobre 2026 - BRUGES
Trasferimento a Bruges.
Visita del Belfort di Bruges.
Visita della Piazza del Mercato di Bruges.
Rientro a Bruxelles.

SERVIZI INCLUSI
- Trasferimenti indicati nel programma
- Cena del primo giorno
- Pernottamento con prima colazione

CONDIZIONI
Preventivo soggetto a disponibilita al momento della conferma.
`;

async function main() {
const extracted = await extractTravelProgrammeWithBedrock(new TextEncoder().encode(source), "acceptance-belgio.ocr.txt");
const draft = extracted.draft;
if (draft.days.length !== 2) throw new Error(`Attese 2 giornate, ottenute ${draft.days.length}`);
if (!/belg/i.test(draft.destinationCountry)) throw new Error(`Paese inatteso: ${draft.destinationCountry}`);
if (draft.days.some((day) => day.activities.some((activity) => activity.startsAt || activity.endsAt))) {
  throw new Error("Bedrock ha introdotto orari non richiesti");
}
const visits = draft.days.flatMap((day) => day.activities.filter((activity) => activity.type === "visit"));
if (visits.length < 4) throw new Error(`Visite insufficienti: ${visits.length}`);
const meals = draft.days.flatMap((day) => day.activities.filter((activity) => activity.type === "meal"));
if (meals.length !== 1 || meals[0]?.includedInQuote !== true) throw new Error("Inclusione cena non rispettata");
if (!draft.days[0]?.accommodation.name.toLowerCase().includes("amigo")) throw new Error("Hotel non estratto");
if (!draft.extractionEvidence.length) throw new Error("Nessuna evidenza sorgente estratta");
if (!draft.extractionEvidence.some((item) => item.fieldPath.includes("commercialDetails"))) {
  throw new Error("Mancano evidenze per i dati commerciali");
}
if (!Array.isArray(draft.reconciliationIssues)) throw new Error("Riconciliazione non eseguita");

const normalizedBytes = await createNormalizedTravelDocument(draft, "acceptance-belgio.txt");
const roundTrip = await readNormalizedTravelDocument(normalizedBytes);
if (roundTrip.title !== draft.title || roundTrip.days.length !== draft.days.length) {
  throw new Error("Round-trip del preventivo normalizzato non coerente");
}

console.log(JSON.stringify({
  status: "passed",
  provider: extracted.provider,
  model: extracted.model,
  days: draft.days.length,
  visits: visits.length,
  mealsIncluded: meals.length,
  accommodations: draft.days.filter((day) => day.accommodation.name).length,
  commercialRows: draft.commercialDetails.includedServices.length,
  evidence: draft.extractionEvidence.length,
  reconciliationIssues: draft.reconciliationIssues.length,
  normalizedDocumentBytes: normalizedBytes.byteLength,
  validationIssues: catalogValidationIssues(draft),
  usage: extracted.usage,
}, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
