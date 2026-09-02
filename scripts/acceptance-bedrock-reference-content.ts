import { randomUUID } from "node:crypto";
import { generateReferenceContent } from "../lib/platform/reference-enrichment";
import { countryUsefulInfoCategories } from "../lib/platform/reference-content-normalizer";
import { verifiedCountryProfileSchema } from "../lib/platform/verified-country-profile";
import { withAiTestReplay } from "../lib/platform/ai-test-replay";

function assertPhotoValidation(items: Array<{ photoValidation?: { target: string; requiredFeatures: string[]; rejectIf: string[]; minimumConfidence: number } }>, label: string) {
  if (items.some((item) => !item.photoValidation || !item.photoValidation.target || item.photoValidation.requiredFeatures.length === 0 || item.photoValidation.rejectIf.length === 0 || item.photoValidation.minimumConfidence < 0.65)) {
    throw new Error(`Scheda fotografica dinamica non valida: ${label}`);
  }
}

function assertGames(games: Array<{ type: string; pairs?: unknown[]; options?: unknown[]; correctIndex?: number }>, label: string) {
  const types = games.map((game) => game.type);
  if (types.join(",") !== "photo_puzzle,memory,odd_one_out") throw new Error(`Tipi di gioco non validi: ${label}`);
  const memory = games.find((game) => game.type === "memory");
  const oddOneOut = games.find((game) => game.type === "odd_one_out");
  if (memory?.pairs?.length !== 4) throw new Error(`Coppie memory non valide: ${label}`);
  if (oddOneOut?.options?.length !== 4 || oddOneOut.correctIndex == null) throw new Error(`Trova l'intruso non valido: ${label}`);
}

async function main() {
  const embassyUrl = "https://ambbruxelles.esteri.it/it/chi-siamo/contatti/";
  const emergencyUrl = "https://www.112.be/it";
  const officialUrl = "https://www.viaggiaresicuri.it/find-country/country/BEL";
  const verifiedProfile = verifiedCountryProfileSchema.parse({
    countryName: "Belgio", iso2: "BE", timeZones: ["Europe/Brussels"], currencyCode: "EUR",
    usefulInfo: countryUsefulInfoCategories.map((category) => ({
      category, title: category, body: `Informazione verificata per ${category}.`,
      phone: category === "Numeri di emergenza" ? "112" : category === "Ambasciata italiana" ? "+32 2 543 15 50" : "",
      url: category === "Numeri di emergenza" ? emergencyUrl : category === "Ambasciata italiana" ? embassyUrl
        : category === "Documenti e sicurezza" || category === "Salute e assistenza" ? officialUrl : "",
    })),
    sources: [
      { category: "Numeri di emergenza", title: "Numero unico europeo", url: emergencyUrl },
      { category: "Ambasciata italiana", title: "Ambasciata d'Italia", url: embassyUrl },
      { category: "Documenti e sicurezza", title: "Viaggiare Sicuri", url: officialUrl },
      { category: "Salute e assistenza", title: "Viaggiare Sicuri", url: officialUrl },
    ],
  });
  const generated = await withAiTestReplay("reference-content-belgio-v1", async () => {
    const country = await generateReferenceContent(
      { entityType: "country", entityId: randomUUID(), name: "Belgio" },
      "Belgio, viaggio culturale tra Bruxelles e Bruges", verifiedProfile,
    );
    const city = await generateReferenceContent(
      { entityType: "city", entityId: randomUUID(), name: "Bruxelles" },
      "Bruxelles, Belgio",
    );
    const site = await generateReferenceContent(
      { entityType: "site", entityId: randomUUID(), name: "Grand-Place di Bruxelles" },
      "Grand-Place di Bruxelles, Bruxelles, Belgio",
    );
    return { country, city, site };
  });
  const { country, city, site } = generated;
  if (country.kind !== "country") throw new Error("Contenuto Paese non generato");
  assertPhotoValidation(country.data.bingo, "bingo Paese");
  const languages = [...new Set(country.data.phrasebook.map((item) => item.language))];
  if (languages.some((language) => /belga/i.test(language))) throw new Error("'Belga' non è una lingua valida");

  if (city.kind !== "destination") throw new Error("Contenuto città non generato");
  assertPhotoValidation(city.data.missions, "missioni città");
  assertPhotoValidation(city.data.photoContests, "contest città");
  assertGames(city.data.games, "giochi città");

  if (site.kind !== "destination") throw new Error("Contenuto sito non generato");
  assertPhotoValidation(site.data.missions, "missioni sito");
  assertPhotoValidation(site.data.photoContests, "contest sito");
  assertGames(site.data.games, "giochi sito");

  console.log(JSON.stringify({
    status: "passed",
    model: country.modelId,
    country: {
      usefulInfo: country.data.usefulInfo.length,
      categories: country.data.usefulInfo.map((item) => item.category),
      languages,
      phrases: country.data.phrasebook.length,
      bingo: country.data.bingo.length,
      photoValidationProfiles: country.data.bingo.length,
    },
    city: {
      quiz: city.data.quiz.length,
      missions: city.data.missions.length,
      games: city.data.games.length,
      photoContests: city.data.photoContests.length,
      photoValidationProfiles: city.data.missions.length + city.data.photoContests.length,
    },
    site: {
      quiz: site.data.quiz.length,
      missions: site.data.missions.length,
      games: site.data.games.length,
      photoContests: site.data.photoContests.length,
      photoValidationProfiles: site.data.missions.length + site.data.photoContests.length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
