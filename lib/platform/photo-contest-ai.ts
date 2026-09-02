import { BedrockRuntimeClient, ConverseCommand, type ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getObjectStorage } from "./object-storage";
import { bedrockImage } from "./bedrock-image";
import { photoValidationSchema } from "./reference-content-normalizer";

const score = z.object({
  themeMatch: z.boolean(),
  matchConfidence: z.number().min(0).max(1),
  themeReason: z.string().min(1).max(600),
  composition: z.number().int().min(0).max(100),
  technical: z.number().int().min(0).max(100),
  storytelling: z.number().int().min(0).max(100),
  originality: z.number().int().min(0).max(100),
  relevance: z.number().int().min(0).max(100),
  reason: z.string().max(1200).default(""),
});
const verdictSchema = z.object({ score });
let client: BedrockRuntimeClient | null = null;
function bedrock() {
  return (client ??= new BedrockRuntimeClient({
    region: process.env.AWS_REGION,
    maxAttempts: 5,
    retryMode: "adaptive",
  }));
}
function toolInput(content: ContentBlock[] | undefined) {
  const block = content?.find((item) => "toolUse" in item)?.toolUse;
  if (!block?.input) throw new Error("Bedrock non ha restituito i punteggi del contest");
  return verdictSchema.parse(block.input);
}

export async function judgePhotoContest(input: {
  title: string;
  instructions: string;
  category: string;
  validationProfile?: unknown;
  photos: Array<{ entryId: string; bytes: Uint8Array; contentType: string }>;
}) {
  if (input.photos.length !== 2) throw new Error("Servono esattamente due foto da valutare");
  const profileResult = photoValidationSchema.safeParse(input.validationProfile),
    profile = profileResult.success ? profileResult.data : null;
  const prompt = `Sei la giuria anonima di un contest fotografico di viaggio. Tema: ${input.title}. Indicazioni: ${input.instructions}. Categoria: ${input.category}.
Scheda tecnica nascosta generata insieme al contest: ${profile ? JSON.stringify(profile) : "non disponibile; usa titolo e indicazioni"}.
Valuta questa foto. Prima stabilisci themeMatch e matchConfidence. Il titolo non è una prova visiva: confronta ciò che appare nella foto con target, visualDescription, requiredFeatures, acceptableVariations, rejectIf e confusableWith. themeMatch può essere true soltanto se il soggetto visibile è realmente coerente e non ricorre alcuna condizione rejectIf. Se gli elementi obbligatori non sono riconoscibili, se la foto mostra un soggetto confondibile diverso o se la confidence è inferiore a ${profile?.minimumConfidence ?? 0.65}, usa themeMatch=false. La parola "libero" consente libertà stilistica, non di ignorare il soggetto indicato. Una foto fuori tema non può concorrere, indipendentemente dalla qualità. Spiega in themeReason quali prove visive hai trovato o quali elementi sono incompatibili. Poi assegna: composizione 0-25, qualità tecnica 0-20, capacità narrativa 0-25, originalità 0-15, valorizzazione e aderenza al luogo/tema 0-15. Non identificare persone e non premiare attrezzatura, filigrane, testi o aspetto fisico. Scrivi una motivazione completa e concludila sempre con una frase intera, entro 1200 caratteri.`;
  const modelId = process.env.AWS_BEDROCK_TEXT_MODEL?.trim();
  if (!modelId) throw new Error("AWS_BEDROCK_TEXT_MODEL non configurato");
  return Promise.all(
    input.photos.map(async (photo) => {
      const response = await bedrock().send(
        new ConverseCommand({
          modelId,
          system: [
            {
              text: "Restituisci esclusivamente lo strumento richiesto. Applica la griglia in modo identico a ogni fotografia.",
            },
          ],
          messages: [
            { role: "user", content: [{ text: prompt }, { image: bedrockImage(photo.bytes, photo.contentType) }] },
          ],
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: "emit_photo_contest_score",
                  description: "Punteggio strutturato della fotografia",
                  inputSchema: {
                    json: z.toJSONSchema(verdictSchema, { target: "draft-7" }) as unknown as DocumentType,
                  },
                },
              },
            ],
            toolChoice: { tool: { name: "emit_photo_contest_score" } },
          },
          inferenceConfig: { maxTokens: 650, temperature: 0 },
          requestMetadata: { application: "smf-travel", operation: "photo-contest-evaluation" },
        }),
      );
      const item = toolInput(response.output?.message?.content).score;
      const threshold = profile?.minimumConfidence ?? 0.65,
        eligible = item.themeMatch && item.matchConfidence >= threshold,
        evaluationReason = item.reason || item.themeReason;
      const normalized = {
        ...item,
        entryId: photo.entryId,
        eligible,
        composition: Math.min(25, item.composition),
        technical: Math.min(20, item.technical),
        storytelling: Math.min(25, item.storytelling),
        originality: Math.min(15, item.originality),
        relevance: eligible ? Math.min(15, item.relevance) : 0,
      };
      const rawTotal =
        normalized.composition +
        normalized.technical +
        normalized.storytelling +
        normalized.originality +
        normalized.relevance;
      return {
        ...normalized,
        reason: eligible
          ? evaluationReason
          : `Foto esclusa perché non coerente con il tema: ${item.themeReason}. ${evaluationReason}`,
        total: eligible ? rawTotal : 0,
      };
    }),
  );
}

