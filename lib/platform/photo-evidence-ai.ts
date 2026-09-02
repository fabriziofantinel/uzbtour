import { BedrockRuntimeClient, ConverseCommand, type ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getObjectStorage } from "./object-storage";
import { bedrockImage } from "./bedrock-image";
import { photoValidationSchema } from "./reference-content-normalizer";

const verdictSchema = z.object({
  compatible: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
});
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
  if (!block?.input) throw new Error("Bedrock non ha restituito una valutazione strutturata");
  return verdictSchema.parse(block.input);
}

export async function processPhotoEvidenceValidation(input: {
  jobId: string;
  agencyId: string;
  userId: string;
  departureId: string;
  partyId: string;
  dayId: string;
  itemId: string;
  mediaId: string;
  resultId: string;
  attemptNumber: number;
}) {
  const sql = getSql();
  const claimed =
    await sql`SELECT app.claim_platform_job_v3(${input.jobId},${input.agencyId},'photo-evidence.validate') claimed`;
  if (!Boolean(claimed[0]?.claimed)) throw new Error("Valutazione fotografica già elaborata o non disponibile");
  try {
    const [, rows] = await sql.transaction(
      (txn) => [
        txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,
        txn`SELECT item.prompt,item.payload,activity.activity_type,asset.object_key,asset.content_type
        FROM content.activity_items item JOIN content.activities activity ON activity.id=item.activity_id AND activity.agency_id=item.agency_id
        JOIN ops.media_assets asset ON asset.id=${input.mediaId}::uuid AND asset.agency_id=item.agency_id
          AND asset.departure_id=${input.departureId}::uuid AND asset.party_id=${input.partyId}::uuid
        WHERE item.id=${input.itemId}::uuid AND item.agency_id=${input.agencyId}::uuid
          AND activity.activity_type IN('mission','bingo') AND asset.status='ready'`,
      ],
      { readOnly: true },
    );
    const row = rows[0];
    if (!row) throw new Error("Foto o sfida non disponibile");
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const profileResult = photoValidationSchema.safeParse(payload.photoValidation);
    const profile = profileResult.success ? profileResult.data : null;
    const object = await getObjectStorage().get(String(row.object_key));
    const modelId = process.env.AWS_BEDROCK_TEXT_MODEL?.trim();
    if (!modelId) throw new Error("AWS_BEDROCK_TEXT_MODEL non configurato");
    const response = await bedrock().send(
      new ConverseCommand({
        modelId,
        system: [
          {
            text: "Valuta prove fotografiche turistiche. Considera soltanto ciò che è chiaramente visibile. Non identificare persone, non inferire dati sensibili e usa esclusivamente lo strumento richiesto.",
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              { image: bedrockImage(object.bytes, object.contentType) },
              {
                text: `Tipo: ${String(row.activity_type)}. Tema da verificare: ${String(row.prompt).slice(0, 1000)}. Scheda tecnica nascosta generata per questa sfida: ${profile ? JSON.stringify(profile) : "non disponibile; usa il solo tema"}. Confronta ciò che è realmente visibile con target, visualDescription, requiredFeatures, acceptableVariations, rejectIf e confusableWith. Non considerare il titolo come prova che il soggetto sia presente. compatible=true soltanto se la foto soddisfa il tema, non presenta condizioni rejectIf e mostra prove visive sufficienti; in caso di dubbio usa false. Spiega brevemente in italiano quali caratteristiche hai rilevato o quali mancano, senza descrivere o identificare persone.`,
              },
            ],
          },
        ],
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: "emit_photo_evidence_verdict",
                description: "Esito strutturato della verifica fotografica",
                inputSchema: { json: z.toJSONSchema(verdictSchema, { target: "draft-7" }) as unknown as DocumentType },
              },
            },
          ],
          toolChoice: { tool: { name: "emit_photo_evidence_verdict" } },
        },
        inferenceConfig: { maxTokens: 300, temperature: 0 },
        requestMetadata: { application: "smf-travel", operation: "photo-evidence-validation" },
      }),
    );
    const verdict = toolInput(response.output?.message?.content),
      approved = verdict.compatible && verdict.confidence >= (profile?.minimumConfidence ?? 0.65);
    await sql.transaction((txn) => [
      txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,
      txn`SELECT * FROM app.save_activity_item_result_v3(${input.userId},${input.agencyId},${input.departureId},${input.partyId},${input.dayId},${input.itemId},${input.resultId},${approved ? 10 : 0},10,${approved ? "approved" : "rejected"},${JSON.stringify({ mediaId: input.mediaId, aiValidation: { approved, confidence: verdict.confidence, reason: verdict.reason, modelId, status: approved ? "approved" : "rejected", attemptCount: input.attemptNumber, attemptsRemaining: approved ? 0 : Math.max(0, 2 - input.attemptNumber) } })}::jsonb,${input.mediaId}::uuid)`,
    ]);
    await sql`SELECT app.complete_platform_job_v3(${input.jobId},${input.agencyId})`;
    return { approved, confidence: verdict.confidence };
  } catch (error) {
    await sql`SELECT app.fail_platform_job_v3(${input.jobId},${input.agencyId},${error instanceof Error ? error.message : String(error)})`.catch(
      () => undefined,
    );
    throw error;
  }
}
