import { countryUsefulInfoCategories } from "../lib/platform/reference-content-normalizer";
import { validateVerifiedCountryProfile } from "../lib/platform/verified-country-profile";

const embassyUrl = "https://amboslo.esteri.it/it/chi-siamo/contatti/";
const authorityUrl = "https://www.politiet.no/en/english/emergency-numbers/";
const generalUrl = "https://www.viaggiaresicuri.it/find-country/country/NOR";
const statisticsUrl = "https://www.ssb.no/en/befolkning";
const sources = [
  { category: "Ambasciata italiana", title: "Ambasciata d'Italia", url: embassyUrl },
  { category: "Numeri di emergenza", title: "Emergency numbers", url: authorityUrl },
  { category: "Documenti e sicurezza", title: "Viaggiare Sicuri", url: generalUrl },
  { category: "Salute e assistenza", title: "Viaggiare Sicuri - salute", url: generalUrl },
  { category: "Capire il paese", title: "Statistics Norway", url: statisticsUrl },
];
const usefulInfo = countryUsefulInfoCategories.map((category) => ({
  category,
  title: category,
  body: `Informazione verificata per ${category}.`,
  phone:
    category === "Numeri di emergenza" ? "112, 110, 113" : category === "Ambasciata italiana" ? "+47 23 08 49 00" : "",
  url:
    category === "Ambasciata italiana"
      ? embassyUrl
      : category === "Numeri di emergenza"
        ? authorityUrl
        : category === "Documenti e sicurezza" || category === "Salute e assistenza"
          ? generalUrl
          : "",
}));
const profile = {
  countryName: "Norvegia",
  iso2: "NO",
  timeZones: ["Europe/Oslo"],
  currencyCode: "NOK",
  usefulInfo,
  sources,
};
const cited = sources.map((source) => source.url);
const dossier = "Numeri 112 110 113. Centralino Ambasciata +47 23 08 49 00. Valuta NOK.";
const valid = validateVerifiedCountryProfile(profile, cited, dossier);
if (valid.errors.length) throw new Error(`Profilo valido rifiutato: ${valid.errors.join("; ")}`);
const fabricated = structuredClone(profile);
fabricated.usefulInfo.find((entry) => entry.category === "Ambasciata italiana")!.phone = "+47 99 99 99 99";
const invalid = validateVerifiedCountryProfile(fabricated, cited, dossier);
if (!invalid.errors.some((error) => error.includes("Recapito non riscontrato")))
  throw new Error("Recapito inventato non rilevato");
console.log(JSON.stringify({ status: "passed", verifiedAccepted: true, fabricatedPhoneRejected: true }));
