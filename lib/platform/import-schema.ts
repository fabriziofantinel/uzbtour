import { z } from "zod";

export const itineraryItemTypeSchema = z.enum([
  "visit", "transport", "flight", "train", "hotel", "meal", "free_time", "meeting", "other",
]);

export const catalogValidationSchema = z.object({
  needsValidation: z.boolean().default(true),
  reason: z.string().max(500).default("Da verificare prima della pubblicazione"),
}).default({ needsValidation: true, reason: "Da verificare prima della pubblicazione" });

export const importedActivitySchema = z.object({
  type: itineraryItemTypeSchema.describe("Tipo normalizzato dell'attività"),
  title: z.string().min(1).max(240),
  description: z.string().max(3000),
  startsAt: z.string().max(5).describe("Orario HH:mm modificabile dall'agente; non viene proposto durante l'importazione"),
  endsAt: z.string().max(5).describe("Orario HH:mm modificabile dall'agente; non viene proposto durante l'importazione"),
  includedInQuote: z.boolean().nullable().default(null).describe("Per i pasti: true se incluso, false se escluso, null se non specificato"),
  placeName: z.string().max(240),
  placeCity: z.string().max(240).default(""),
  placeCountry: z.string().max(120).default(""),
  placeValidation: catalogValidationSchema,
});

export const importedDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(90),
  date: z.string().max(10).describe("Data YYYY-MM-DD oppure stringa vuota"),
  label: z.string().max(120),
  title: z.string().min(1).max(240),
  country: z.string().max(120).default(""),
  countryValidation: catalogValidationSchema,
  city: z.string().max(240),
  cityValidation: catalogValidationSchema,
  description: z.string().max(6000),
  activities: z.array(importedActivitySchema).max(40),
  accommodation: z.object({
    name: z.string().max(240),
    city: z.string().max(240),
    country: z.string().max(120).default(""),
    notes: z.string().max(2000),
    validation: catalogValidationSchema,
  }),
});

export const travelProgrammeDraftSchema = z.object({
  title: z.string().min(1).max(240),
  destinationCountry: z.string().max(120),
  startDate: z.string().max(10).default("").describe("Data iniziale YYYY-MM-DD oppure stringa vuota"),
  endDate: z.string().max(10).default("").describe("Data finale YYYY-MM-DD oppure stringa vuota"),
  summary: z.string().max(6000),
  days: z.array(importedDaySchema).min(1).max(90),
  usefulInformation: z.array(z.object({
    category: z.string().min(1).max(80),
    title: z.string().min(1).max(240),
    body: z.string().min(1).max(6000),
    phone: z.string().max(100).default(""),
    url: z.string().max(500).default(""),
  })).max(80),
});

export type TravelProgrammeDraft = z.infer<typeof travelProgrammeDraftSchema>;

export function catalogValidationIssues(draft: TravelProgrammeDraft) {
  const issues: string[] = [];
  for (const [index, day] of draft.days.entries()) {
    const label = `Giorno ${index + 1}`;
    if (!day.country.trim()) issues.push(`${label}: paese mancante`);
    else if (day.countryValidation.needsValidation) issues.push(`${label}: paese da validare`);
    if (!day.city.trim()) issues.push(`${label}: città mancante`);
    else if (day.cityValidation.needsValidation) issues.push(`${label}: città da validare`);
    for (const activity of day.activities.filter((item) => item.type === "visit")) {
      const site = activity.placeName.trim() || activity.title.trim() || "sito senza nome";
      if (!activity.placeName.trim()) issues.push(`${label}: sito “${site}” senza nome canonico`);
      if (!activity.placeCity.trim()) issues.push(`${label}: sito “${site}” senza città`);
      if (!activity.placeCountry.trim()) issues.push(`${label}: sito “${site}” senza paese`);
      if (activity.placeValidation.needsValidation) issues.push(`${label}: sito “${site}” da validare`);
    }
    if (day.accommodation.name.trim()) {
      if (!day.accommodation.city.trim()) issues.push(`${label}: hotel senza città`);
      if (!day.accommodation.country.trim()) issues.push(`${label}: hotel senza paese`);
      if (day.accommodation.validation.needsValidation) issues.push(`${label}: hotel “${day.accommodation.name}” da validare`);
    }
  }
  return issues;
}
