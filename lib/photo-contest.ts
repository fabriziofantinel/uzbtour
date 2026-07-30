import { get } from "@vercel/blob";
import sharp from "sharp";
import { getSql } from "./db";
import { quizDays } from "./quiz-data";

export const MAX_CONTEST_PHOTOS = 60;
export const GEMINI_PHOTO_MODEL = process.env.GEMINI_PHOTO_MODEL || "gemini-3.6-flash";
export const GEMINI_PHOTO_FALLBACK_MODEL =
  process.env.GEMINI_PHOTO_FALLBACK_MODEL || "gemini-3.5-flash";

const GEMINI_MAX_ATTEMPTS = 4;
const GEMINI_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export const photoContestDays = [
  {
    day: 12,
    label: "PARTENZA",
    date: "1 agosto",
    city: "Torino, Istanbul e volo verso Tashkent",
    highlights: [
      "Partenza dall’Aeroporto di Torino",
      "Volo Turkish Airlines TK1310",
      "Scalo all’Aeroporto di Istanbul",
      "Volo Turkish Airlines TK370 verso Tashkent"
    ],
    unlockAt: "2026-08-01T15:00:00.000Z"
  },
  ...quizDays.map((day) => ({ ...day, label: `GIORNO ${day.day}` })),
  {
    day: 13,
    label: "RIENTRO",
    date: "13 agosto",
    city: "Tashkent, Istanbul e Torino",
    highlights: [
      "Partenza dall’Aeroporto di Tashkent",
      "Volo Turkish Airlines TK363",
      "Scalo all’Aeroporto di Istanbul",
      "Volo Turkish Airlines TK1309 e arrivo a Torino"
    ],
    unlockAt: "2026-08-13T15:00:00.000Z"
  }
];

export type PhotoScore = {
  photoId: string;
  originalName: string;
  addedBy: string;
  composition: number;
  technical: number;
  storytelling: number;
  originality: number;
  relevance: number;
  total: number;
  rationale: string;
};

let photoContestSchemaPromise: Promise<void> | null = null;

