import { gameDays } from "./game-data";

export type DailyMission = {
  id: string;
  title: string;
  description: string;
  kind: "photo" | "discover" | "social" | "taste" | "language";
};

const missionSets: Record<number, DailyMission[]> = {
  12: [
    { id: "boarding", title: "Scatto di partenza", description: "Fotografa il momento che dà ufficialmente inizio al viaggio.", kind: "photo" },
    { id: "flight-code", title: "Cacciatore di voli", description: "Trova TK1310 o TK370 su un tabellone e annota dove.", kind: "discover" },
    { id: "istanbul", title: "Scalo esplorato", description: "Scopri un dettaglio curioso dell’aeroporto di Istanbul.", kind: "discover" },
    { id: "first-uzbek", title: "Prima parola", description: "Impara a dire grazie in uzbeko: rahmat.", kind: "language" },
    { id: "travel-snack", title: "Snack da viaggio", description: "Assaggia qualcosa che non avevi mai provato in aeroporto o in volo.", kind: "taste" }
  ],
  1: [
    { id: "blue-tile", title: "Il primo blu", description: "Fotografa il primo mosaico blu che ti colpisce a Tashkent.", kind: "photo" },
    { id: "metro-art", title: "Metro d’autore", description: "Trova la stazione della metropolitana più scenografica.", kind: "discover" },
    { id: "chorsu-price", title: "Prezzo da bazar", description: "Scopri il prezzo di un prodotto curioso al Chorsu Bazaar.", kind: "discover" },
    { id: "salom", title: "Saluta Tashkent", description: "Usa almeno una volta la parola uzbeka salom.", kind: "language" },
    { id: "first-bite", title: "Primo assaggio", description: "Prova un sapore uzbeko e dagli un voto da 1 a 5.", kind: "taste" }
  ],
  2: [
    { id: "kalta-angle", title: "Kalta Minor creativo", description: "Fotografa Kalta Minor da un’angolazione insolita.", kind: "photo" },
    { id: "wood-column", title: "Caccia alla colonna", description: "Trova nella Moschea Juma la colonna lignea che preferisci.", kind: "discover" },
    { id: "wall-detail", title: "Segreto di Ichan Kala", description: "Scova un piccolo dettaglio sulle mura che gli altri non hanno notato.", kind: "discover" },
    { id: "rahmat-khiva", title: "Rahmat!", description: "Ringrazia una persona del posto in uzbeko.", kind: "language" },
    { id: "khiva-dish", title: "Piatto di Khiva", description: "Assaggia una specialità locale e ricordane il nome.", kind: "taste" }
  ],
  3: [
    { id: "train-window", title: "Uzbekistan dal finestrino", description: "Scatta la foto migliore durante il viaggio in treno.", kind: "photo" },
    { id: "desert-color", title: "Colore del Kyzylkum", description: "Descrivi con tre parole il paesaggio del deserto.", kind: "discover" },
    { id: "carriage-friend", title: "Compagno di viaggio", description: "Scambia un saluto con qualcuno sul treno.", kind: "social" },
    { id: "train-word", title: "Parola in carrozza", description: "Riconosci o chiedi il significato di una parola in cirillico.", kind: "language" },
    { id: "rail-snack", title: "Merenda ferroviaria", description: "Prova uno snack acquistato durante il trasferimento.", kind: "taste" }
  ],
  4: [
    { id: "ark-frame", title: "Cornice dell’Ark", description: "Inquadra la fortezza usando un arco o una porta come cornice.", kind: "photo" },
    { id: "kalon-look", title: "Sguardo al Kalon", description: "Trova il punto da cui il minareto sembra più imponente.", kind: "discover" },
    { id: "market-craft", title: "Mani artigiane", description: "Scopri un oggetto realizzato a mano nei mercati coperti.", kind: "discover" },
    { id: "bukhara-greeting", title: "Saluto col cuore", description: "Saluta qualcuno portando la mano destra sul cuore.", kind: "social" },
    { id: "bukhara-taste", title: "Sapore di Bukhara", description: "Assaggia un piatto o un tè tipico della città.", kind: "taste" }
  ],
  5: [
    { id: "emir-detail", title: "Dettaglio dell’emiro", description: "Fotografa il particolare più elegante del palazzo estivo.", kind: "photo" },
    { id: "registan-night", title: "Registan di notte", description: "Cattura i colori della piazza illuminata.", kind: "photo" },
    { id: "silk-story", title: "Storia sulla seta", description: "Scopri una curiosità sulla vita dell’ultimo emiro.", kind: "discover" },
    { id: "train-rahmat", title: "Rahmat in viaggio", description: "Usa una parola uzbeka durante il trasferimento.", kind: "language" },
    { id: "samarkand-first", title: "Primo sapore di Samarcanda", description: "Prova qualcosa appena arrivato in città.", kind: "taste" }
  ],
  6: [
    { id: "registan-symmetry", title: "Simmetria perfetta", description: "Cerca lo scatto più simmetrico possibile al Registan.", kind: "photo" },
    { id: "gur-detail", title: "Oro al Gur-e-Amir", description: "Trova il dettaglio dorato più sorprendente.", kind: "discover" },
    { id: "siab-color", title: "Colori del Siab", description: "Fotografa tre colori intensi nello stesso scatto al bazar.", kind: "photo" },
    { id: "vendor-word", title: "Parola dal venditore", description: "Chiedi a un venditore il nome uzbeko di un prodotto.", kind: "language" },
    { id: "samarkand-plov", title: "Sfida del plov", description: "Assaggia il plov e dagli un voto personale.", kind: "taste" }
  ],
  7: [
    { id: "aksaray-scale", title: "La scala dell’Ak-Saray", description: "Fai capire in una foto quanto sono grandi le rovine.", kind: "photo" },
    { id: "temur-symbol", title: "Simbolo di Temur", description: "Trova un riferimento ad Amir Temur nascosto nel percorso.", kind: "discover" },
    { id: "green-city", title: "La città verde", description: "Individua lo scorcio che spiega meglio il nome Shahrisabz.", kind: "discover" },
    { id: "local-hello", title: "Un saluto locale", description: "Scambia un saluto rispettoso con una persona incontrata.", kind: "social" },
    { id: "road-taste", title: "Sapore sulla strada", description: "Prova un frutto o uno snack durante l’escursione.", kind: "taste" }
  ],
  8: [
    { id: "zinda-blue", title: "Cinquanta sfumature di blu", description: "Fotografa il blu più bello di Shah-i-Zinda.", kind: "photo" },
    { id: "astronomy", title: "Occhio da astronomo", description: "Scopri cosa misurava lo strumento di Ulugh Beg.", kind: "discover" },
    { id: "paper-touch", title: "Carta di Samarcanda", description: "Descrivi al tatto la carta prodotta a Konigil.", kind: "discover" },
    { id: "goodbye-samarkand", title: "Arrivederci Samarcanda", description: "Usa una parola locale prima di lasciare la città.", kind: "language" },
    { id: "station-snack", title: "Snack da stazione", description: "Scegli qualcosa da assaggiare prima del treno.", kind: "taste" }
  ],
  9: [
    { id: "palace-color", title: "Palazzo a colori", description: "Trova la combinazione cromatica più curiosa a Kokand.", kind: "photo" },
    { id: "rishtan-pattern", title: "Pattern di Rishtan", description: "Fotografa il motivo di una ceramica che porteresti a casa.", kind: "photo" },
    { id: "potter-secret", title: "Segreto del ceramista", description: "Scopri una fase della lavorazione della ceramica.", kind: "discover" },
    { id: "artisan-thanks", title: "Grazie all’artigiano", description: "Ringrazia un artigiano usando rahmat.", kind: "language" },
    { id: "fergana-fruit", title: "Frutto della valle", description: "Assaggia un frutto coltivato nella Valle di Fergana.", kind: "taste" }
  ],
  10: [
    { id: "silk-motion", title: "Seta in movimento", description: "Fotografa un tessuto mentre crea movimento e colore.", kind: "photo" },
    { id: "ikat-code", title: "Codice Ikat", description: "Individua il disegno ikat più originale.", kind: "discover" },
    { id: "market-fruit", title: "Campione del bazar", description: "Trova il frutto più grande o più insolito.", kind: "discover" },
    { id: "margilan-word", title: "Parola di Margilan", description: "Impara il nome locale di un tessuto o di un frutto.", kind: "language" },
    { id: "kamchik-view", title: "Sosta panoramica", description: "Scatta una foto memorabile lungo il passo Kamchik.", kind: "photo" }
  ],
  11: [
    { id: "last-tashkent", title: "Ultimo scatto", description: "Fotografa il luogo di Tashkent che vorresti rivedere.", kind: "photo" },
    { id: "souvenir-story", title: "Souvenir con una storia", description: "Scegli l’oggetto che racconta meglio il viaggio.", kind: "discover" },
    { id: "best-memory", title: "Il momento migliore", description: "Condividi con gli altri il tuo ricordo preferito.", kind: "social" },
    { id: "final-rahmat", title: "Ultimo rahmat", description: "Ringrazia in uzbeko una persona conosciuta durante il tour.", kind: "language" },
    { id: "farewell-dish", title: "Cena di arrivederci", description: "Eleggi il miglior sapore dell’ultima cena.", kind: "taste" }
  ],
  13: [
    { id: "airport-memory", title: "Cartolina dal rientro", description: "Scegli una foto che riassuma il viaggio.", kind: "photo" },
    { id: "best-stat", title: "Numero del viaggio", description: "Indovina quante foto avete caricato in totale.", kind: "discover" },
    { id: "travel-award", title: "Premio di gruppo", description: "Assegna a ciascun partecipante un titolo divertente.", kind: "social" },
    { id: "last-word", title: "Parola da portare a casa", description: "Scegli la parola uzbeka che ricorderai.", kind: "language" },
    { id: "home-craving", title: "Nostalgia gastronomica", description: "Decidi quale piatto uzbeko vorresti mangiare ancora.", kind: "taste" }
  ]
};

