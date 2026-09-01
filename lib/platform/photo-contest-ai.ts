import {BedrockRuntimeClient,ConverseCommand,type ContentBlock} from "@aws-sdk/client-bedrock-runtime";
import type{DocumentType}from"@smithy/types";
import{z}from"zod";
import{getSql}from"@/lib/db";
import{getObjectStorage}from"./object-storage";
import{bedrockImage}from"./bedrock-image";

const score=z.object({entryId:z.string().uuid(),composition:z.number().int().min(0).max(25),technical:z.number().int().min(0).max(20),storytelling:z.number().int().min(0).max(25),originality:z.number().int().min(0).max(15),relevance:z.number().int().min(0).max(15),reason:z.string().min(1)});
const verdictSchema=z.object({scores:z.array(score).length(2)});
let client:BedrockRuntimeClient|null=null;
function bedrock(){return client??=new BedrockRuntimeClient({region:process.env.AWS_REGION,maxAttempts:5,retryMode:"adaptive"});}
function toolInput(content:ContentBlock[]|undefined){const block=content?.find((item)=>"toolUse" in item)?.toolUse;if(!block?.input)throw new Error("Bedrock non ha restituito i punteggi del contest");return verdictSchema.parse(block.input);}

export async function processPhotoContestEvaluation(input:{jobId:string;agencyId:string;departureId:string;partyId:string;itemId:string;entryIds:string[]}){
  const sql=getSql(),claimed=await sql`SELECT app.claim_platform_job_v3(${input.jobId},${input.agencyId},'photo-contest.evaluate') claimed`;
  if(!Boolean(claimed[0]?.claimed))throw new Error("Valutazione contest già elaborata o non disponibile");
  try{
    const rows=await sql`SELECT entry.id::text,asset.object_key,item.prompt,item.payload,activity.title,activity.instructions,activity.contest_category
      FROM journey.photo_contest_entries entry JOIN content.activities activity ON activity.id=entry.activity_id AND activity.agency_id=entry.agency_id
      JOIN content.activity_items item ON item.activity_id=activity.id AND item.agency_id=activity.agency_id AND item.item_kind='contest_rule'
      JOIN ops.media_assets asset ON asset.id=entry.media_asset_id AND asset.agency_id=entry.agency_id
      WHERE entry.agency_id=${input.agencyId} AND entry.departure_id=${input.departureId} AND entry.party_id=${input.partyId}
        AND item.id=${input.itemId}::uuid AND entry.id=ANY(${input.entryIds}::uuid[]) AND entry.status='evaluating' ORDER BY entry.participant_slot`;
    if(rows.length!==2)throw new Error("Le due foto confermate non sono disponibili");
    const images=await Promise.all(rows.map(async(row)=>getObjectStorage().get(String(row.object_key))));
    const content:ContentBlock[]=[{text:`Sei la giuria anonima di un contest fotografico di viaggio. Tema: ${String(rows[0].title)}. Indicazioni: ${String(rows[0].instructions||((rows[0].payload as Record<string,unknown>)?.description)||"")}. Categoria: ${String(rows[0].contest_category||"theme")}.
Valuta separatamente entrambe le foto. Griglia obbligatoria: composizione 0-25, qualità tecnica 0-20, capacità narrativa 0-25, originalità 0-15, valorizzazione e aderenza al luogo/tema 0-15. Per tema libero la rilevanza valuta la capacità di raccontare il viaggio. Non identificare persone e non premiare attrezzatura, filigrane, testi o aspetto fisico. Per ogni foto scrivi una motivazione concisa, lunga al massimo 500 caratteri.`}];
    rows.forEach((row,index)=>content.push({text:`Foto ${index+1}, entryId ${String(row.id)}`},{image:bedrockImage(images[index].bytes,images[index].contentType)}));
    const modelId=process.env.AWS_BEDROCK_TEXT_MODEL?.trim();if(!modelId)throw new Error("AWS_BEDROCK_TEXT_MODEL non configurato");
    const response=await bedrock().send(new ConverseCommand({modelId,system:[{text:"Restituisci esclusivamente lo strumento richiesto. I punteggi devono essere coerenti e comparabili."}],messages:[{role:"user",content}],toolConfig:{tools:[{toolSpec:{name:"emit_photo_contest_scores",description:"Punteggi strutturati delle due fotografie",inputSchema:{json:z.toJSONSchema(verdictSchema,{target:"draft-7"})as unknown as DocumentType}}}],toolChoice:{tool:{name:"emit_photo_contest_scores"}}},inferenceConfig:{maxTokens:700,temperature:0},requestMetadata:{application:"smf-travel",operation:"photo-contest-evaluation"}}));
    const verdict=toolInput(response.output?.message?.content);
    const expected=new Set(input.entryIds);if(verdict.scores.some(item=>!expected.has(item.entryId))||new Set(verdict.scores.map(item=>item.entryId)).size!==2)throw new Error("Bedrock ha restituito identificativi foto non validi");
    const evaluations=verdict.scores.map(item=>({...item,reason:item.reason.slice(0,500),total:item.composition+item.technical+item.storytelling+item.originality+item.relevance}));
    const saved=await sql`SELECT app.complete_photo_contest_evaluation_v3(${input.agencyId},${input.entryIds}::uuid[],${modelId},${JSON.stringify(evaluations)}::jsonb) best_entry_id`;
    await sql`SELECT app.complete_platform_job_v3(${input.jobId},${input.agencyId})`;
    return{bestEntryId:String(saved[0]?.best_entry_id),evaluations};
  }catch(error){await sql`SELECT app.fail_platform_job_v3(${input.jobId},${input.agencyId},${error instanceof Error?error.message:String(error)})`.catch(()=>undefined);throw error;}
}