export async function ensurePhotoContestsTable() {
  const sql = getSql();
  if (!photoContestSchemaPromise) {
    photoContestSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS trip_photo_contests (
          day SMALLINT PRIMARY KEY CHECK (day BETWEEN 1 AND 13),
          status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
          winner_photo_id BIGINT REFERENCES trip_photos(id) ON DELETE SET NULL,
          winner_score SMALLINT CHECK (winner_score BETWEEN 0 AND 100),
          winner_reason TEXT,
          rankings JSONB NOT NULL DEFAULT '[]'::JSONB,
          judged_by_id TEXT NOT NULL,
          judged_by_name TEXT NOT NULL,
          model TEXT NOT NULL,
          error_message TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `;
    })().catch((error) => {
      photoContestSchemaPromise = null;
      throw error;
    });
  }
  await photoContestSchemaPromise;
}

export function photoContestDay(day: unknown) {
  const numericDay = Number(day);
  return Number.isInteger(numericDay) && numericDay >= 1 && numericDay <= 13
    ? photoContestDays.find((entry) => entry.day === numericDay) ?? null
    : null;
}

export function isPhotoContestUnlocked(day: number, now = new Date()) {
  const tripDay = photoContestDays.find((entry) => entry.day === day);
  return Boolean(tripDay && now.getTime() >= new Date(tripDay.unlockAt).getTime());
}

function clampScore(value: unknown, maximum: number) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(maximum, Math.round(numericValue)));
}

function responseText(payload: Record<string, unknown>) {
  const candidates = payload.candidates as Array<Record<string, unknown>> | undefined;
  const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  const text = parts?.find((part) => typeof part.text === "string")?.text;
  if (typeof text !== "string" || !text) {
    throw new Error("Gemini non ha restituito una valutazione");
  }
  return text;
}

class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly status?: number
  ) {
    super(message);
    this.name = "GeminiRequestError";
  }
}

function retryDelay(attempt: number) {
  const exponentialDelay = 1_000 * (2 ** attempt);
  const jitter = Math.floor(Math.random() * 500);
  return exponentialDelay + jitter;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestGemini(model: string, apiKey: string, body: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body,
        signal: AbortSignal.timeout(90_000)
      });

      if (response.ok) return response;

      const detail = await response.text().catch(() => "");
      const transient = GEMINI_RETRYABLE_STATUS.has(response.status);
      const lastAttempt = attempt === GEMINI_MAX_ATTEMPTS - 1;

      if (transient && !lastAttempt) {
        const delay = retryDelay(attempt);
        console.warn("Gemini photo judge retry", {
          model,
          status: response.status,
          attempt: attempt + 1,
          delay
        });
        await wait(delay);
        continue;
      }

      console.error("Gemini photo judge error", {
        model,
        status: response.status,
        detail: detail.slice(0, 500)
      });
      throw new GeminiRequestError(
        transient
          ? "Gemini è temporaneamente sovraccarico. Riprova tra qualche minuto."
          : `Gemini non disponibile (${response.status})`,
        transient,
        response.status
      );
    } catch (error) {
      if (error instanceof GeminiRequestError) throw error;

      const lastAttempt = attempt === GEMINI_MAX_ATTEMPTS - 1;
      if (!lastAttempt) {
        const delay = retryDelay(attempt);
        console.warn("Gemini photo judge network retry", {
          model,
          attempt: attempt + 1,
          delay,
          error: error instanceof Error ? error.message : String(error)
        });
        await wait(delay);
        continue;
      }

      throw new GeminiRequestError(
        "Gemini non è raggiungibile. Riprova tra qualche minuto.",
        true
      );
    }
  }

  throw new GeminiRequestError("Gemini temporaneamente non disponibile", true);
}

async function loadPrivatePhoto(pathname: string) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) {
    throw new Error("Una foto del concorso non è più disponibile");
  }
  const bytes = await new Response(result.stream).arrayBuffer();
  const optimized = await sharp(Buffer.from(bytes), { limitInputPixels: 80_000_000 })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return {
    data: optimized.toString("base64"),
    mimeType: "image/jpeg"
  };
}

async function judgeOnePhoto(input: {
  id: string;
  pathname: string;
  originalName: string;
  addedBy: string;
  day: number;
  city: string;
  highlights: string[];
}, model: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY non configurata");

  const image = await loadPrivatePhoto(input.pathname);
  const prompt = [
    "Sei la giuria anonima di un concorso fotografico di viaggio.",
    `La foto è stata scattata durante il giorno ${input.day} del tour in ${input.city}.`,
    `Luoghi ed esperienze della giornata: ${input.highlights.join(", ")}.`,
    "Valuta soltanto la fotografia, senza tentare di identificare l'autore e senza giudicare l'aspetto fisico delle persone ritratte.",
    "Usa esattamente questa griglia: composizione 0-25, qualità tecnica 0-20, capacità narrativa 0-25, originalità 0-15, valorizzazione del luogo 0-15.",
    "Non premiare il tipo di fotocamera, filigrane, testo sovrapposto o volti attraenti.",
    "La motivazione deve essere in italiano, concreta, rispettosa e non superare 240 caratteri."
  ].join("\n");

  const body = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: image.mimeType, data: image.data } }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          composition: { type: "INTEGER" },
          technical: { type: "INTEGER" },
          storytelling: { type: "INTEGER" },
          originality: { type: "INTEGER" },
          relevance: { type: "INTEGER" },
          rationale: { type: "STRING" }
        },
        required: [
          "composition",
          "technical",
          "storytelling",
          "originality",
          "relevance",
          "rationale"
        ]
      }
    }
  });
  const response = await requestGemini(model, apiKey, body);

  const payload = await response.json() as Record<string, unknown>;
  const parsed = JSON.parse(responseText(payload)) as Record<string, unknown>;
  const composition = clampScore(parsed.composition, 25);
  const technical = clampScore(parsed.technical, 20);
  const storytelling = clampScore(parsed.storytelling, 25);
  const originality = clampScore(parsed.originality, 15);
  const relevance = clampScore(parsed.relevance, 15);
  const rationale = typeof parsed.rationale === "string"
    ? parsed.rationale.trim().slice(0, 240)
    : "Una fotografia capace di raccontare la giornata.";

  return {
    photoId: input.id,
    originalName: input.originalName,
    addedBy: input.addedBy,
    composition,
    technical,
    storytelling,
    originality,
    relevance,
    total: composition + technical + storytelling + originality + relevance,
    rationale
  } satisfies PhotoScore;
}

async function judgePhotosWithModel(
  inputs: Array<Parameters<typeof judgeOnePhoto>[0]>,
  model: string
) {
  const scores: PhotoScore[] = [];
  const batchSize = 2;

  for (let index = 0; index < inputs.length; index += batchSize) {
    scores.push(...await Promise.all(
      inputs.slice(index, index + batchSize).map((input) => judgeOnePhoto(input, model))
    ));
  }

  return scores.sort((left, right) =>
    right.total - left.total ||
    right.storytelling - left.storytelling ||
    right.composition - left.composition ||
    right.originality - left.originality ||
    Number(left.photoId) - Number(right.photoId)
  );
}

export async function judgePhotos(inputs: Array<Parameters<typeof judgeOnePhoto>[0]>) {
  try {
    return {
      rankings: await judgePhotosWithModel(inputs, GEMINI_PHOTO_MODEL),
      model: GEMINI_PHOTO_MODEL
    };
  } catch (error) {
    if (
      !(error instanceof GeminiRequestError) ||
      !error.transient ||
      GEMINI_PHOTO_FALLBACK_MODEL === GEMINI_PHOTO_MODEL
    ) {
      throw error;
    }

    console.warn("Gemini photo judge switching model", {
      from: GEMINI_PHOTO_MODEL,
      to: GEMINI_PHOTO_FALLBACK_MODEL,
      status: error.status
    });
    return {
      rankings: await judgePhotosWithModel(inputs, GEMINI_PHOTO_FALLBACK_MODEL),
      model: GEMINI_PHOTO_FALLBACK_MODEL
    };
  }
}
