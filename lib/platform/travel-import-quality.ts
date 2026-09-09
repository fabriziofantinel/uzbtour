import { travelProgrammeDraftSchema, type TravelProgrammeDraft } from "./import-schema";

type Issue = TravelProgrammeDraft["reconciliationIssues"][number];

function issue(code: string, severity: Issue["severity"], fieldPath: string, message: string): Issue {
  return { code, severity, fieldPath, message, sourceText: "", resolved: false };
}
function dateValue(value: string) {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  return Number.isFinite(time) ? time : null;
}
function key(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function deterministicImportIssues(draftInput: TravelProgrammeDraft): Issue[] {
  const draft = travelProgrammeDraftSchema.parse(draftInput);
  const issues: Issue[] = [];
  const start = dateValue(draft.startDate),
    end = dateValue(draft.endDate);
  if (start !== null && end !== null && end < start)
    issues.push(issue("DATE_RANGE_INVALID", "blocking", "endDate", "La data finale precede la data iniziale."));
  draft.days.forEach((day, index) => {
    if (day.dayNumber !== index + 1)
      issues.push(
        issue(
          "DAY_SEQUENCE",
          "blocking",
          `days[${index}].dayNumber`,
          `Numero giornata ${day.dayNumber}: atteso ${index + 1}.`,
        ),
      );
    const dayDate = dateValue(day.date);
    if (dayDate !== null && start !== null && dayDate < start)
      issues.push(
        issue(
          "DAY_OUTSIDE_RANGE",
          "warning",
          `days[${index}].date`,
          "La giornata precede la data iniziale del viaggio.",
        ),
      );
    if (dayDate !== null && end !== null && dayDate > end)
      issues.push(
        issue("DAY_OUTSIDE_RANGE", "warning", `days[${index}].date`, "La giornata segue la data finale del viaggio."),
      );
    const seen = new Set<string>();
    day.activities.forEach((activity, activityIndex) => {
      const activityKey = `${activity.type}:${key(activity.title)}:${key(activity.placeCity)}`;
      if (seen.has(activityKey))
        issues.push(
          issue(
            "DUPLICATE_ACTIVITY",
            "warning",
            `days[${index}].activities[${activityIndex}]`,
            `Possibile attività duplicata: ${activity.title}.`,
          ),
        );
      seen.add(activityKey);
    });
    const stays = [day.accommodation, ...day.additionalAccommodations].filter((stay) => stay.name.trim());
    stays.forEach((stay, stayIndex) => {
      if (!stay.city.trim())
        issues.push(
          issue(
            "HOTEL_CITY_MISSING",
            "blocking",
            `days[${index}].${stayIndex ? `additionalAccommodations[${stayIndex - 1}]` : "accommodation"}.city`,
            `Città mancante per ${stay.name}.`,
          ),
        );
    });
  });
  const commercial = draft.commercialDetails;
  if (commercial.travelerCount !== null && (commercial.adults !== null || commercial.minors !== null)) {
    const parts = (commercial.adults ?? 0) + (commercial.minors ?? 0);
    if (parts !== commercial.travelerCount)
      issues.push(
        issue(
          "TRAVELER_TOTAL_MISMATCH",
          "blocking",
          "commercialDetails.travelerCount",
          `Viaggiatori totali ${commercial.travelerCount}, ma adulti e minori sommano ${parts}.`,
        ),
      );
  }
  if (
    commercial.pricingRows.some((row) => row.amount.trim()) &&
    !commercial.currency.trim() &&
    commercial.pricingRows.every((row) => !row.currency.trim())
  )
    issues.push(
      issue(
        "CURRENCY_MISSING",
        "blocking",
        "commercialDetails.currency",
        "Sono presenti prezzi senza una valuta indicata.",
      ),
    );
  if (draft.extractionEvidence.length > 0) {
    const evidencePaths = new Set(draft.extractionEvidence.map((evidence) => evidence.fieldPath));
    for (const required of ["title", "destinationCountry", "startDate", "endDate"]) {
      if (String(draft[required as keyof TravelProgrammeDraft] ?? "").trim() && !evidencePaths.has(required))
        issues.push(issue("EVIDENCE_MISSING", "warning", required, `Origine non disponibile per ${required}.`));
    }
  }
  return issues;
}

export function mergeReconciliationIssues(draft: TravelProgrammeDraft, aiIssues: Issue[] = []): TravelProgrammeDraft {
  const all = [...deterministicImportIssues(draft), ...aiIssues];
  const unique = new Map<string, Issue>();
  for (const item of all) {
    const issueKey = `${item.code}:${item.fieldPath}`;
    const current = unique.get(issueKey);
    if (!current || (current.severity === "warning" && item.severity === "blocking")) unique.set(issueKey, item);
  }
  return travelProgrammeDraftSchema.parse({ ...draft, reconciliationIssues: [...unique.values()] });
}
