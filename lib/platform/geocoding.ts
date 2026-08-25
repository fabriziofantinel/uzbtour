type GeocodingResult = {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  feature_code?: string;
  population?: number;
};

type GeocodingResponse = {
  results?: GeocodingResult[];
};

export type CityCoordinates = { latitude: number; longitude: number };

let countryCodesByName: Map<string, string> | null = null;

function normalizedName(value: string) {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/\s+/g, " ");
}

function countryCodeForName(countryName: string) {
  const target = normalizedName(countryName);
  if (!target) return "";
  if (!countryCodesByName) {
    countryCodesByName = new Map();
    const locales = ["it", "en", "fr", "de", "es"];
    for (const locale of locales) {
      const names = new Intl.DisplayNames([locale], { type: "region" });
      for (let first = 65; first <= 90; first += 1) {
        for (let second = 65; second <= 90; second += 1) {
          const code = String.fromCharCode(first, second);
          const label = names.of(code);
          if (label && label !== code) countryCodesByName.set(normalizedName(label), code);
        }
      }
    }
  }
  return countryCodesByName.get(target) || "";
}

function validCoordinates(latitude: unknown, longitude: unknown): latitude is number {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function resultScore(result: GeocodingResult, cityName: string, countryName: string) {
  let score = 0;
  if (normalizedName(result.name || "") === normalizedName(cityName)) score += 100;
  if (normalizedName(result.country || "") === normalizedName(countryName)) score += 50;
  if ((result.feature_code || "").startsWith("PPL")) score += 20;
  score += Math.min(15, Math.log10(Math.max(1, result.population || 1)) * 2);
  return score;
}

async function search(query: string, countryCode = "", language = "it") {
  const endpoint = new URL(process.env.GEOCODING_API_URL || "https://geocoding-api.open-meteo.com/v1/search");
  endpoint.searchParams.set("name", query);
  endpoint.searchParams.set("count", "20");
  endpoint.searchParams.set("language", language);
  endpoint.searchParams.set("format", "json");
  if (countryCode) endpoint.searchParams.set("countryCode", countryCode);
  if (process.env.GEOCODING_API_KEY) endpoint.searchParams.set("apikey", process.env.GEOCODING_API_KEY);

  const response = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Geocoding non disponibile (${response.status})`);
  return (await response.json() as GeocodingResponse).results || [];
}

export async function geocodeCity(cityName: string, countryName: string): Promise<CityCoordinates | null> {
  const city = cityName.trim();
  const country = countryName.trim();
  if (!city) return null;

  const countryCode = countryCodeForName(country);
  let results = await search(city, countryCode);
  if (results.length === 0 && countryCode) results = await search(city, countryCode, "en");
  if (results.length === 0 && country && !countryCode) results = await search(`${city}, ${country}`);
  if (results.length === 0 && !countryCode) results = await search(city);
  const ranked = results
    .filter((result) => validCoordinates(result.latitude, result.longitude))
    .sort((left, right) => resultScore(right, city, country) - resultScore(left, city, country));
  const best = ranked[0];
  return best && validCoordinates(best.latitude, best.longitude)
    ? { latitude: Number(best.latitude), longitude: Number(best.longitude) }
    : null;
}
