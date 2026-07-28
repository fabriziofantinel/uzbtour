import { quizQuestionSets } from "@/lib/quiz-question-sets";

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
};

export type QuizDay = {
  day: number;
  date: string;
  city: string;
  route: string;
  theme: string;
  hotel: string;
  transport: string;
  service: string;
  finale: string;
  highlights: string[];
  unlockAt: string;
};

export const quizDays: QuizDay[] = [
  {
    day: 1,
    date: "2 agosto",
    city: "Tashkent e Khiva",
    route: "Tashkent → Urgench → Khiva",
    theme: "La capitale e il volo verso Urgench",
    hotel: "Zarafshon, Khiva",
    transport: "Volo interno e trasferimento in auto",
    service: "Guida privata in italiano e cena inclusa",
    finale: "Volo serale per Urgench e trasferimento a Khiva",
    highlights: ["Complesso Khast Imam", "Madrasa Barak Khan", "Bazaar Chorsu", "Metropolitana di Tashkent", "Piazza dell’Indipendenza", "Trasferimento di circa 40 km fino a Khiva"],
    unlockAt: "2026-08-02T15:00:00.000Z"
  },
  {
    day: 2,
    date: "3 agosto",
    city: "Khiva",
    route: "Khiva, all’interno di Ichan Kala",
    theme: "La città-museo di Ichan Kala",
    hotel: "Zarafshon, Khiva",
    transport: "Visita a piedi",
    service: "Guida privata in italiano e cena inclusa",
    finale: "Tempo libero e cena in un ristorante locale",
    highlights: ["Ichan Kala", "Kalta Minor", "Kunya Ark", "Madrasa Muhammad Amin Khan", "Moschea Juma", "Palazzo Tosh Hovli"],
    unlockAt: "2026-08-03T15:00:00.000Z"
  },
  {
    day: 3,
    date: "4 agosto",
    city: "Da Khiva a Bukhara",
    route: "Khiva → deserto del Kyzylkum → Bukhara",
    theme: "Nel deserto sulla Via della Seta",
    hotel: "Shaxriston, Bukhara",
    transport: "Veicolo privato",
    service: "Autista privato e cena inclusa",
    finale: "Passeggiata orientativa nel centro storico di Bukhara",
    highlights: ["Deserto del Kyzylkum", "Trasferimento di circa 480 km", "Viaggio di circa 6–7 ore", "Soste tecniche nel deserto", "Arrivo a Bukhara nel pomeriggio", "Centro storico di Bukhara"],
    unlockAt: "2026-08-04T15:00:00.000Z"
  },
  {
    day: 4,
    date: "5 agosto",
    city: "Bukhara",
    route: "Centro storico di Bukhara",
    theme: "La città santa dell’Asia Centrale",
    hotel: "Shaxriston, Bukhara",
    transport: "Visita a piedi",
    service: "Guida privata in italiano e cena inclusa",
    finale: "Conclusione tra gli antichi mercati coperti",
    highlights: ["Mausoleo dei Samanidi", "Fortezza Ark", "Moschea Bolo Hauz", "Complesso Poi Kalon", "Mercati coperti di Bukhara", "Chor Minor"],
    unlockAt: "2026-08-05T15:00:00.000Z"
  },
  {
    day: 5,
    date: "6 agosto",
    city: "Da Bukhara a Samarcanda",
    route: "Bukhara → Samarcanda",
    theme: "Dal palazzo dell’emiro al Registan",
    hotel: "Maridian Plaza, Samarcanda",
    transport: "Treno 15:03–16:48",
    service: "Trasferimenti privati e cena inclusa",
    finale: "Registan illuminato dopo cena",
    highlights: ["Sitorai Mokhi Khosa", "Palazzo estivo dell’ultimo emiro", "Treno per Samarcanda", "Arrivo a Samarcanda alle 16:48", "Piazza Registan di sera", "Registan illuminato"],
    unlockAt: "2026-08-06T15:00:00.000Z"
  },
  {
    day: 6,
    date: "7 agosto",
    city: "Samarcanda",
    route: "Centro monumentale di Samarcanda",
    theme: "Le meraviglie di Tamerlano",
    hotel: "Maridian Plaza, Samarcanda",
    transport: "Visita guidata a piedi e trasferimenti locali",
    service: "Guida privata in italiano e cena inclusa",
    finale: "Cena in un ristorante locale",
    highlights: ["Mausoleo Gur-e-Amir", "Piazza Registan", "Moschea Bibi Khanum", "Bazaar Siab", "Architetture legate a Tamerlano", "Intera giornata guidata"],
    unlockAt: "2026-08-07T15:00:00.000Z"
  },
  {
    day: 7,
    date: "8 agosto",
    city: "Shahrisabz",
    route: "Samarcanda → Shahrisabz → Samarcanda",
    theme: "La città verde di Amir Temur",
    hotel: "Maridian Plaza, Samarcanda",
    transport: "Escursione in veicolo privato",
    service: "Guida privata e cena inclusa",
    finale: "Rientro a Samarcanda nel tardo pomeriggio",
    highlights: ["Palazzo Ak-Saray", "Dorus-Saodat", "Dorut-Tilovat", "Moschea Kok-Gumbaz", "Passo montano verso Shahrisabz", "Città natale di Amir Temur"],
    unlockAt: "2026-08-08T15:00:00.000Z"
  },
  {
    day: 8,
    date: "9 agosto",
    city: "Da Samarcanda a Tashkent",
    route: "Samarcanda → Tashkent",
    theme: "Necropoli, astronomia e carta",
    hotel: "Inspira-S, Tashkent",
    transport: "Treno 17:40–20:07",
    service: "Guida privata, treno e cena inclusa",
    finale: "Trasferimento in hotel e cena a Tashkent",
    highlights: ["Necropoli Shah-i-Zinda", "Osservatorio di Ulugh Beg", "Fabbrica della carta di Konigil", "Produzione tradizionale della carta", "Treno serale per Tashkent", "Arrivo a Tashkent alle 20:07"],
    unlockAt: "2026-08-09T15:00:00.000Z"
  },
  {
    day: 9,
    date: "10 agosto",
    city: "Kokand, Rishtan e Fergana",
    route: "Tashkent → Kokand → Rishtan → Fergana",
    theme: "Ceramiche e palazzi nella Valle di Fergana",
    hotel: "Saroy Garden, Fergana",
    transport: "Treno e veicolo con autista",
    service: "Autista privato, senza guida, e cena inclusa",
    finale: "Proseguimento fino a Fergana",
    highlights: ["Palazzo Khudoyar Khan", "Moschea del Venerdì di Kokand", "Laboratori di ceramica di Rishtan", "Ceramica blu tradizionale", "Treno Tashkent–Kokand", "Incontro con l’autista locale"],
    unlockAt: "2026-08-10T15:00:00.000Z"
  },
  {
    day: 10,
    date: "11 agosto",
    city: "Margilan e Tashkent",
    route: "Fergana → Margilan → Tashkent",
    theme: "La seta della Valle di Fergana",
    hotel: "Inspira-S, Tashkent",
    transport: "Veicolo con autista",
    service: "Autista privato, senza guida, e cena inclusa",
    finale: "Rientro a Tashkent attraverso il passo Kamchik",
    highlights: ["Fabbrica della seta di Margilan", "Bazar della frutta di Margilan", "Produzione tradizionale della seta", "Passo montano Kamchik", "Partenza da Fergana", "Rientro panoramico a Tashkent"],
    unlockAt: "2026-08-11T15:00:00.000Z"
  },
  {
    day: 11,
    date: "12 agosto",
    city: "Tashkent",
    route: "Tashkent → Aeroporto internazionale",
    theme: "Tempo libero e cena di arrivederci",
    hotel: "Check-out da Inspira-S",
    transport: "Trasferimento privato in aeroporto",
    service: "Trasferimento aeroporto e cena inclusa",
    finale: "Partenza con il volo delle 23:50",
    highlights: ["Mattina libera a Tashkent", "Ultimi acquisti", "Camera disponibile fino alle 12:00", "Late check-out possibile fino alle 18:00", "Cena di arrivederci", "Trasferimento serale in aeroporto"],
    unlockAt: "2026-08-12T15:00:00.000Z"
  }
];

function rotateOptions(questionId: string, correct: string, distractors: string[]) {
  const unique = [correct, ...distractors.filter((value) => value !== correct)]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 4);
  const offset = questionId.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % unique.length;
  return [...unique.slice(offset), ...unique.slice(0, offset)];
}

function question(id: string, prompt: string, correct: string, distractors: string[]): QuizQuestion {
  return { id, prompt, correctAnswer: correct, options: rotateOptions(id, correct, distractors) };
}

export function getQuizQuestions(dayNumber: number) {
  return (quizQuestionSets[dayNumber] ?? []).map(([prompt, correct, ...distractors], index) =>
    question(`${dayNumber}-attraction-${index + 1}`, prompt, correct, distractors)
  );
}

export function isQuizUnlocked(day: QuizDay, user: { initials: string }, now = new Date()) {
  return user.initials.toUpperCase() === "FF" || now.getTime() >= new Date(day.unlockAt).getTime();
}
