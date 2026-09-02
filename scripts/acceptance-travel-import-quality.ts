import { strict as assert } from "node:assert";
import { travelProgrammeDraftSchema } from "../lib/platform/import-schema";
import { deterministicImportIssues, mergeReconciliationIssues } from "../lib/platform/travel-import-quality";
import { normalizeTravelProgramme } from "../lib/platform/travel-programme-normalizer";

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

const normalized = normalizeTravelProgramme({
  ...draft,
  startDate: "2027-11-01",
  endDate: "2027-11-03",
  days: [
    { ...draft.days[0], dayNumber: 1, date: "2027-11-01", accommodation: undefined },
    { ...draft.days[0], dayNumber: 2, date: "2027-11-02" },
    { ...draft.days[0], dayNumber: 3, date: "2027-11-03" },
  ],
}, { sourceText: "GIORNO 1 - 5 novembre 2027\nPernottamento presso Hotel Cumbres Lastarria, Santiago.\nGIORNO 2 - 6 novembre 2027\nGIORNO 3 - 7 novembre 2027" });
const normalizedValue = travelProgrammeDraftSchema.parse(normalized.value);
assert.deepEqual(normalizedValue.days.map((day) => day.date), ["2027-11-05", "2027-11-06", "2027-11-07"]);
assert.equal(normalizedValue.startDate, "2027-11-05");
assert.equal(normalizedValue.endDate, "2027-11-07");
assert.equal(normalizedValue.days[0]?.accommodation.name, "");

const correctedHotel = normalizeTravelProgramme({
  ...draft,
  days: [{ ...draft.days[0], dayNumber: 1, accommodation: { ...draft.days[0].accommodation, name: "Hotel Cumbres Lasterra" } }],
}, { sourceText: "GIORNO 1 - 5 novembre 2027\nPernottamento presso Hotel Cumbres Lastarria, Santiago del Cile, Cile." });
assert.equal(travelProgrammeDraftSchema.parse(correctedHotel.value).days[0]?.accommodation.name, "Hotel Cumbres Lastarria");

console.log(JSON.stringify({ status: "passed", detected: [...codes].sort(), mergedIssues: merged.reconciliationIssues.length, sourceDateCorrections: 3 }));
