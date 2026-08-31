"use client";
export type OfflinePackageState="idle"|"downloading"|"ready"|"failed";
export type OfflinePackageResult={skipped:number};
export async function downloadTripForOffline(urls:string[],onProgress:(done:number,total:number)=>void):Promise<OfflinePackageResult>{
  const registration=await navigator.serviceWorker.ready;
  if(!registration.active)throw new Error("Servizio offline non disponibile");
  const unique=[...new Set(urls)];
  return new Promise<OfflinePackageResult>((resolve,reject)=>{
    const channel=new MessageChannel();
    channel.port1.onmessage=(event)=>{const data=event.data||{};if(data.type==="OFFLINE_PROGRESS")onProgress(data.done,data.total);if(data.type==="OFFLINE_READY")resolve({skipped:Number(data.skipped)||0});if(data.type==="OFFLINE_FAILED")reject(new Error(data.message||"Download offline non riuscito"));};
    registration.active!.postMessage({type:"CACHE_TRIP",urls:unique},[channel.port2]);
  });
}
