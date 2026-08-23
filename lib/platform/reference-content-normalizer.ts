import { z } from "zod";

export const countryReferenceSchema = z.object({
  usefulInfo: z.array(z.object({ category: z.string(), title: z.string(), body: z.string() })).min(6).max(18),
  phrasebook: z.array(z.object({ language: z.string(), term: z.string(), pronunciation: z.string(), translation: z.string() })).min(12).max(30),
  bingo: z.array(z.object({ title: z.string(), description: z.string() })).min(16).max(25),
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
        usefulInfo: limitArray(source.usefulInfo, 18, "usefulInfo", changes),
        phrasebook: limitArray(source.phrasebook, 30, "phrasebook", changes),
        bingo: limitArray(source.bingo, 25, "bingo", changes),
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
