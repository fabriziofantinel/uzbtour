import { z } from "zod";
import { countryUsefulInfoCategories, countryUsefulInfoSchema } from "./reference-content-normalizer";

const sourceSchema = z.object({
  category: z.string().trim().min(1),
  title: z.string().trim().min(1),
  url: z.string().url(),
});

export const verifiedCountryProfileSchema = z.object({
  countryName: z.string().trim().min(2),
  iso2: z.string().trim().regex(/^[A-Z]{2}$/),
  timeZones: z.array(z.string().trim().min(3)).min(1),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  usefulInfo: countryUsefulInfoSchema,
  sources: z.array(sourceSchema).min(4),
});

export type VerifiedCountryProfile = z.infer<typeof verifiedCountryProfileSchema>;

const sensitiveCategories = new Set([
  "Numeri di emergenza",
  "Ambasciata italiana",
  "Salute e assistenza",
  "Documenti e sicurezza",
]);

function normalizedUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function phoneTokens(value: string) {
  return [...value.matchAll(/\+?\d[\d\s()./-]{2,}\d/g)]
    .map((match) => match[0].replace(/\D/g, ""))
    .filter((token) => token.length >= 3);
}

export function validateVerifiedCountryProfile(
  input: unknown,
  citedUrls: string[],
  groundedText: string,
) {
  const profile = verifiedCountryProfileSchema.parse(input);
  const errors: string[] = [];
  const cited = new Set(citedUrls.map(normalizedUrl));
  const sourceUrls = new Set(profile.sources.map((source) => normalizedUrl(source.url)));

  if (new Set(profile.usefulInfo.map((section) => section.category)).size !== countryUsefulInfoCategories.length) {
    errors.push("Le categorie delle informazioni utili non sono univoche");
  }
  for (const zone of profile.timeZones) {
    try { new Intl.DateTimeFormat("it-IT", { timeZone: zone }).format(); }
    catch { errors.push(`Fuso IANA non valido: ${zone}`); }
  }
  for (const source of profile.sources) {
    if (!cited.has(normalizedUrl(source.url))) errors.push(`Fonte non presente nelle citazioni Grounding: ${source.url}`);
    const host = new URL(source.url).hostname.toLowerCase();
    if (/(^|\.)(wikipedia\.org|facebook\.com|instagram\.com|reddit\.com|tripadvisor\.[a-z.]+)$/.test(host)) {
      errors.push(`Fonte non istituzionale: ${source.url}`);
    }
  }
  for (const section of profile.usefulInfo) {
    if (!sensitiveCategories.has(section.category)) continue;
    const matchingSource = section.url
      ? profile.sources.find((source) => normalizedUrl(source.url) === normalizedUrl(section.url)
        && source.category === section.category)
      : undefined;
    if (!section.url || !sourceUrls.has(normalizedUrl(section.url)) || matchingSource?.category !== section.category) {
      errors.push(`Fonte verificabile assente per ${section.category}`);
    }
    for (const token of phoneTokens(section.phone)) {
      if (!groundedText.replace(/\D/g, "").includes(token)) {
        errors.push(`Recapito non riscontrato nel dossier per ${section.category}`);
      }
    }
  }
  const embassy = profile.usefulInfo.find((section) => section.category === "Ambasciata italiana");
  if (!embassy?.url || !/^https:\/\/[^/]+\.esteri\.it(?:\/|$)/i.test(embassy.url)) {
    errors.push("La fonte dell'ambasciata non appartiene a esteri.it");
  }
  if (!groundedText.toUpperCase().includes(profile.currencyCode)) {
    errors.push("Il codice valuta non è riscontrato nel dossier");
  }
  return { profile, errors: [...new Set(errors)] };
}
