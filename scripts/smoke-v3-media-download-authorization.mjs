import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const runtimeUrl=process.env.DATABASE_URL;
if(!runtimeUrl) throw new Error("DATABASE_URL runtime non configurata");
const client=new Client(runtimeUrl);
try{
  await client.connect();
  const role=(await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const gates=(await client.query(`SELECT
    has_function_privilege(current_user,'app.resolve_legacy_memory_download(text,uuid)','EXECUTE') memory,
    has_function_privilege(current_user,'app.resolve_legacy_travel_document_download(text,uuid)','EXECUTE') document,
    NOT has_table_privilege(current_user,'ops.legacy_id_map','SELECT') identity_map_private`)).rows[0];
  if(!gates||Object.values(gates).some((value)=>value!==true)) throw new Error(`Gate runtime incompleti: ${JSON.stringify(gates)}`);

  const memoryCandidate=(await client.query(`SELECT profile.user_id,memory.id
    FROM public.party_memories memory
    JOIN public.traveler_profiles profile ON profile.agency_id=memory.agency_id
    JOIN public.party_memberships membership ON membership.party_id=memory.party_id
      AND membership.traveler_id=profile.id AND membership.status='active'
    JOIN public.media_assets asset ON asset.id=memory.media_asset_id
      AND asset.agency_id=memory.agency_id AND asset.status='ready'
    WHERE profile.user_id IS NOT NULL LIMIT 1`)).rows[0];
  const memoryAuthorized=memoryCandidate
    ? (await client.query("SELECT 1 FROM app.resolve_legacy_memory_download($1,$2)",
        [memoryCandidate.user_id,memoryCandidate.id])).rowCount===1
    : null;
  if(memoryAuthorized===false) throw new Error("Download ricordo valido non autorizzato");

  const documentCandidate=(await client.query(`SELECT membership.user_id,document.id
    FROM public.itinerary_item_documents document
    JOIN public.agency_memberships membership ON membership.agency_id=document.agency_id
      AND membership.role IN ('owner','admin','editor')
    JOIN public.media_assets asset ON asset.id=document.media_asset_id
      AND asset.agency_id=document.agency_id AND asset.status='ready'
    LIMIT 1`)).rows[0];
  const documentAuthorized=documentCandidate
    ? (await client.query("SELECT 1 FROM app.resolve_legacy_travel_document_download($1,$2)",
        [documentCandidate.user_id,documentCandidate.id])).rowCount===1
    : null;
  if(documentAuthorized===false) throw new Error("Download documento valido non autorizzato");

  const foreignUser=randomUUID();
  const memoryDenied=(await client.query("SELECT 1 FROM app.resolve_legacy_memory_download($1,$2)",
    [foreignUser,memoryCandidate?.id??randomUUID()])).rowCount===0;
  const documentDenied=(await client.query("SELECT 1 FROM app.resolve_legacy_travel_document_download($1,$2)",
    [foreignUser,documentCandidate?.id??randomUUID()])).rowCount===0;
  if(!memoryDenied||!documentDenied) throw new Error("Un utente estraneo ha ottenuto un download privato");

  console.log(JSON.stringify({status:"passed",role,gates,memoryAuthorized,
    documentAuthorized,foreignMemoryDenied:memoryDenied,foreignDocumentDenied:documentDenied},null,2));
}finally{await client.end().catch(()=>undefined);}
