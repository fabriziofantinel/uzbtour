import { getSql } from "@/lib/db";
import type { TravelProgrammeDraft } from "./import-schema";

export type ReferenceTarget = { entityType: "country" | "city" | "site"; entityId: string; name: string };
export type DayReferences = { cityId?: string; siteIds: string[]; hotelId?: string };

function normalizedName(value: string) {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/\s+/g, " ");
}

function googleUrl(label: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(label)}`;
}

async function ensureCountry(name: string) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO countries (name, normalized_name, google_url)
    VALUES (${name.trim()}, ${normalizedName(name)}, ${googleUrl(name)})
    ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name, google_url = EXCLUDED.google_url, updated_at = NOW()
    RETURNING id::text, name
  `;
  return { id: String(rows[0].id), name: String(rows[0].name) };
}

async function ensureCity(countryId: string, countryName: string, name: string) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO cities (country_id, name, normalized_name, google_url)
    VALUES (${countryId}, ${name.trim()}, ${normalizedName(name)}, ${googleUrl(`${name}, ${countryName}`)})
    ON CONFLICT (country_id, normalized_name) DO UPDATE SET name = EXCLUDED.name, google_url = EXCLUDED.google_url, updated_at = NOW()
    RETURNING id::text, name
  `;
  return { id: String(rows[0].id), name: String(rows[0].name) };
}

async function ensureSite(cityId: string, cityName: string, countryName: string, name: string) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO visit_sites (city_id, name, normalized_name, google_url)
    VALUES (${cityId}, ${name.trim()}, ${normalizedName(name)}, ${googleUrl(`${name}, ${cityName}, ${countryName}`)})
    ON CONFLICT (city_id, normalized_name) DO UPDATE SET name = EXCLUDED.name, google_url = EXCLUDED.google_url, updated_at = NOW()
    RETURNING id::text, name
  `;
  return { id: String(rows[0].id), name: String(rows[0].name) };
}

async function ensureHotel(cityId: string, cityName: string, countryName: string, name: string) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO hotels (city_id, name, normalized_name, google_url)
    VALUES (${cityId}, ${name.trim()}, ${normalizedName(name)}, ${googleUrl(`${name}, ${cityName}, ${countryName}`)})
    ON CONFLICT (city_id, normalized_name) DO UPDATE SET name = EXCLUDED.name, google_url = EXCLUDED.google_url, updated_at = NOW()
    RETURNING id::text
  `;
  return String(rows[0].id);
}

export async function prepareTravelCatalog(draft: TravelProgrammeDraft) {
  const countryNames = draft.destinationCountry.split(/[,;/]+/).map((item) => item.trim()).filter(Boolean);
  if (countryNames.length === 0) throw new Error("Indica almeno un paese prima di pubblicare");
  const countries = await Promise.all(countryNames.map(ensureCountry));
  const primaryCountry = countries[0];
  const targets = new Map<string, ReferenceTarget>();
  countries.forEach((country) => targets.set(`country:${country.id}`, { entityType: "country", entityId: country.id, name: country.name }));

  const cityCache = new Map<string, { id: string; name: string }>();
  const dayReferences: DayReferences[] = [];
  for (const day of draft.days) {
    const cityName = (day.city || day.accommodation.city).trim();
    let city = cityCache.get(normalizedName(cityName));
    if (!city && cityName) {
      city = await ensureCity(primaryCountry.id, primaryCountry.name, cityName);
      cityCache.set(normalizedName(cityName), city);
      targets.set(`city:${city.id}`, { entityType: "city", entityId: city.id, name: city.name });
    }
    const siteIds: string[] = [];
    if (city) {
      for (const activity of day.activities.filter((item) => item.type === "visit")) {
        const siteName = (activity.placeName || activity.title).trim();
        if (!siteName) continue;
        const site = await ensureSite(city.id, city.name, primaryCountry.name, siteName);
        siteIds.push(site.id);
        targets.set(`site:${site.id}`, { entityType: "site", entityId: site.id, name: site.name });
      }
    }
    const hotelId = city && day.accommodation.name.trim()
      ? await ensureHotel(city.id, city.name, primaryCountry.name, day.accommodation.name)
      : undefined;
    dayReferences.push({ cityId: city?.id, siteIds: [...new Set(siteIds)], hotelId });
  }
  return { countries, primaryCountry, dayReferences, targets: [...targets.values()] };
}
