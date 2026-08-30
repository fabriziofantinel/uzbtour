import { randomUUID } from "node:crypto";
import { generateReferenceContent } from "../lib/platform/reference-enrichment";

async function main() {
  const country = await generateReferenceContent(
    { entityType: "country", entityId: randomUUID(), name: "Belgio" },
    "Belgio, viaggio culturale tra Bruxelles e Bruges",
  );
  if (country.kind !== "country") throw new Error("Contenuto Paese non generato");
  const languages = [...new Set(country.data.phrasebook.map((item) => item.language))];
  if (languages.some((language) => /belga/i.test(language))) throw new Error("'Belga' non è una lingua valida");

  const city = await generateReferenceContent(
    { entityType: "city", entityId: randomUUID(), name: "Bruxelles" },
    "Bruxelles, Belgio",
  );
  if (city.kind !== "destination") throw new Error("Contenuto città non generato");

  const site = await generateReferenceContent(
    { entityType: "site", entityId: randomUUID(), name: "Grand-Place di Bruxelles" },
    "Grand-Place di Bruxelles, Bruxelles, Belgio",
  );
  if (site.kind !== "destination") throw new Error("Contenuto sito non generato");

  console.log(JSON.stringify({
    status: "passed",
    model: country.modelId,
    country: {
      usefulInfo: country.data.usefulInfo.length,
      categories: country.data.usefulInfo.map((item) => item.category),
      languages,
      phrases: country.data.phrasebook.length,
      bingo: country.data.bingo.length,
    },
    city: {
      quiz: city.data.quiz.length,
      missions: city.data.missions.length,
      games: city.data.games.length,
      photoContests: city.data.photoContests.length,
    },
    site: {
      quiz: site.data.quiz.length,
      missions: site.data.missions.length,
      games: site.data.games.length,
      photoContests: site.data.photoContests.length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