export async function processPhotoContestEvaluation(input: {
  jobId: string;
  agencyId: string;
  departureId: string;
  partyId: string;
  itemId: string;
  entryIds: string[];
}) {
  const sql = getSql(),
    claimed =
      await sql`SELECT app.claim_platform_job_v3(${input.jobId},${input.agencyId},'photo-contest.evaluate') claimed`;
  if (!Boolean(claimed[0]?.claimed)) throw new Error("Valutazione contest già elaborata o non disponibile");
  try {
    const rows =
      await sql`SELECT entry.id::text,asset.object_key,item.prompt,item.payload,activity.title,activity.instructions,activity.contest_category
      FROM journey.photo_contest_entries entry JOIN content.activities activity ON activity.id=entry.activity_id AND activity.agency_id=entry.agency_id
      JOIN content.activity_items item ON item.activity_id=activity.id AND item.agency_id=activity.agency_id AND item.item_kind='contest_rule'
      JOIN ops.media_assets asset ON asset.id=entry.media_asset_id AND asset.agency_id=entry.agency_id
      WHERE entry.agency_id=${input.agencyId} AND entry.departure_id=${input.departureId} AND entry.party_id=${input.partyId}
        AND item.id=${input.itemId}::uuid AND entry.id=ANY(${input.entryIds}::uuid[]) AND entry.status='evaluating' ORDER BY entry.participant_slot`;
    if (rows.length !== 2) throw new Error("Le due foto confermate non sono disponibili");
    const images = await Promise.all(rows.map(async (row) => getObjectStorage().get(String(row.object_key))));
    const itemPayload =
      rows[0].payload && typeof rows[0].payload === "object" && !Array.isArray(rows[0].payload)
        ? (rows[0].payload as Record<string, unknown>)
        : {};
    const evaluations = await judgePhotoContest({
      title: String(rows[0].title),
      instructions: String(rows[0].instructions || itemPayload.description || ""),
      category: String(rows[0].contest_category || "theme"),
      validationProfile: itemPayload.photoValidation,
      photos: rows.map((row, index) => ({
        entryId: String(row.id),
        bytes: images[index].bytes,
        contentType: images[index].contentType,
      })),
    });
    const modelId = process.env.AWS_BEDROCK_TEXT_MODEL!.trim();
    const saved =
      await sql`SELECT app.complete_photo_contest_evaluation_v3(${input.agencyId},${input.entryIds}::uuid[],${modelId},${JSON.stringify(evaluations)}::jsonb) best_entry_id`;
    await sql`SELECT app.complete_platform_job_v3(${input.jobId},${input.agencyId})`;
    return { bestEntryId: String(saved[0]?.best_entry_id), evaluations };
  } catch (error) {
    await sql`SELECT app.fail_platform_job_v3(${input.jobId},${input.agencyId},${error instanceof Error ? error.message : String(error)})`.catch(
      () => undefined,
    );
    throw error;
  }
}
