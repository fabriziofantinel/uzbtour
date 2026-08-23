import { z } from "zod";

export const itineraryItemTypeSchema = z.enum([
  "visit", "transport", "flight", "train", "hotel", "meal", "free_time", "meeting", "other",
]);

export const importedActivitySchema = z.object({
  type: itineraryItemTypeSchema.describe("Tipo normalizzato dell'attività"),
  title: z.string().min(1).max(240),
  description: z.string().max(3000),
  startsAt: z.string().max(5).describe("Ora HH:MM oppure stringa vuota"),
  endsAt: z.string().max(5).describe("Ora HH:MM oppure stringa vuota"),
  placeName: z.string().max(240),
});

export const importedDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(90),
  date: z.string().max(10).describe("Data YYYY-MM-DD oppure stringa vuota"),
  label: z.string().max(120),
  title: z.string().min(1).max(240),
  city: z.string().max(240),
  description: z.string().max(6000),
  activities: z.array(importedActivitySchema).max(40),
  accommodation: z.object({
    name: z.string().max(240),
    city: z.string().max(240),
    notes: z.string().max(2000),
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
