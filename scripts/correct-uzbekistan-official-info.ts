import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";

const countryName = "Uzbekistan";
const official = new Map([
  ["Numeri di emergenza", {
    title: "Numeri di emergenza in Uzbekistan",
    body: "Vigili del fuoco 101, Polizia 102, Ambulanza 103, emergenza gas 104 e soccorso 1050. I numeri sono pubblicati dal portale governativo uzbeko; in emergenza indicare chiaramente posizione e recapito.",
    phone: "101 · 102 · 103 · 104 · 1050",
    url: "https://my.gov.uz/en/contact",
  }],
  ["Ambasciata italiana", {
    title: "Ambasciata d'Italia a Tashkent",
    body: "Yusuf Xos Xodjib Str. 40, 100031 Tashkent. Centralino +998 71 203 1120; Ufficio consolare +998 71 203 1098, consolare.tashkent@esteri.it. Verificare sul sito ufficiale eventuali aggiornamenti prima della partenza.",
    phone: "+998 71 203 1120",
    url: "https://ambtashkent.esteri.it/it/chi-siamo/contatti/",
  }],
  ["Documenti e sicurezza", {
    title: "Documenti, ingresso e sicurezza",
    body: "Per i cittadini italiani non è richiesto il visto per soggiorni fino a 30 giorni; è obbligatoria la registrazione temporanea. Requisiti, validità del passaporto e condizioni di sicurezza possono cambiare: consultarli sempre su Viaggiare Sicuri prima della partenza.",
    phone: "",
    url: "https://www.viaggiaresicuri.it/find-country/country/UZB",
  }],
]);

async function main() {
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const raw = process.env[key];
    if (raw?.startsWith('"') && raw.endsWith('"')) process.env[key] = JSON.parse(raw);
  }
  const sql = getSql();
  const rows = await sql`
    SELECT content.id::text,content.content
    FROM ref.reference_contents content
    JOIN ref.countries country ON country.id=content.country_id
    WHERE lower(country.name)=lower(${countryName})
      AND content.content_type='useful_info' AND content.locale='it-IT'
      AND content.status='approved'
  `;
  if (rows.length !== 1 || !Array.isArray(rows[0].content)) throw new Error("Informazioni Uzbekistan approvate non individuate univocamente");
  const corrected = rows[0].content.map((entry: Record<string, unknown>) => {
    const replacement = official.get(String(entry.category));
    return replacement ? { ...entry, ...replacement } : entry;
  });
  if ([...official.keys()].some((category) => !corrected.some((entry: Record<string, unknown>) => entry.category === category))) {
    throw new Error("Categorie ufficiali incomplete");
  }
  const serialized = JSON.stringify(corrected);
  const contentHash = createHash("sha256").update(serialized).digest("hex");
  await sql`
    UPDATE ref.reference_contents
    SET content=${serialized}::jsonb,content_hash=${contentHash},updated_at=clock_timestamp(),
        refresh_after=clock_timestamp()+interval '6 months'
    WHERE id=${rows[0].id}
  `;
  console.log(JSON.stringify({
    status: "corrected",
    country: countryName,
    categories: [...official.keys()],
    nextStep: "Rimaterializzare i viaggi pubblicati tramite repair-trip-experience.ts",
  }));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
