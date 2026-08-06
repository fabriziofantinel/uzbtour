import { get } from "@vercel/blob";
import sharp from "sharp";
import { getSql } from "./db";
import { quizDays } from "./quiz-data";

export const MAX_CONTEST_PHOTOS = 12;
export const MAX_PHOTOS_PER_PARTICIPANT = 3;
export const PHOTO_CONTEST_TYPES = ["free", "theme"] as const;
export type PhotoContestType = typeof PHOTO_CONTEST_TYPES[number];
export const GEMINI_PHOTO_MODEL = process.env.GEMINI_PHOTO_MODEL || "gemini-2.5-flash";
export const GEMINI_PHOTO_FALLBACK_MODEL =
  process.env.GEMINI_PHOTO_FALLBACK_MODEL || "gemini-2.5-flash-lite";
export const GEMINI_PHOTO_EMERGENCY_MODEL =
  process.env.GEMINI_PHOTO_EMERGENCY_MODEL || "gemini-2.5-pro";

const GEMINI_MAX_ATTEMPTS = 4;
const GEMINI_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const photoThemes: Record<number, { themeTitle: string; themeDescription: string }> = {
  12: { themeTitle: "L’inizio dell’avventura", themeDescription: "Uno scatto che trasmetta attesa, movimento o emozione per la partenza." },
  1: { themeTitle: "Il primo incontro", themeDescription: "La fotografia che racconta meglio il primo impatto con l’Uzbekistan." },
  2: { themeTitle: "Geometrie di Khiva", themeDescription: "Linee, forme e colori capaci di valorizzare Ichan Kala." },
  3: { themeTitle: "Dal finestrino", themeDescription: "Il paesaggio o il momento di viaggio più narrativo sul treno." },
  4: { themeTitle: "Bukhara senza tempo", themeDescription: "Uno scatto che faccia percepire storia, artigianato o vita quotidiana." },
  5: { themeTitle: "Luce sulla Via della Seta", themeDescription: "La luce più suggestiva tra Bukhara, il viaggio e il Registan." },
  6: { themeTitle: "Il blu di Samarcanda", themeDescription: "La migliore interpretazione delle celebri sfumature della città." },
  7: { themeTitle: "Grandezza e memoria", themeDescription: "Una foto che racconti la monumentalità di Shahrisabz e Amir Temur." },
  8: { themeTitle: "Dettagli che raccontano", themeDescription: "Un particolare di maiolica, astronomia o carta capace di narrare la giornata." },
  9: { themeTitle: "Mani e colori", themeDescription: "Artigianato, ceramiche o persone della Valle di Fergana." },
  10: { themeTitle: "Seta in movimento", themeDescription: "Colori, trame e gesti legati alla seta e ai bazar di Margilan." },
  11: { themeTitle: "L’ultimo sguardo", themeDescription: "Il luogo o il momento che vorresti portare a casa da Tashkent." },
  13: { themeTitle: "Il viaggio in una foto", themeDescription: "Lo scatto che riassume meglio l’intera avventura in Uzbekistan." }
};

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
    unlockAt: "2026-08-01T15:00:00.000Z",
    ...photoThemes[12]
  },
  ...quizDays.map((day) => ({ ...day, label: `GIORNO ${day.day}`, ...photoThemes[day.day] })),
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
    unlockAt: "2026-08-13T15:00:00.000Z",
    ...photoThemes[13]
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
        CREATE TABLE IF NOT EXISTS trip_contest_photos (
          id BIGSERIAL PRIMARY KEY,
          day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 13),
          contest_type TEXT NOT NULL CHECK (contest_type IN ('free', 'theme')),
          participant_slot SMALLINT NOT NULL CHECK (participant_slot BETWEEN 1 AND 3),
          pathname TEXT NOT NULL UNIQUE,
          original_name TEXT NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
          content_type TEXT NOT NULL,
          size_bytes BIGINT,
          uploaded_by_id TEXT NOT NULL,
          uploaded_by_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (day, contest_type, uploaded_by_id, participant_slot)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS trip_contest_photos_day_type_idx
        ON trip_contest_photos (day, contest_type, created_at)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS trip_daily_photo_contests (
          day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 13),
          contest_type TEXT NOT NULL CHECK (contest_type IN ('free', 'theme')),
          status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
          winner_photo_id BIGINT REFERENCES trip_contest_photos(id) ON DELETE SET NULL,
          winner_score SMALLINT CHECK (winner_score BETWEEN 0 AND 100),
          winner_reason TEXT,
          rankings JSONB NOT NULL DEFAULT '[]'::JSONB,
          judged_by_id TEXT NOT NULL,
          judged_by_name TEXT NOT NULL,
          model TEXT NOT NULL,
          error_message TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          PRIMARY KEY (day, contest_type)
        )
      `;
    })().catch((error) => {
      photoContestSchemaPromise = null;
      throw error;
    });
  }
  await photoContestSchemaPromise;
}

export function validPhotoContestType(value: unknown): value is PhotoContestType {
  return PHOTO_CONTEST_TYPES.includes(value as PhotoContestType);
}

export function photoContestDefinition(day: number, contestType: PhotoContestType) {
  const tripDay = photoContestDay(day);
  if (!tripDay) return null;
  return contestType === "free"
    ? {
        type: contestType,
        title: "Tema libero",
        description: "Scegli i tuoi scatti migliori della giornata, senza alcun vincolo di soggetto o stile."
      }
    : {
        type: contestType,
        title: tripDay.themeTitle,
        description: tripDay.themeDescription
      };
}

export function validContestPhotoPath(
  pathname: unknown,
  day: number,
  contestType: PhotoContestType
) {
  if (typeof pathname !== "string") return false;
  return new RegExp(
    `^uzbekistan-2026/contest/giorno-${day}/${contestType}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|heic|heif)$`,
    "i"
  ).test(pathname);
}

export async function saveContestPhotoMetadata(input: {
  day: number;
  contestType: PhotoContestType;
  pathname: string;
  originalName: string;
  contentType: string;
  sizeBytes?: number | null;
  user: { id: string; name: string };
}) {
  await ensurePhotoContestsTable();
  const sql = getSql();
  const existingRows = await sql`
    SELECT id, day, contest_type, participant_slot, pathname, original_name,
           content_type, size_bytes, uploaded_by_id, uploaded_by_name, created_at
    FROM trip_contest_photos
    WHERE pathname = ${input.pathname}
    LIMIT 1
  `;
  if (existingRows[0]) {
    const existing = existingRows[0];
    if (
      Number(existing.day) !== input.day ||
      String(existing.contest_type) !== input.contestType ||
      String(existing.uploaded_by_id) !== input.user.id
    ) {
      throw new Error("La foto risulta già associata a un altro caricamento");
    }
    return existing;
  }

  const rows = await sql`
    WITH available_slot AS (
      SELECT candidate.slot
      FROM generate_series(1, ${MAX_PHOTOS_PER_PARTICIPANT}) AS candidate(slot)
      WHERE NOT EXISTS (
        SELECT 1
        FROM trip_contest_photos existing
        WHERE existing.day = ${input.day}
          AND existing.contest_type = ${input.contestType}
          AND existing.uploaded_by_id = ${input.user.id}
          AND existing.participant_slot = candidate.slot
      )
      ORDER BY candidate.slot
      LIMIT 1
    )
    INSERT INTO trip_contest_photos (
      day, contest_type, participant_slot, pathname, original_name,
      content_type, size_bytes, uploaded_by_id, uploaded_by_name
    )
    SELECT
      ${input.day}, ${input.contestType}, available_slot.slot, ${input.pathname},
      ${input.originalName}, ${input.contentType}, ${input.sizeBytes ?? null},
      ${input.user.id}, ${input.user.name}
    FROM available_slot
    ON CONFLICT (pathname) DO UPDATE SET
      original_name = EXCLUDED.original_name,
      content_type = EXCLUDED.content_type,
      size_bytes = COALESCE(EXCLUDED.size_bytes, trip_contest_photos.size_bytes)
    RETURNING id, day, contest_type, participant_slot, pathname, original_name,
              content_type, size_bytes, uploaded_by_id, uploaded_by_name, created_at
  `;
  if (!rows[0]) {
    throw new Error(`Hai già caricato ${MAX_PHOTOS_PER_PARTICIPANT} foto in questo contest`);
  }
  return rows[0];
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

function geminiErrorDetail(rawDetail: string, status: number) {
  const fallback = rawDetail.trim().replace(/\s+/g, " ");

  try {
    const payload = JSON.parse(rawDetail) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        details?: Array<Record<string, unknown>>;
      };
    };
    const apiError = payload.error;
    const reasons = (apiError?.details ?? [])
      .flatMap((detail) => {
        const violations = detail.violations;
        if (!Array.isArray(violations)) return [];
        return violations.flatMap((violation) => {
          if (!violation || typeof violation !== "object") return [];
          const reason = (violation as Record<string, unknown>).quotaMetric;
          return typeof reason === "string" ? [reason] : [];
        });
      });
    const parts = [
      `HTTP ${apiError?.code ?? status}`,
      apiError?.status,
      apiError?.message,
      ...reasons
    ].filter((part): part is string => typeof part === "string" && Boolean(part.trim()));
    if (parts.length > 1) return [...new Set(parts)].join(" — ").slice(0, 700);
  } catch {
    // Some upstream errors are plain text rather than JSON.
  }

  return [`HTTP ${status}`, fallback].filter(Boolean).join(" — ").slice(0, 700);
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
      const diagnosticDetail = geminiErrorDetail(detail, response.status);
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
        `Errore Gemini: ${diagnosticDetail}`,
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
        `Gemini non raggiungibile: ${
          error instanceof Error ? error.message : String(error)
        }`,
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
  themeTitle: string;
  themeDescription: string;
}, model: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY non configurata");

  const image = await loadPrivatePhoto(input.pathname);
  const prompt = [
    "Sei la giuria anonima di un concorso fotografico di viaggio.",
    `La foto è stata scattata durante il giorno ${input.day} del tour in ${input.city}.`,
    `Luoghi ed esperienze della giornata: ${input.highlights.join(", ")}.`,
    `Tema fotografico del giorno: "${input.themeTitle}".`,
    `Interpretazione richiesta: ${input.themeDescription}`,
    "Valuta soltanto la fotografia, senza tentare di identificare l'autore e senza giudicare l'aspetto fisico delle persone ritratte.",
    "Usa esattamente questa griglia: composizione 0-25, qualità tecnica 0-20, capacità narrativa 0-25, originalità 0-15, valorizzazione del luogo 0-15.",
    "Nel punteggio di capacità narrativa e originalità considera anche quanto lo scatto interpreta creativamente il tema del giorno.",
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

export async function judgePhotos(
  inputs: Array<Parameters<typeof judgeOnePhoto>[0]>,
  options: {
    existingRankings?: PhotoScore[];
    onProgress?: (rankings: PhotoScore[], model: string) => Promise<void>;
  } = {}
) {
  const inputIds = new Set(inputs.map((input) => input.id));
  const rankings = (options.existingRankings ?? [])
    .filter((score) => inputIds.has(String(score.photoId)));
  const completedPhotoIds = new Set(rankings.map((score) => String(score.photoId)));
  const usedModels = new Set<string>();
  const models = [
    GEMINI_PHOTO_MODEL,
    GEMINI_PHOTO_FALLBACK_MODEL,
    GEMINI_PHOTO_EMERGENCY_MODEL
  ].filter((model, index, allModels) => allModels.indexOf(model) === index);

  // Quotas are enforced per project. Sequential requests avoid the 429 bursts
  // caused by judging multiple image entries at the same time.
  for (const input of inputs) {
    if (completedPhotoIds.has(input.id)) continue;

    let lastError: unknown;
    let scored = false;

    for (const [modelIndex, model] of models.entries()) {
      try {
        const score = await judgeOnePhoto(input, model);
        rankings.push(score);
        completedPhotoIds.add(input.id);
        usedModels.add(model);
        await options.onProgress?.([...rankings], [...usedModels].join(" + "));
        scored = true;
        break;
      } catch (error) {
        lastError = error;
        const nextModel = models[modelIndex + 1];
        const modelUnavailable =
          error instanceof GeminiRequestError && error.status === 404;
        if (
          !(error instanceof GeminiRequestError) ||
          (!error.transient && !modelUnavailable) ||
          !nextModel
        ) {
          break;
        }
        console.warn("Gemini photo judge switching model for one photo", {
          photoId: input.id,
          from: model,
          to: nextModel,
          status: error.status
        });
      }
    }

    if (!scored) {
        throw new Error(
          `Impossibile valutare “${input.originalName}”: ${
            lastError instanceof Error ? lastError.message : "errore sconosciuto"
          }. I punteggi già completati sono stati salvati: premi Riprova per continuare da questa foto.`
        );
    }
  }

  rankings.sort((left, right) =>
    right.total - left.total ||
    right.storytelling - left.storytelling ||
    right.composition - left.composition ||
    right.originality - left.originality ||
    Number(left.photoId) - Number(right.photoId)
  );

  return {
    rankings,
    model: [...usedModels].join(" + ") || GEMINI_PHOTO_MODEL
  };
}
