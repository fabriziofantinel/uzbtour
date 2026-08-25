import { getSql } from "@/lib/db";
import type { TravelProgrammeDraft } from "./import-schema";
import { geocodeCity } from "./geocoding";

export type ReferenceTarget = { entityType: "country" | "city" | "site"; entityId: string; name: string };
export type DayReferences = { cityIds: string[]; siteIds: string[]; hotelId?: string };

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
    RETURNING id::text, name, latitude, longitude
  `;
  const city = rows[0];
  if (city.latitude == null || city.longitude == null) {
    try {
      const coordinates = await geocodeCity(String(city.name), countryName);
      if (coordinates) {
        await sql`
          UPDATE cities
          SET latitude = ${coordinates.latitude}, longitude = ${coordinates.longitude}, updated_at = NOW()
          WHERE id = ${String(city.id)} AND (latitude IS NULL OR longitude IS NULL)
        `;
      }
    } catch (error) {
      console.warn(`Coordinate non recuperate per ${String(city.name)}`, error instanceof Error ? error.message : error);
    }
  }
  return { id: String(city.id), name: String(city.name) };
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
  const countryNames = [
    ...draft.destinationCountry.split(/[,;/]+/),
    ...draft.days.flatMap((day) => [
      day.country,
      day.accommodation.country,
      ...day.activities.filter((activity) => activity.type === "visit").map((activity) => activity.placeCountry),
    ]),
  ].map((item) => item.trim()).filter(Boolean);
  const uniqueCountryNames = [...new Map(countryNames.map((name) => [normalizedName(name), name])).values()];
  if (uniqueCountryNames.length === 0) throw new Error("Indica almeno un paese prima di pubblicare");
  const countries = await Promise.all(uniqueCountryNames.map(ensureCountry));
  const primaryCountry = countries[0];
  const countryByName = new Map(countries.map((country) => [normalizedName(country.name), country]));
  const targets = new Map<string, ReferenceTarget>();
  countries.forEach((country) => targets.set(`country:${country.id}`, { entityType: "country", entityId: country.id, name: country.name }));

  const cityCache = new Map<string, { id: string; name: string }>();
  async function resolveCity(countryName: string, cityName: string) {
    const country = countryByName.get(normalizedName(countryName)) ?? primaryCountry;
    const cacheKey = `${country.id}:${normalizedName(cityName)}`;
    let city = cityCache.get(cacheKey);
    if (!city && cityName.trim()) {
      city = await ensureCity(country.id, country.name, cityName);
      cityCache.set(cacheKey, city);
      targets.set(`city:${city.id}`, { entityType: "city", entityId: city.id, name: city.name });
    }
    return { country, city };
  }
  const dayReferences: DayReferences[] = [];
  for (const day of draft.days) {
    const dayLocation = await resolveCity(day.country, day.city);
    const cityIds = dayLocation.city ? [dayLocation.city.id] : [];
    const siteIds: string[] = [];
    for (const activity of day.activities.filter((item) => item.type === "visit")) {
      const siteName = activity.placeName.trim();
      if (!siteName) continue;
      const location = await resolveCity(activity.placeCountry, activity.placeCity);
      if (!location.city) continue;
      cityIds.push(location.city.id);
      const site = await ensureSite(location.city.id, location.city.name, location.country.name, siteName);
      siteIds.push(site.id);
      targets.set(`site:${site.id}`, { entityType: "site", entityId: site.id, name: site.name });
    }
    const hotelLocation = day.accommodation.name.trim()
      ? await resolveCity(day.accommodation.country, day.accommodation.city)
      : null;
    if (hotelLocation?.city) cityIds.push(hotelLocation.city.id);
    const hotelId = hotelLocation?.city && day.accommodation.name.trim()
      ? await ensureHotel(
          hotelLocation.city.id,
          hotelLocation.city.name,
          hotelLocation.country.name,
          day.accommodation.name
        )
      : undefined;
    dayReferences.push({ cityIds: [...new Set(cityIds)], siteIds: [...new Set(siteIds)], hotelId });
  }
  return { countries, primaryCountry, dayReferences, targets: [...targets.values()] };
}
