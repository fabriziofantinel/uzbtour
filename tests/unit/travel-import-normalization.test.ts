import { describe, expect, test } from "vitest";
import { travelProgrammeDraftSchema, travelProgrammeMainExtractionSchema } from "../../lib/platform/import-schema";
import { deterministicImportIssues } from "../../lib/platform/travel-import-quality";
import { normalizeTravelProgramme } from "../../lib/platform/travel-programme-normalizer";

const validation = { needsValidation: false, reason: "Esplicito nel documento" };

function mainInput(day: Record<string, unknown> = {}) {
  return {
    documentAssessment: { classification: "travel_programme", confidence: 1, reason: "Itinerario leggibile" },
    title: "Viaggio di prova",
    destinationCountry: "Italia",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    summary: "",
    days: [
      {
        dayNumber: 1,
        date: "2026-08-01",
        label: "Giorno 1",
        title: "Sosta panoramica sulla montagna",
        country: "Italia",
        countryValidation: validation,
        city: "Roma",
        cityValidation: validation,
        description: "Programma della giornata",
        ...day,
      },
    ],
    usefulInformation: [],
  };
}

describe("travel import normalization", () => {
  test("uses the day title when the model omits the day description", () => {
    const normalized = normalizeTravelProgramme(mainInput({ description: undefined })).value;
    const result = travelProgrammeMainExtractionSchema.parse(normalized);

    expect(result.days[0].description).toBe("Sosta panoramica sulla montagna");
  });

  test("preserves a meaningful visit title instead of replacing it with a generic place", () => {
    const normalized = normalizeTravelProgramme({
      ...mainInput(),
      commercialDetails: {},
      extractionEvidence: [],
      reconciliationIssues: [],
      days: [
        {
          ...mainInput().days[0],
          activities: [
            {
              type: "visit",
              title: "Sosta panoramica",
              description: "Vista dalla montagna",
              startsAt: "",
              endsAt: "",
              includedInQuote: true,
              placeName: "Montagna",
              placeCity: "Roma",
              placeCountry: "Italia",
              placeValidation: validation,
            },
          ],
          accommodation: { name: "", city: "", country: "", notes: "", validation },
          additionalAccommodations: [],
        },
      ],
    }).value;
    const result = travelProgrammeDraftSchema.parse(normalized);

    expect(result.days[0].activities[0].title).toBe("Sosta panoramica");
  });

  test("does not report missing evidence when the extraction mode intentionally omits evidence", () => {
    const draft = travelProgrammeDraftSchema.parse({
      ...mainInput(),
      commercialDetails: {},
      extractionEvidence: [],
      reconciliationIssues: [],
      days: [
        {
          ...mainInput().days[0],
          activities: [],
          accommodation: { name: "", city: "", country: "", notes: "", validation },
          additionalAccommodations: [],
        },
      ],
    });

    expect(deterministicImportIssues(draft).some((issue) => issue.code === "EVIDENCE_MISSING")).toBe(false);
  });
});
