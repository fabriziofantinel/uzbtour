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

const usefulInfoSchema = z.array(z.object({
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
});

const phrasebookSchema = z.array(z.object({
  language: z.string().min(1).max(80),
  term: z.string().min(1).max(500),
  pronunciation: z.string().min(1).max(500),
  translation: z.string().min(1).max(500),
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

const bingoSchema = z.array(z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
})).length(15).superRefine((items, context) => {
  const titles = items.map((item) => item.title.trim().toLocaleLowerCase("it"));
  if (new Set(titles).size !== items.length) {
    context.addIssue({ code: "custom", message: "Le 15 caselle del bingo devono essere tutte diverse" });
  }
  items.forEach((item, index) => {
    if (!item.description.trim().toLocaleLowerCase("it").startsWith("fotografa")) {
      context.addIssue({ code: "custom", path: [index, "description"], message: "La casella deve richiedere una prova fotografica" });
    }
  });
});

export const countryReferenceSchema = z.object({
  usefulInfo: usefulInfoSchema,
  phrasebook: phrasebookSchema,
  bingo: bingoSchema,
});

export const destinationReferenceSchema = z.object({
  quiz: z.array(z.object({ question: z.string(), options: z.array(z.string()).length(4), correctIndex: z.number().int().min(0).max(3), explanation: z.string() })).min(10).max(15),
  missions: z.array(z.object({ title: z.string(), description: z.string() })).min(5).max(10),
  games: z.array(z.object({ type: z.enum(["rebus", "word", "order", "riddle"]), title: z.string(), instructions: z.string(), answer: z.string() })).min(3).max(6),
  photoContests: z.array(z.object({ title: z.string(), description: z.string() })).min(2).max(2),
});

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

export function normalizeReferenceContent(input: unknown, kind: "country" | "destination") {
  const source = recordValue(input);
  if (!source) return { value: input, changes: [] as string[] };
  const changes: string[] = [];

  if (kind === "country") {
    return {
      value: {
        ...source,
        usefulInfo: limitArray(source.usefulInfo, countryUsefulInfoCategories.length, "usefulInfo", changes),
        phrasebook: limitArray(source.phrasebook, 36, "phrasebook", changes),
        bingo: limitArray(source.bingo, 15, "bingo", changes),
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

  return {
    value: {
      ...source,
      quiz: normalizedQuiz,
      missions: limitArray(source.missions, 10, "missions", changes),
      games: limitArray(source.games, 6, "games", changes),
      photoContests: limitArray(source.photoContests, 2, "photoContests", changes),
    },
    changes,
  };
}
