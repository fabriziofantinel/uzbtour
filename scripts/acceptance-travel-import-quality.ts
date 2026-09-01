import { strict as assert } from "node:assert";
import { travelProgrammeDraftSchema } from "../lib/platform/import-schema";
import { deterministicImportIssues, mergeReconciliationIssues } from "../lib/platform/travel-import-quality";

const draft = travelProgrammeDraftSchema.parse({
  title: "Cile essenziale",
  destinationCountry: "Cile",
  startDate: "2026-10-12",
  endDate: "2026-10-10",
  summary: "Programma di prova",
  commercialDetails: {
    travelerCount: 4,
    adults: 2,
    minors: 1,
    pricingRows: [{ item: "Quota individuale", amount: "2500", currency: "", notes: "" }],
  },
  days: [{
    dayNumber: 2,
    date: "2026-10-11",
    label: "Giorno 1",
    title: "Santiago",
    country: "Cile",
    city: "Santiago",
    description: "Visita della città",
    activities: [
      { type: "visit", title: "Plaza de Armas", description: "", startsAt: "", endsAt: "", placeName: "Plaza de Armas", placeCity: "Santiago", placeCountry: "Cile" },
      { type: "visit", title: "Plaza de Armas", description: "", startsAt: "", endsAt: "", placeName: "Plaza de Armas", placeCity: "Santiago", placeCountry: "Cile" },
    ],
    accommodation: { name: "Hotel Test", city: "", country: "Cile", notes: "" },
  }],
  usefulInformation: [],
});

const codes = new Set(deterministicImportIssues(draft).map((item) => item.code));
for (const code of ["DATE_RANGE_INVALID", "DAY_SEQUENCE", "DUPLICATE_ACTIVITY", "HOTEL_CITY_MISSING", "TRAVELER_TOTAL_MISMATCH", "CURRENCY_MISSING", "EVIDENCE_MISSING"]) {
  assert(codes.has(code), `Controllo non rilevato: ${code}`);
}

const merged = mergeReconciliationIssues(draft, [{
  code: "DATE_RANGE_INVALID", severity: "blocking", fieldPath: "endDate",
  message: "Duplicato dal revisore AI", sourceText: "12-10 ottobre", resolved: false,
}, {
  code: "SOURCE_CONTRADICTION", severity: "warning", fieldPath: "days[0].date",
  message: "La data nel riepilogo differisce.", sourceText: "11 ottobre", resolved: false,
}]);
assert.equal(merged.reconciliationIssues.filter((item) => item.code === "DATE_RANGE_INVALID").length, 1);
assert(merged.reconciliationIssues.some((item) => item.code === "SOURCE_CONTRADICTION"));

console.log(JSON.stringify({ status: "passed", detected: [...codes].sort(), mergedIssues: merged.reconciliationIssues.length }));
