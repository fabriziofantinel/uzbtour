import { z } from "zod";

export const countryUsefulInfoCategories = [
  "Fuso orario",
  "Valuta e cambio",
  "Numeri di emergenza",
  "Ambasciata italiana",
  "Salute e assistenza",
  "Documenti e sicurezza",
  "Abbigliamento e clima",
  "Usi locali e pagamenti",
  "Come muoversi",
  "Usi e tradizioni",
  "Capire il paese",
] as const;

export const countryPhraseTranslations = [
  "Salve",
  "Grazie",
  "Acqua",
  "Dov'è la stazione?",
  "Quanto costa?",
  "Buon appetito",
  "Mi piace questo posto",
  "Posso aiutare?",
  "Qual è il tuo nome?",
  "Mi piace la cucina locale",
  "Questo è bellissimo",
  "Come si dice nella lingua locale?",
] as const;

function normalizedPhrase(value: string) {
  return value.trim().toLocaleLowerCase("it").replace(/[’']/g, "'");
}

export const countryUsefulInfoSchema = z.array(z.object({
  category: z.enum(countryUsefulInfoCategories),
  title: z.string().min(1).max(240),
  body: z.string().min(1).max(6000),
  phone: z.string().max(100).default(""),
  url: z.string().url().max(500).or(z.literal("")).default(""),
})).length(countryUsefulInfoCategories.length).superRefine((items, context) => {
  for (const category of countryUsefulInfoCategories) {
    const count = items.filter((item) => item.category === category).length;
    if (count !== 1) context.addIssue({ code: "custom", message: `La categoria '${category}' deve comparire esattamente una volta` });
  }
  const embassy = items.find((item) => item.category === "Ambasciata italiana");
  if (!embassy?.url || !/^https:\/\/[^/]+\.esteri\.it(?:\/|$)/i.test(embassy.url)) {
    context.addIssue({ code: "custom", message: "Il riferimento dell'Ambasciata deve usare un dominio ufficiale esteri.it" });
  }
  if (!embassy?.phone.trim()) {
    context.addIssue({ code: "custom", message: "Il telefono dell'Ambasciata deve essere valorizzato nel campo dedicato" });
  }
  const emergency = items.find((item) => item.category === "Numeri di emergenza");
  if (!emergency?.url || !emergency.phone.trim()) {
    context.addIssue({ code: "custom", message: "I numeri di emergenza devono avere telefono e fonte ufficiale nei campi dedicati" });
  }
  const documents = items.find((item) => item.category === "Documenti e sicurezza");
  if (documents && /(?:non (?:serve|e' richiesto|è richiesto) il visto)[\s\S]{0,500}(?:visto (?:obbligatorio|necessario))|(?:visto (?:obbligatorio|necessario))[\s\S]{0,500}(?:non (?:serve|e' richiesto|è richiesto) il visto)/i.test(documents.body)) {
    context.addIssue({ code: "custom", message: "Le informazioni sui documenti contengono indicazioni contraddittorie sul visto" });
  }
});

const phrasebookSchema = z.array(z.object({
  language: z.string().min(1).max(80),
  term: z.string().min(1).max(500),
  pronunciation: z.string().min(1).max(500),
  translation: z.enum(countryPhraseTranslations),
})).min(12).max(36).superRefine((items, context) => {
  const byLanguage = new Map<string, typeof items>();
  items.forEach((item) => {
    const language = item.language.trim().toLocaleLowerCase("it");
    byLanguage.set(language, [...(byLanguage.get(language) ?? []), item]);
  });
  if (byLanguage.size < 1 || byLanguage.size > 3) {
    context.addIssue({ code: "custom", message: "Il frasario deve contenere da una a tre lingue locali" });
  }
  for (const [language, phrases] of byLanguage) {
    if (["inglese", "english", "italiano", "italian"].includes(language)) {
      context.addIssue({ code: "custom", message: `La lingua '${language}' non può essere usata come lingua locale` });
    }
    if (phrases.length !== 12) {
      context.addIssue({ code: "custom", message: `La lingua '${language}' deve contenere esattamente 12 frasi` });
    }
    const actual = new Set(phrases.map((phrase) => normalizedPhrase(phrase.translation)));
    const expected = countryPhraseTranslations.map(normalizedPhrase);
    if (actual.size !== expected.length || expected.some((translation) => !actual.has(translation))) {
      context.addIssue({ code: "custom", message: `La lingua '${language}' deve tradurre le 12 frasi italiane richieste` });
    }
  }
  if (byLanguage.size > 1) {
    const translations = [...byLanguage.values()].map((phrases) =>
      new Set(phrases.map((phrase) => phrase.translation.trim().toLocaleLowerCase("it"))),
    );
    if (translations.some((set) => set.size !== 12 || [...translations[0]].some((translation) => !set.has(translation)))) {
      context.addIssue({ code: "custom", message: "Tutte le lingue devono tradurre le stesse 12 frasi italiane" });
    }
  }
});

export const countryBingoCategories = [
  "Piatto tipico",
  "Bevanda locale",
  "Pane o dolce",
  "Frutta o prodotto agricolo",
  "Ceramica o artigianato",
  "Tessuto o motivo tradizionale",
  "Abito tradizionale esposto",
  "Dettaglio architettonico esterno",
  "Decorazione o mosaico",
  "Mezzo di trasporto locale",
  "Banconota o moneta",
  "Scritta nella lingua locale",
  "Prodotto da mercato",
  "Oggetto della tavola",
  "Scena urbana senza persone riconoscibili",
] as const;

export const photoValidationSchema = z.object({
  target: z.string().trim().min(2).max(240),
  subjectType: z.enum(["place", "monument", "dish", "food", "drink", "object", "pattern", "transport", "text", "scene", "other"]),
  visualDescription: z.string().trim().min(20).max(900),
  requiredFeatures: z.array(z.string().trim().min(2).max(220)).min(1).max(6),
  optionalFeatures: z.array(z.string().trim().min(2).max(220)).max(6),
  acceptableVariations: z.array(z.string().trim().min(2).max(220)).max(6),
  rejectIf: z.array(z.string().trim().min(2).max(220)).min(1).max(8),
  confusableWith: z.array(z.string().trim().min(2).max(220)).max(6),
  minimumConfidence: z.number().min(0.65).max(0.95),
});

const safeBingoFallback: Record<(typeof countryBingoCategories)[number], string> = {
  "Piatto tipico": "Specialità locale",
  "Bevanda locale": "Bevanda tradizionale",
  "Pane o dolce": "Pane o dolce locale",
  "Frutta o prodotto agricolo": "Prodotto agricolo locale",
  "Ceramica o artigianato": "Artigianato locale",
  "Tessuto o motivo tradizionale": "Motivo tessile tradizionale",
  "Abito tradizionale esposto": "Capo tradizionale esposto",
  "Dettaglio architettonico esterno": "Dettaglio architettonico all'aperto",
  "Decorazione o mosaico": "Decorazione tradizionale",
  "Mezzo di trasporto locale": "Trasporto locale",
  "Banconota o moneta": "Moneta locale",
  "Scritta nella lingua locale": "Scritta in lingua locale",
  "Prodotto da mercato": "Prodotto tipico locale",
  "Oggetto della tavola": "Oggetto della tavola locale",
  "Scena urbana senza persone riconoscibili": "Scena urbana tranquilla",
};
const unsafeBingoPeople = /\b(donna|donne|uomo|uomini|persona|persone|bambino|bambina|bambini|ragazzo|ragazza|volto|volti|hijab|velo|fedeli|passanti)\b/i;
const unsafeBingoAccess = /\b(interno|interni|entrare|museo|negozio|workshop|laboratorio|lezione|pernottamento|noleggio|guida|comprare|acquistare)\b/i;
function bingoRequestsUnsafeSubject(copy: string) {
  const withoutSafetyExclusions = copy
    .replace(/\b(?:senza|escludi|evita)\s+(?:alcun[ao]?\s+)?(?:persona|persone|volto|volti|passante|passanti)(?:\s+(?:identificabile|identificabili|riconoscibile|riconoscibili))?/gi, "")
    .replace(/\b(?:capo|abito)\s+tradizionale\s+esposto\s+senza\s+(?:persona|persone)\b/gi, "capo tradizionale esposto");
  return unsafeBingoPeople.test(withoutSafetyExclusions) || unsafeBingoAccess.test(withoutSafetyExclusions);
}

const bingoSchema = z.array(z.object({
  category: z.enum(countryBingoCategories),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  photoValidation: photoValidationSchema.optional(),
})).length(15).superRefine((items, context) => {
  const titles = items.map((item) => item.title.trim().toLocaleLowerCase("it"));
  if (new Set(titles).size !== items.length) {
    context.addIssue({ code: "custom", message: "Le 15 caselle del bingo devono essere tutte diverse" });
  }
  items.forEach((item, index) => {
    const copy = `${item.title} ${item.description}`.toLocaleLowerCase("it");
    if (!item.description.trim().toLocaleLowerCase("it").startsWith("fotografa")) {
      context.addIssue({ code: "custom", path: [index, "description"], message: "La casella deve richiedere una prova fotografica" });
    }
    if (bingoRequestsUnsafeSubject(copy)) {
      context.addIssue({ code: "custom", path: [index], message: "La casella non deve richiedere fotografie di persone identificabili, accessi, prenotazioni o acquisti" });
    }
  });
  for (const category of countryBingoCategories) {
    if (items.filter((item) => item.category === category).length !== 1) {
      context.addIssue({ code: "custom", message: `La categoria bingo '${category}' deve comparire esattamente una volta` });
    }
  }
});

export const countryReferenceSchema = z.object({
  usefulInfo: countryUsefulInfoSchema,
  phrasebook: phrasebookSchema,
  bingo: bingoSchema,
});

export const destinationReferenceSchema = z.object({
  quiz: z.array(z.object({
    question: z.string().min(12).max(500),
    options: z.array(z.string().min(1).max(240)).length(4).superRefine((options, context) => {
      const normalized = options.map((option) => option.trim().toLocaleLowerCase("it"));
      if (new Set(normalized).size !== 4) context.addIssue({ code: "custom", message: "Le quattro opzioni devono essere diverse" });
    }),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(10).max(1000),
    sourceUrl: z.string().url().max(500),
  })).min(7).max(15),
  missions: z.array(z.object({ title: z.string(), description: z.string(), photoValidation: photoValidationSchema.optional() })).length(5),
  games: z.array(z.object({
    type: z.enum(["photo_puzzle", "memory", "odd_one_out"]),
    title: z.string().trim().min(1).max(240),
    instructions: z.string().trim().min(1).max(1000),
    pairs: z.array(z.object({
      first: z.string().trim().min(1).max(120),
      second: z.string().trim().min(1).max(120),
    })).length(4).optional(),
    options: z.array(z.string().trim().min(1).max(160)).length(4).optional(),
    correctIndex: z.number().int().min(0).max(3).optional(),
    commonRule: z.string().trim().min(8).max(300).optional(),
    intruderReason: z.string().trim().min(8).max(300).optional(),
  }).superRefine((game, context) => {
    if (game.type === "memory" && game.pairs?.length !== 4) {
      context.addIssue({ code: "custom", message: "Il memory deve contenere esattamente quattro coppie" });
    }
    if (game.type === "odd_one_out" && (game.options?.length !== 4 || game.correctIndex == null)) {
      context.addIssue({ code: "custom", message: "Trova l'intruso deve contenere quattro opzioni e correctIndex" });
    }
    if (game.type === "odd_one_out" && (!game.commonRule || !game.intruderReason)) {
      context.addIssue({ code: "custom", message: "Trova l'intruso deve motivare l'insieme comune e l'elemento estraneo" });
    }
  })).length(3).superRefine((games, context) => {
    for (const type of ["photo_puzzle", "memory", "odd_one_out"] as const) {
      if (games.filter((game) => game.type === type).length !== 1) {
        context.addIssue({ code: "custom", message: `Deve essere presente esattamente un gioco di tipo '${type}'` });
      }
    }
  }),
  photoContests: z.array(z.object({ title: z.string(), description: z.string(), photoValidation: photoValidationSchema.optional() })).min(2).max(2),
});

const siteQuizForbiddenTopics = [
  /\b(?:valuta|moneta|som|cambio)\b/i,
  /\b(?:fuso orario|ora legale|ora solare)\b/i,
  /\b(?:visto|passaporto|document[oi]|requisiti? d['’]ingresso)\b/i,
  /\b(?:emergenza|ambulanza|polizia|vigili del fuoco|ambasciata)\b/i,
  /\b(?:buongiorno|ciao|grazie|saluto|lingua ufficiale)\b/i,
  /\b(?:piatto tradizionale|plov|frutto tipico|abito tradizionale)\b/i,
  /\b(?:clima|mezzo di trasporto|capodanno|animale nazionale)\b/i,
] as const;

function normalizedQuizText(value: string) {
  return value.trim().toLocaleLowerCase("it").replace(/\s+/g, " ");
}

export function validateSiteReferenceContent(value: z.infer<typeof destinationReferenceSchema>, siteName: string) {
  const issues: string[] = [];
  if (value.quiz.length !== 7) issues.push("Il quiz del sito deve contenere esattamente 7 domande");
  const questions = value.quiz.map((item) => normalizedQuizText(item.question));
  if (new Set(questions).size !== questions.length) issues.push("Le domande del quiz del sito devono essere tutte diverse");
  const normalizedSiteName = normalizedQuizText(siteName);
  value.quiz.forEach((item, index) => {
    const completeText = `${item.question} ${item.explanation}`;
    if (!normalizedQuizText(item.question).includes(normalizedSiteName)) {
      issues.push(`quiz.${index}.question: deve nominare esplicitamente il sito '${siteName}'`);
    }
    if (siteQuizForbiddenTopics.some((pattern) => pattern.test(completeText))) {
      issues.push(`quiz.${index}: contiene informazioni generiche del Paese invece di riguardare il sito`);
    }
    if (!normalizedQuizText(item.options[item.correctIndex] ?? "")) {
      issues.push(`quiz.${index}: la risposta corretta non è presente nelle opzioni`);
    }
  });
  validateNamedDestinationActivities(value, siteName, issues);
  if (issues.length > 0) throw new Error(issues.join("; "));
  return value;
}

function validateNamedDestinationActivities(
  value: z.infer<typeof destinationReferenceSchema>,
  destinationName: string,
  issues: string[],
) {
  const expected = normalizedQuizText(destinationName);
  const groups = [
    ...value.missions.map((item, index) => ({ path: `missions.${index}`, copy: `${item.title} ${item.description}` })),
    ...value.games.map((item, index) => ({ path: `games.${index}`, copy: `${item.title} ${item.instructions}` })),
    ...value.photoContests.map((item, index) => ({ path: `photoContests.${index}`, copy: `${item.title} ${item.description}` })),
  ];
  groups.forEach((item) => {
    if (!normalizedQuizText(item.copy).includes(expected)) {
      issues.push(`${item.path}: deve riferirsi esplicitamente a '${destinationName}'`);
    }
  });
  const missionKeys = value.missions.map((item) => normalizedQuizText(`${item.title} ${item.description}`));
  if (new Set(missionKeys).size !== missionKeys.length) issues.push("Le missioni devono essere tutte diverse");
  const contestKeys = value.photoContests.map((item) => normalizedQuizText(`${item.title} ${item.description}`));
  if (new Set(contestKeys).size !== contestKeys.length) issues.push("I contest fotografici devono essere tutti diversi");
  const memory = value.games.find((game) => game.type === "memory");
  if (memory?.pairs) {
    const pairKeys = memory.pairs.flatMap((pair) => [normalizedQuizText(pair.first), normalizedQuizText(pair.second)]);
    if (new Set(pairKeys).size !== pairKeys.length) issues.push("Le tessere del memory devono essere tutte diverse");
  }
}

export function validateCityReferenceContent(value: z.infer<typeof destinationReferenceSchema>, cityName: string) {
  const issues: string[] = [];
  if (value.quiz.length !== 10) issues.push("Il quiz della città deve contenere esattamente 10 domande");
  const normalizedCityName = normalizedQuizText(cityName);
  value.quiz.forEach((item, index) => {
    const completeText = `${item.question} ${item.explanation}`;
    if (!normalizedQuizText(item.question).includes(normalizedCityName)) {
      issues.push(`quiz.${index}.question: deve nominare esplicitamente la città '${cityName}'`);
    }
    if (siteQuizForbiddenTopics.some((pattern) => pattern.test(completeText))) {
      issues.push(`quiz.${index}: contiene informazioni generiche del Paese invece di riguardare la città`);
    }
  });
  validateNamedDestinationActivities(value, cityName, issues);
  if (issues.length > 0) throw new Error(issues.join("; "));
  return value;
}

function recordValue(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function limitArray(value: unknown, maximum: number, field: string, changes: string[]) {
  if (!Array.isArray(value) || value.length <= maximum) return value;
  changes.push(`${field}: ${value.length}→${maximum}`);
  return value.slice(0, maximum);
}

export function normalizeReferenceContent(input: unknown, kind: "country" | "destination", destinationName = "") {
  const source = recordValue(input);
  if (!source) return { value: input, changes: [] as string[] };
  const changes: string[] = [];

  if (kind === "country") {
    const bingo = limitArray(source.bingo, 15, "bingo", changes);
    const normalizedBingo = Array.isArray(bingo) ? bingo.map((item, index) => {
      const cell = recordValue(item);
      const category = cell?.category;
      if (!cell || typeof category !== "string" || !(countryBingoCategories as readonly string[]).includes(category)) return item;
      const copy = `${String(cell.title ?? "")} ${String(cell.description ?? "")}`;
      if (!bingoRequestsUnsafeSubject(copy)) return item;
      const title = safeBingoFallback[category as keyof typeof safeBingoFallback];
      changes.push(`bingo[${index}]: soggetto non sicuro sostituito`);
      return { ...cell, title, description: `Fotografa ${title.toLocaleLowerCase("it")} visibile da uno spazio pubblico o tra gli oggetti del viaggio.`, photoValidation: undefined };
    }) : bingo;
    return {
      value: {
        ...source,
        usefulInfo: limitArray(source.usefulInfo, countryUsefulInfoCategories.length, "usefulInfo", changes),
        phrasebook: limitArray(source.phrasebook, 36, "phrasebook", changes),
        bingo: normalizedBingo,
      },
      changes,
    };
  }

  const quiz = limitArray(source.quiz, 15, "quiz", changes);
  const quizItems = Array.isArray(quiz) ? quiz : [];
  const indexes = quizItems
    .map((item) => recordValue(item)?.correctIndex)
    .filter((value): value is number => typeof value === "number" && Number.isInteger(value));
  const oneBasedIndexes = indexes.length === quizItems.length && indexes.length > 0 &&
    indexes.every((value) => value >= 1 && value <= 4) && indexes.includes(4) && !indexes.includes(0);

  const normalizedQuiz = Array.isArray(quiz) ? quiz.map((item, index) => {
    const question = recordValue(item);
    if (!question) return item;
    const options = limitArray(question.options, 4, `quiz[${index}].options`, changes);
    const rawIndex = question.correctIndex;
    let correctIndex = rawIndex;
    if (typeof rawIndex === "number" && Number.isFinite(rawIndex)) {
      correctIndex = oneBasedIndexes
        ? Math.min(3, Math.max(0, Math.trunc(rawIndex) - 1))
        : Math.min(3, Math.max(0, Math.trunc(rawIndex)));
      if (correctIndex !== rawIndex) changes.push(`quiz[${index}].correctIndex: ${rawIndex}→${correctIndex}`);
    }
    return { ...question, options, correctIndex };
  }) : quiz;
  const rawGames = Array.isArray(source.games) ? source.games : [];
  const normalizedGames = ["photo_puzzle", "memory", "odd_one_out"].map((type) => {
    const game = rawGames.map(recordValue).find((item) => item?.type === type);
    if (!game) return undefined;
    if (type === "photo_puzzle") {
      const { pairs: _pairs, options: _options, correctIndex: _correctIndex, ...puzzle } = game;
      return puzzle;
    }
    if (type === "memory") {
      const { options: _options, correctIndex: _correctIndex, ...memory } = game;
      return memory;
    }
    const { pairs: _pairs, ...oddOneOut } = game;
    return oddOneOut;
  }).filter((game) => Boolean(game)) as Array<Record<string, unknown>>;
  if (rawGames.length !== normalizedGames.length) changes.push(`games: ${rawGames.length}→${normalizedGames.length}`);
  const qualifyDestinationEntries = (value: unknown, field: string) => Array.isArray(value) ? value.map((item, index) => {
    const entry = recordValue(item);
    if (!entry || !destinationName) return item;
    const copy = `${String(entry.title ?? "")} ${String(entry.description ?? entry.instructions ?? "")}`;
    if (normalizedQuizText(copy).includes(normalizedQuizText(destinationName))) return item;
    changes.push(`${field}[${index}]: aggiunto riferimento a ${destinationName}`);
    return { ...entry, title: `${destinationName}: ${String(entry.title ?? "Attività")}` };
  }) : value;

  return {
    value: {
      ...source,
      quiz: normalizedQuiz,
      missions: qualifyDestinationEntries(limitArray(source.missions, 10, "missions", changes), "missions"),
      games: qualifyDestinationEntries(normalizedGames, "games"),
      photoContests: qualifyDestinationEntries(limitArray(source.photoContests, 2, "photoContests", changes), "photoContests"),
    },
    changes,
  };
}
