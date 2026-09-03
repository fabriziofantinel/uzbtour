import type { TravelProgrammeDraft } from "./import-schema";

export class TravelImportAbstentionError extends Error {
  readonly code = "TRAVEL_IMPORT_ABSTAINED";

  constructor(message: string) {
    super(message);
    this.name = "TravelImportAbstentionError";
  }
}

export function assertImportableTravelDocument(draft: TravelProgrammeDraft) {
  const assessment = draft.documentAssessment;
  if (assessment.classification === "unreadable") {
    throw new TravelImportAbstentionError(
      `Documento non sufficientemente leggibile. Carica un PDF o DOCX più nitido. Motivo: ${assessment.reason}`,
    );
  }
  if (assessment.classification === "not_travel_programme") {
    throw new TravelImportAbstentionError(
      `Il documento non è stato riconosciuto come programma di viaggio. Motivo: ${assessment.reason}`,
    );
  }
  if (assessment.confidence < 0.5) {
    throw new TravelImportAbstentionError(
      `Non è possibile confermare che il documento contenga un programma di viaggio. Motivo: ${assessment.reason}`,
    );
  }

  const hasSubstantiveDay = draft.days.some(
    (day) =>
      day.activities.length > 0 ||
      Boolean(day.accommodation.name.trim()) ||
      day.description.trim().length >= 30 ||
      Boolean(day.city.trim()),
  );
  if (!hasSubstantiveDay) {
    throw new TravelImportAbstentionError(
      "Il documento non contiene giornate, attività o sistemazioni sufficienti per creare un programma.",
    );
  }
}
