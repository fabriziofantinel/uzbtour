import { z } from "zod";

export const itineraryItemTypeSchema = z.enum([
  "visit",
  "transport",
  "flight",
  "train",
  "hotel",
  "meal",
  "free_time",
  "meeting",
  "other",
]);

export const extractionEvidenceSchema = z.object({
  fieldPath: z.string().min(1).max(300),
  sourcePage: z.number().int().positive().nullable().default(null),
  sourceText: z.string().min(1).max(1200),
  confidence: z.number().min(0).max(1),
  method: z.enum(["bedrock_native", "textract", "derived", "agent"]),
});

export const reconciliationIssueSchema = z.object({
  code: z.string().min(1).max(80),
  severity: z.enum(["warning", "blocking"]),
  fieldPath: z.string().max(300).default(""),
  message: z.string().min(1).max(1200),
  sourceText: z.string().max(1200).default(""),
  resolved: z.boolean().default(false),
});

export const catalogValidationSchema = z
  .object({
    needsValidation: z.boolean().default(true),
    reason: z.string().max(500).default("Da verificare prima della pubblicazione"),
  })
  .default({ needsValidation: true, reason: "Da verificare prima della pubblicazione" });

export const importedActivitySchema = z.object({
  type: itineraryItemTypeSchema.describe("Tipo normalizzato dell'attività"),
  title: z.string().min(1).max(240),
  description: z.string().max(3000),
  startsAt: z
    .string()
    .max(5)
    .describe("Orario HH:mm modificabile dall'agente; non viene proposto durante l'importazione"),
  endsAt: z
    .string()
    .max(5)
    .describe("Orario HH:mm modificabile dall'agente; non viene proposto durante l'importazione"),
  includedInQuote: z
    .boolean()
    .nullable()
    .default(null)
    .describe("Per i pasti presenti nel programma: true. I pasti non inclusi non devono essere creati"),
  placeName: z.string().max(240),
  placeCity: z.string().max(240).default(""),
  placeCountry: z.string().max(120).default(""),
  placeValidation: catalogValidationSchema,
});

export const importedAccommodationSchema = z.object({
  name: z.string().max(240),
  city: z.string().max(240),
  country: z.string().max(120).default(""),
  notes: z.string().max(2000),
  validation: catalogValidationSchema,
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
  accommodation: importedAccommodationSchema,
  additionalAccommodations: z.array(importedAccommodationSchema).max(10).default([]),
});

const emptyCommercialDetails = {
  agencyName: "",
  agencyContact: "",
  quoteCode: "",
  quoteVersion: "",
  quoteDate: "",
  clientName: "",
  travelerCount: null,
  adults: null,
  minors: null,
  guideLanguage: "",
  currency: "",
  pricingRows: [],
  includedServices: [],
  conditions: [],
  contacts: [],
};

export const commercialDetailsSchema = z
  .object({
    agencyName: z.string().max(240).default(""),
    agencyContact: z.string().max(500).default(""),
    quoteCode: z.string().max(120).default(""),
    quoteVersion: z.string().max(40).default(""),
    quoteDate: z.string().max(10).default(""),
    clientName: z.string().max(240).default(""),
    travelerCount: z.number().int().min(0).max(999).nullable().default(null),
    adults: z.number().int().min(0).max(999).nullable().default(null),
    minors: z.number().int().min(0).max(999).nullable().default(null),
    guideLanguage: z.string().max(120).default(""),
    currency: z.string().max(20).default(""),
    pricingRows: z
      .array(
        z.object({
          item: z.string().max(240),
          amount: z.string().max(120),
          currency: z.string().max(20).default(""),
          notes: z.string().max(1000).default(""),
        }),
      )
      .max(30)
      .default([]),
    includedServices: z
      .array(
        z.object({
          service: z.string().max(240),
          included: z.boolean(),
          details: z.string().max(2000).default(""),
        }),
      )
      .max(50)
      .default([]),
    conditions: z
      .array(
        z.object({
          field: z.string().max(240),
          value: z.string().max(4000),
        }),
      )
      .max(50)
      .default([]),
    contacts: z
      .array(
        z.object({
          role: z.string().max(120),
          name: z.string().max(240).default(""),
          phone: z.string().max(100).default(""),
          email: z.string().max(240).default(""),
          availability: z.string().max(240).default(""),
        }),
      )
      .max(30)
      .default([]),
  })
  .default(emptyCommercialDetails);

export const travelProgrammeDraftSchema = z.object({
  title: z.string().min(1).max(240),
  destinationCountry: z.string().max(120),
  startDate: z.string().max(10).default("").describe("Data iniziale YYYY-MM-DD oppure stringa vuota"),
  endDate: z.string().max(10).default("").describe("Data finale YYYY-MM-DD oppure stringa vuota"),
  summary: z.string().max(6000),
  commercialDetails: commercialDetailsSchema,
  days: z.array(importedDaySchema).min(1).max(90),
  usefulInformation: z
    .array(
      z.object({
        category: z.string().min(1).max(80),
        title: z.string().min(1).max(240),
        body: z.string().min(1).max(6000),
        phone: z.string().max(100).default(""),
        url: z.string().max(500).default(""),
      }),
    )
    .max(80),
  extractionEvidence: z.array(extractionEvidenceSchema).max(1000).default([]),
  reconciliationIssues: z.array(reconciliationIssueSchema).max(200).default([]),
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
    for (const accommodation of [day.accommodation, ...day.additionalAccommodations]) {
      if (!accommodation.name.trim()) continue;
      if (!accommodation.city.trim()) issues.push(`${label}: hotel senza città`);
      if (!accommodation.country.trim()) issues.push(`${label}: hotel senza paese`);
      if (accommodation.validation.needsValidation) issues.push(`${label}: hotel “${accommodation.name}” da validare`);
    }
  }
  return issues;
}
