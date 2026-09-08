import { describe, expect, test } from "vitest";
import { travelProgrammeDraftSchema, travelProgrammeMainExtractionSchema } from "../../lib/platform/import-schema";
import {
  assertImportableTravelDocument,
  assertTravelDocumentAssessment,
  TravelImportAbstentionError,
} from "../../lib/platform/travel-import-eligibility";

function draft(documentAssessment: unknown, day: Record<string, unknown> = {}) {
  return travelProgrammeDraftSchema.parse({
    documentAssessment,
    title: "Viaggio di prova",
    destinationCountry: "Italia",
    startDate: "",
    endDate: "",
    summary: "",
    commercialDetails: {},
    days: [
      {
        dayNumber: 1,
        date: "",
        label: "Giorno 1",
        title: "Arrivo",
        country: "Italia",
        countryValidation: { needsValidation: false, reason: "Esplicito" },
        city: "Roma",
        cityValidation: { needsValidation: false, reason: "Esplicito" },
        description: "Arrivo a Roma e trasferimento verso la sistemazione prevista.",
        activities: [],
        accommodation: {
          name: "",
          city: "",
          country: "",
          notes: "",
          validation: { needsValidation: false, reason: "Non indicato" },
        },
        ...day,
      },
    ],
    usefulInformation: [],
    extractionEvidence: [],
    reconciliationIssues: [],
  });
}

describe("travel import eligibility", () => {
  test.each([
    ["unreadable", "Documento non sufficientemente leggibile"],
    ["not_travel_programme", "non è stato riconosciuto come programma di viaggio"],
  ])("abstains for %s documents", (classification, message) => {
    expect(() =>
      assertImportableTravelDocument(draft({ classification, confidence: 0.95, reason: "Esito di prova" })),
    ).toThrow(message);
  });

  test("abstains when classification confidence is insufficient", () => {
    expect(() =>
      assertImportableTravelDocument(
        draft({ classification: "travel_programme", confidence: 0.3, reason: "Contenuto ambiguo" }),
      ),
    ).toThrow(TravelImportAbstentionError);
  });

  test("rejects an empty synthetic day even when classified as a programme", () => {
    expect(() =>
      assertImportableTravelDocument(
        draft(
          { classification: "travel_programme", confidence: 0.9, reason: "Possibile itinerario" },
          { city: "", description: "" },
        ),
      ),
    ).toThrow("non contiene giornate, attività o sistemazioni sufficienti");
  });

  test("accepts a substantive itinerary", () => {
    expect(() =>
      assertImportableTravelDocument(
        draft({ classification: "travel_programme", confidence: 0.9, reason: "Itinerario leggibile" }),
      ),
    ).not.toThrow();
  });

  test("allows an empty main extraction so a non-travel document can abstain", () => {
    const result = travelProgrammeMainExtractionSchema.parse({
      documentAssessment: {
        classification: "not_travel_programme",
        confidence: 0.99,
        reason: "Elenco di una competizione sportiva",
      },
      title: "Documento caricato",
      destinationCountry: "",
      startDate: "",
      endDate: "",
      summary: "",
      days: [],
      usefulInformation: [],
    });

    expect(result.days).toEqual([]);
    expect(() => assertTravelDocumentAssessment(result.documentAssessment)).toThrow(
      "non è stato riconosciuto come programma di viaggio",
    );
  });
});
