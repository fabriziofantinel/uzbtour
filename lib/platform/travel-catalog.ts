import { getSql } from "@/lib/db";
import type { TravelProgrammeDraft } from "./import-schema";
import { countryCodeForName, geocodeCity } from "./geocoding";

export type ReferenceTarget = { entityType: "country" | "city" | "site"; entityId: string; name: string };
export type DayReferences = { cityIds: string[]; siteIds: string[]; hotelId?: string; hotelIds: string[] };

function normalizedName(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/\s+/g, " ");
}

function googleUrl(label: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(label)}`;
}

async function ensureCountry(actorId: string, agencyId: string, name: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT id::text,name FROM app.upsert_reference_catalog_v3(${actorId}::uuid,${agencyId},
      'country',NULL,${countryCodeForName(name)},${name.trim()},${normalizedName(name)},
      ${googleUrl(name)},NULL,NULL)
  `;
  return { id: String(rows[0].id), name: String(rows[0].name) };
}

async function ensureCity(actorId: string, agencyId: string, countryId: string, countryName: string, name: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT id::text,name,latitude,longitude FROM app.upsert_reference_catalog_v3(
      ${actorId}::uuid,${agencyId},'city',${countryId},NULL,${name.trim()},${normalizedName(name)},
      ${googleUrl(`${name}, ${countryName}`)},NULL,NULL)
  `;
  const city = rows[0];
  if (city.latitude == null || city.longitude == null) {
    try {
      const coordinates = await geocodeCity(String(city.name), countryName);
      if (coordinates) {
        await sql`SELECT id FROM app.upsert_reference_catalog_v3(${actorId}::uuid,${agencyId},
          'city',${countryId},NULL,${name.trim()},${normalizedName(name)},
          ${googleUrl(`${name}, ${countryName}`)},${coordinates.latitude},${coordinates.longitude})`;
      }
    } catch (error) {
      console.warn(
        `Coordinate non recuperate per ${String(city.name)}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { id: String(city.id), name: String(city.name) };
}

async function ensureSite(
  actorId: string,
  agencyId: string,
  cityId: string,
  cityName: string,
  countryName: string,
  name: string,
) {
  const sql = getSql();
  const rows = await sql`
    SELECT id::text,name FROM app.upsert_reference_catalog_v3(${actorId}::uuid,${agencyId},
      'site',${cityId},NULL,${name.trim()},${normalizedName(name)},
      ${googleUrl(`${name}, ${cityName}, ${countryName}`)},NULL,NULL)
  `;
  return { id: String(rows[0].id), name: String(rows[0].name) };
}

async function ensureHotel(
  actorId: string,
  agencyId: string,
  cityId: string,
  cityName: string,
  countryName: string,
  name: string,
) {
  const sql = getSql();
  const rows = await sql`
    SELECT id::text FROM app.upsert_reference_catalog_v3(${actorId}::uuid,${agencyId},
      'hotel',${cityId},NULL,${name.trim()},${normalizedName(name)},
      ${googleUrl(`${name}, ${cityName}, ${countryName}`)},NULL,NULL)
  `;
  return String(rows[0].id);
}

export async function prepareTravelCatalog(draft: TravelProgrammeDraft, scope: { actorId: string; agencyId: string }) {
  const countryNames = [
    ...draft.destinationCountry.split(/[,;/]+/),
    ...draft.days.flatMap((day) => [
      day.country,
      ...[day.accommodation, ...day.additionalAccommodations].map((accommodation) => accommodation.country),
      ...day.activities.filter((activity) => activity.type === "visit").map((activity) => activity.placeCountry),
    ]),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  const uniqueCountryNames = [...new Map(countryNames.map((name) => [normalizedName(name), name])).values()];
  if (uniqueCountryNames.length === 0) throw new Error("Indica almeno un paese prima di pubblicare");
  const countries = await Promise.all(
    uniqueCountryNames.map((name) => ensureCountry(scope.actorId, scope.agencyId, name)),
  );
  const primaryCountry = countries[0];
  const countryByName = new Map(countries.map((country) => [normalizedName(country.name), country]));
  const targets = new Map<string, ReferenceTarget>();
  countries.forEach((country) =>
    targets.set(`country:${country.id}`, { entityType: "country", entityId: country.id, name: country.name }),
  );

  const cityCache = new Map<string, { id: string; name: string }>();
  async function resolveCity(countryName: string, cityName: string) {
    const country = countryByName.get(normalizedName(countryName)) ?? primaryCountry;
    const cacheKey = `${country.id}:${normalizedName(cityName)}`;
    let city = cityCache.get(cacheKey);
    if (!city && cityName.trim()) {
      city = await ensureCity(scope.actorId, scope.agencyId, country.id, country.name, cityName);
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
      const site = await ensureSite(
        scope.actorId,
        scope.agencyId,
        location.city.id,
        location.city.name,
        location.country.name,
        siteName,
      );
      siteIds.push(site.id);
      targets.set(`site:${site.id}`, { entityType: "site", entityId: site.id, name: site.name });
    }
    const hotelIds: string[] = [];
    for (const accommodation of [day.accommodation, ...day.additionalAccommodations]) {
      if (!accommodation.name.trim()) continue;
      const hotelLocation = await resolveCity(accommodation.country, accommodation.city);
      if (!hotelLocation.city) continue;
      cityIds.push(hotelLocation.city.id);
      hotelIds.push(
        await ensureHotel(
          scope.actorId,
          scope.agencyId,
          hotelLocation.city.id,
          hotelLocation.city.name,
          hotelLocation.country.name,
          accommodation.name,
        ),
      );
    }
    dayReferences.push({
      cityIds: [...new Set(cityIds)],
      siteIds: [...new Set(siteIds)],
      hotelId: hotelIds[0],
      hotelIds,
    });
  }
  return { countries, primaryCountry, dayReferences, targets: [...targets.values()] };
}
