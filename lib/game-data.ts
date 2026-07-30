export type GameWord = {
  clue: string;
  answer: string;
};

export type GameDay = {
  day: number;
  label: string;
  date: string;
  city: string;
  unlockAt: string;
  words: GameWord[];
  order: string[];
};

export const gameDays: GameDay[] = [
  {
    day: 12, label: "PARTENZA", date: "1 agosto", city: "Torino → Istanbul → Tashkent",
    unlockAt: "2026-08-01T15:00:00.000Z",
    words: [
      { clue: "Numero del primo volo da Torino", answer: "TK1310" },
      { clue: "La città dello scalo", answer: "Istanbul" },
      { clue: "La capitale di arrivo", answer: "Tashkent" }
    ],
    order: ["Partenza da Torino", "Arrivo a Istanbul", "Coincidenza a Istanbul", "Arrivo a Tashkent"]
  },
  {
    day: 1, label: "GIORNO 1", date: "2 agosto", city: "Tashkent e Khiva",
    unlockAt: "2026-08-02T15:00:00.000Z",
    words: [
      { clue: "Il grande mercato della capitale", answer: "Chorsu" },
      { clue: "Il complesso religioso di Tashkent", answer: "Khast Imam" },
      { clue: "La città raggiunta dopo il volo interno", answer: "Khiva" }
    ],
    order: ["Arrivo e riposo a Tashkent", "Visita di Tashkent", "Volo per Urgench", "Trasferimento a Khiva"]
  },
  {
    day: 2, label: "GIORNO 2", date: "3 agosto", city: "Khiva",
    unlockAt: "2026-08-03T15:00:00.000Z",
    words: [
      { clue: "La città murata di Khiva", answer: "Ichan Kala" },
      { clue: "Il minareto turchese incompiuto", answer: "Kalta Minor" },
      { clue: "La moschea dalle numerose colonne lignee", answer: "Juma" }
    ],
    order: ["Ingresso a Ichan Kala", "Kalta Minor", "Kunya Ark", "Palazzo Tosh Hovli"]
  },
  {
    day: 3, label: "GIORNO 3", date: "4 agosto", city: "Khiva → Bukhara",
    unlockAt: "2026-08-04T15:00:00.000Z",
    words: [
      { clue: "Il mezzo di trasporto della giornata", answer: "Treno" },
      { clue: "Il deserto attraversato", answer: "Kyzylkum" },
      { clue: "La città di arrivo", answer: "Bukhara" }
    ],
    order: ["Partenza da Khiva", "Attraversamento del Kyzylkum", "Arrivo a Bukhara", "Passeggiata nel centro storico"]
  },
  {
    day: 4, label: "GIORNO 4", date: "5 agosto", city: "Bukhara",
    unlockAt: "2026-08-05T15:00:00.000Z",
    words: [
      { clue: "La fortezza degli emiri", answer: "Ark" },
      { clue: "Il celebre complesso con il grande minareto", answer: "Poi Kalon" },
      { clue: "La madrasa dai quattro minareti", answer: "Chor Minor" }
    ],
    order: ["Mausoleo dei Samanidi", "Fortezza Ark", "Complesso Poi Kalon", "Chor Minor"]
  },
  {
    day: 5, label: "GIORNO 5", date: "6 agosto", city: "Bukhara → Samarcanda",
    unlockAt: "2026-08-06T15:00:00.000Z",
    words: [
      { clue: "Il palazzo estivo dell’emiro", answer: "Sitorai Mokhi Khosa" },
      { clue: "La città raggiunta in treno", answer: "Samarcanda" },
      { clue: "La piazza ammirata illuminata", answer: "Registan" }
    ],
    order: ["Check-out a Bukhara", "Sitorai Mokhi Khosa", "Treno per Samarcanda", "Registan illuminato"]
  },
  {
    day: 6, label: "GIORNO 6", date: "7 agosto", city: "Samarcanda",
    unlockAt: "2026-08-07T15:00:00.000Z",
    words: [
      { clue: "Il mausoleo di Tamerlano", answer: "Gur-e-Amir" },
      { clue: "La piazza simbolo di Samarcanda", answer: "Registan" },
      { clue: "Il bazar vicino alla moschea Bibi Khanum", answer: "Siab" }
    ],
    order: ["Mausoleo Gur-e-Amir", "Piazza Registan", "Moschea Bibi Khanum", "Bazaar Siab"]
  },
  {
    day: 7, label: "GIORNO 7", date: "8 agosto", city: "Shahrisabz",
    unlockAt: "2026-08-08T15:00:00.000Z",
    words: [
      { clue: "La città natale di Amir Temur", answer: "Shahrisabz" },
      { clue: "Il palazzo bianco monumentale", answer: "Ak-Saray" },
      { clue: "La moschea dalla cupola blu", answer: "Kok-Gumbaz" }
    ],
    order: ["Partenza da Samarcanda", "Palazzo Ak-Saray", "Complessi funerari", "Rientro a Samarcanda"]
  },
  {
    day: 8, label: "GIORNO 8", date: "9 agosto", city: "Samarcanda → Tashkent",
    unlockAt: "2026-08-09T15:00:00.000Z",
    words: [
      { clue: "La necropoli dalle maioliche blu", answer: "Shah-i-Zinda" },
      { clue: "L’astronomo del celebre osservatorio", answer: "Ulugh Beg" },
      { clue: "Il materiale prodotto a Konigil", answer: "Carta" }
    ],
    order: ["Shah-i-Zinda", "Osservatorio di Ulugh Beg", "Cartiera di Konigil", "Treno per Tashkent"]
  },
  {
    day: 9, label: "GIORNO 9", date: "10 agosto", city: "Kokand, Rishtan e Fergana",
    unlockAt: "2026-08-10T15:00:00.000Z",
    words: [
      { clue: "La città del palazzo Khudoyar Khan", answer: "Kokand" },
      { clue: "La località famosa per la ceramica blu", answer: "Rishtan" },
      { clue: "La valle attraversata", answer: "Fergana" }
    ],
    order: ["Treno per Kokand", "Palazzo Khudoyar Khan", "Ceramiche di Rishtan", "Arrivo a Fergana"]
  },
  {
    day: 10, label: "GIORNO 10", date: "11 agosto", city: "Margilan → Tashkent",
    unlockAt: "2026-08-11T15:00:00.000Z",
    words: [
      { clue: "La città della fabbrica della seta", answer: "Margilan" },
      { clue: "Il tessuto uzbeko lavorato con tecnica ikat", answer: "Atlas" },
      { clue: "Il passo montano sulla via del ritorno", answer: "Kamchik" }
    ],
    order: ["Partenza da Fergana", "Setificio di Margilan", "Bazar della frutta", "Passo Kamchik e Tashkent"]
  },
  {
    day: 11, label: "GIORNO 11", date: "12 agosto", city: "Tashkent",
    unlockAt: "2026-08-12T15:00:00.000Z",
    words: [
      { clue: "La capitale degli ultimi acquisti", answer: "Tashkent" },
      { clue: "Il pasto conclusivo del tour", answer: "Cena" },
      { clue: "Il luogo raggiunto in serata", answer: "Aeroporto" }
    ],
    order: ["Tempo libero", "Ultimi acquisti", "Cena di arrivederci", "Trasferimento in aeroporto"]
  },
  {
    day: 13, label: "RIENTRO", date: "13 agosto", city: "Tashkent → Istanbul → Torino",
    unlockAt: "2026-08-13T15:00:00.000Z",
    words: [
      { clue: "Numero del volo Tashkent-Istanbul", answer: "TK363" },
      { clue: "La città della coincidenza", answer: "Istanbul" },
      { clue: "La città dell’arrivo finale", answer: "Torino" }
    ],
    order: ["Partenza da Tashkent", "Arrivo a Istanbul", "Volo TK1309", "Arrivo a Torino"]
  }
];

export function normalizeGameAnswer(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLocaleUpperCase("it");
}

export function isGameUnlocked(day: GameDay, user: { initials: string }, now = new Date()) {
  return user.initials.toUpperCase() === "FF" || now.getTime() >= new Date(day.unlockAt).getTime();
}
