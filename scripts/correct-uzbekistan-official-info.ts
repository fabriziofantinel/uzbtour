import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";

const countryName = "Uzbekistan";
const official = new Map([
  [
    "Fuso orario",
    {
      title: "Fuso orario dell'Uzbekistan",
      body: "L'Uzbekistan usa UTC+5 tutto l'anno e non applica l'ora legale. Rispetto all'Italia è avanti di 4 ore durante l'ora solare italiana e di 3 ore durante l'ora legale.",
      phone: "",
      url: "https://gov.uz/en/pages/useful_info",
    },
  ],
  [
    "Valuta e cambio",
    {
      title: "Valuta e cambio",
      body: "La valuta è il som uzbeko (UZS). Il cambio con l'euro varia: consultare il convertitore dell'app o il tasso aggiornato della Banca centrale uzbeka. Carte e pagamenti elettronici non sono accettati ovunque, quindi può essere utile disporre anche di contante cambiato tramite canali autorizzati.",
      phone: "",
      url: "https://cbu.uz/en/arkhiv-kursov-valyut/",
    },
  ],
  [
    "Numeri di emergenza",
    {
      title: "Numeri di emergenza in Uzbekistan",
      body: "Vigili del fuoco 101, Polizia 102, Ambulanza 103, emergenza gas 104 e soccorso 1050. I numeri sono pubblicati dal portale governativo uzbeko; in emergenza indicare chiaramente posizione e recapito.",
      phone: "101 · 102 · 103 · 104 · 1050",
      url: "https://my.gov.uz/en/contact",
    },
  ],
  [
    "Ambasciata italiana",
    {
      title: "Ambasciata d'Italia a Tashkent",
      body: "Yusuf Xos Xodjib Str. 40, 100031 Tashkent. Centralino +998 71 203 1120; Ufficio consolare +998 71 203 1098, consolare.tashkent@esteri.it. Verificare sul sito ufficiale eventuali aggiornamenti prima della partenza.",
      phone: "+998 71 203 1120",
      url: "https://ambtashkent.esteri.it/it/chi-siamo/contatti/",
    },
  ],
  [
    "Documenti e sicurezza",
    {
      title: "Documenti, ingresso e sicurezza",
      body: "Per i cittadini italiani non è richiesto il visto per soggiorni fino a 30 giorni; è obbligatoria la registrazione temporanea. Requisiti, validità del passaporto e condizioni di sicurezza possono cambiare: consultarli sempre su Viaggiare Sicuri prima della partenza.",
      phone: "",
      url: "https://www.viaggiaresicuri.it/find-country/country/UZB",
    },
  ],
  [
    "Salute e assistenza",
    {
      title: "Salute e assistenza",
      body: "Prima della partenza verificare su Viaggiare Sicuri le indicazioni sanitarie aggiornate e valutare con il proprio medico eventuali esigenze personali. È consigliata un'assicurazione con copertura delle spese mediche e dell'eventuale rimpatrio. Portare i farmaci abituali con documentazione adeguata e rivolgersi a strutture qualificate in caso di necessità.",
      phone: "103",
      url: "https://www.viaggiaresicuri.it/find-country/country/UZB",
    },
  ],
  [
    "Abbigliamento e clima",
    {
      title: "Abbigliamento e clima",
      body: "Il clima è continentale, con estati calde e inverni freddi. Scegliere abiti a strati, scarpe comode, protezione solare e copricapo nella stagione calda; prevedere capi più pesanti nei mesi freddi. Nei luoghi religiosi adottare un abbigliamento rispettoso e seguire le indicazioni presenti sul posto.",
      phone: "",
      url: "https://gov.uz/en/pages/useful_info",
    },
  ],
  [
    "Usi locali e pagamenti",
    {
      title: "Usi locali e pagamenti",
      body: "Salutare con cortesia e mostrare rispetto per anziani, usanze familiari e luoghi di culto. Chiedere sempre il permesso prima di fotografare persone. Verificare in anticipo se carte e pagamenti elettronici sono accettati; nei mercati e nelle attività minori può essere necessario il contante. Le mance sono facoltative e vanno valutate in base al servizio.",
      phone: "",
      url: "",
    },
  ],
  [
    "Come muoversi",
    {
      title: "Come muoversi",
      body: "Le principali città sono collegate da treni e servizi aerei interni; autobus, metropolitana a Tashkent e taxi coprono gli spostamenti locali. Acquistare i biglietti tramite canali ufficiali e concordare o verificare la tariffa dei taxi prima della corsa. Per orari e disponibilità fare riferimento ai vettori e alle stazioni.",
      phone: "",
      url: "https://gov.uz/en/pages/useful_info",
    },
  ],
  [
    "Usi e tradizioni",
    {
      title: "Usi e tradizioni",
      body: "1. L'ospitalità e l'offerta del tè hanno un ruolo importante. 2. Il pane è trattato con particolare rispetto. 3. Il rispetto verso gli anziani è molto sentito. 4. Nei luoghi di culto si seguono regole di abbigliamento e comportamento. 5. Artigianato, ceramica e tessuti variano tra le regioni. 6. Feste e mercati sono occasioni centrali della vita sociale.",
      phone: "",
      url: "",
    },
  ],
  [
    "Capire il paese",
    {
      title: "Capire l'Uzbekistan",
      body: "L'Uzbekistan è una repubblica presidenziale dell'Asia centrale con capitale Tashkent e una popolazione di oltre 35 milioni di abitanti. La lingua ufficiale è l'uzbeko; il russo è diffuso. La società è giovane e urbanizza rapidamente, mentre agricoltura, industria, risorse minerarie, servizi e turismo contribuiscono all'economia. Per dati politici e sociali aggiornati consultare fonti istituzionali e internazionali.",
      phone: "",
      url: "https://data.worldbank.org/country/uzbekistan",
    },
  ],
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
  if (rows.length !== 1 || !Array.isArray(rows[0].content))
    throw new Error("Informazioni Uzbekistan approvate non individuate univocamente");
  const corrected = rows[0].content.map((entry: Record<string, unknown>) => {
    const replacement = official.get(String(entry.category));
    return replacement ? { ...entry, ...replacement } : entry;
  });
  if (
    [...official.keys()].some(
      (category) => !corrected.some((entry: Record<string, unknown>) => entry.category === category),
    )
  ) {
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
  const phraseRows = await sql`
    SELECT content.id::text,content.content
    FROM ref.reference_contents content
    JOIN ref.countries country ON country.id=content.country_id
    WHERE lower(country.name)=lower(${countryName})
      AND content.content_type='phrasebook' AND content.locale='it-IT'
      AND content.status='approved'
  `;
  if (phraseRows.length !== 1 || !Array.isArray(phraseRows[0].content))
    throw new Error("Frasario Uzbekistan approvato non individuato univocamente");
  const localPhrases = phraseRows[0].content.filter(
    (entry: Record<string, unknown>) =>
      !["inglese", "english", "italiano", "italian"].includes(String(entry.language).trim().toLocaleLowerCase("it")),
  );
  const phraseSerialized = JSON.stringify(localPhrases);
  const phraseHash = createHash("sha256").update(phraseSerialized).digest("hex");
  await sql`
    UPDATE ref.reference_contents
    SET content=${phraseSerialized}::jsonb,content_hash=${phraseHash},updated_at=clock_timestamp(),
        refresh_after=clock_timestamp()+interval '6 months'
    WHERE id=${phraseRows[0].id}
  `;
  console.log(
    JSON.stringify({
      status: "corrected",
      country: countryName,
      categories: [...official.keys()],
      nextStep: "Rimaterializzare i viaggi pubblicati tramite repair-trip-experience.ts",
    }),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