export const missionDays = gameDays.map((day) => ({
  ...day,
  missions: missionSets[day.day] ?? []
}));

export const bingoItems = [
  { id: "chevrolet", title: "Chevrolet bianca", description: "L’auto simbolo delle strade uzbeke" },
  { id: "non", title: "Pane non", description: "La focaccia tonda decorata" },
  { id: "piala", title: "Tè nella piala", description: "La tipica tazza senza manico" },
  { id: "cyrillic", title: "Scritta in cirillico", description: "Un’insegna da decifrare" },
  { id: "blue-dome", title: "Cupola blu", description: "Una cupola ricoperta di maioliche" },
  { id: "melon", title: "Melone o anguria", description: "Il frutto più invitante del bazar" },
  { id: "plov", title: "Piatto di plov", description: "Il piatto nazionale uzbeko" },
  { id: "carpet", title: "Tappeto artigianale", description: "Un motivo tradizionale" },
  { id: "lada", title: "Una vecchia Lada", description: "Un frammento di storia sovietica" },
  { id: "gold-smile", title: "Sorriso dorato", description: "Da notare con discrezione e rispetto" },
  { id: "silk", title: "Tessuto ikat", description: "Seta dai colori inconfondibili" },
  { id: "minaret", title: "Minareto", description: "Quello che ti sembra più alto" },
  { id: "spices", title: "Montagna di spezie", description: "Un banco coloratissimo" },
  { id: "train", title: "Treno uzbeko", description: "In stazione o dal finestrino" },
  { id: "tea-pot", title: "Teiera decorata", description: "Una teiera che porteresti a casa" },
  { id: "heart-greeting", title: "Saluto col cuore", description: "Il gesto tradizionale di cortesia" }
] as const;

export const MISSION_POINTS = 10;
export const BINGO_ITEM_POINTS = 12;
export const BINGO_COMPLETION_BONUS = 8;
export const BINGO_MAX_POINTS = bingoItems.length * BINGO_ITEM_POINTS + BINGO_COMPLETION_BONUS;

export function bingoScore(completed: number) {
  return completed * BINGO_ITEM_POINTS + (completed === bingoItems.length ? BINGO_COMPLETION_BONUS : 0);
}
