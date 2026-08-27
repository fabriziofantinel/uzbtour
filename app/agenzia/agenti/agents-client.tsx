"use client";

import Link from "next/link";
import { Accessibility, Building2, CheckCircle2, ChevronDown, CircleAlert, LoaderCircle, LogOut, Mail, MapPinned, Phone, Plus, UserPlus, UsersRound } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { AgencyAgent } from "@/lib/platform/agency-agent-repository";

type Agency={id:string;name:string};
type Props={actor:{id:string;name:string};agencies:Agency[];initialAgents:Record<string,AgencyAgent[]>};

async function readJson<T>(response:Response):Promise<T>{const payload=await response.json().catch(()=>({})) as T&{error?:string};if(!response.ok)throw new Error(payload.error||"Operazione non riuscita");return payload;}
function field(form:FormData,name:string){return String(form.get(name)??"").trim();}

export default function AgencyAgentsClient({actor,agencies,initialAgents}:Props){
  const [agencyId,setAgencyId]=useState(agencies[0]?.id??"");
  const [agentsByAgency,setAgentsByAgency]=useState(initialAgents);
  const [showForm,setShowForm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [usernameState,setUsernameState]=useState<"idle"|"checking"|"available"|"taken">("idle");
  const agency=agencies.find((item)=>item.id===agencyId)??agencies[0];
  const agents=useMemo(()=>agentsByAgency[agency?.id]??[],[agentsByAgency,agency?.id]);

  async function checkUsername(username:string){
    const normalized=username.trim();
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(normalized)){setUsernameState("idle");return false;}
    setUsernameState("checking");
    try{const result=await readJson<{available:boolean}>(await fetch("/api/platform/username-availability",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:normalized})}));setUsernameState(result.available?"available":"taken");return result.available;}
    catch{setUsernameState("idle");return false;}
  }

  async function createAgent(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!agency)return;
    const formElement=event.currentTarget,form=new FormData(formElement);setBusy(true);setError("");setNotice("");
    if(!await checkUsername(field(form,"username"))){setError("Username già presente o non verificabile. Scegline un altro.");setBusy(false);return;}
    try{const result=await readJson<{agents:AgencyAgent[];invitationEmailSent:boolean}>(await fetch(`/api/admin/platform/agencies/${agency.id}/agents`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:field(form,"name"),username:field(form,"username"),email:field(form,"email"),phone:field(form,"phone")})}));
      setAgentsByAgency((current)=>({...current,[agency.id]:result.agents}));formElement.reset();setUsernameState("idle");setShowForm(false);
      setNotice(result.invitationEmailSent?"Agente inserito. L’invito personale è stato inviato via email.":"Agente inserito. L’invito è stato creato, ma l’email non è stata inviata.");
    }catch(caught){setError(caught instanceof Error?caught.message:"Inserimento agente non riuscito");}finally{setBusy(false);}
  }

  return <main className="agencyPage agencyAgentsPage">
    <a className="agidSkipLink" href="#main-content">Salta all’elenco degli agenti</a>
    <header className="agencyTopbar"><Link className="agencyBrand" href="/"><span>SMF</span><div><strong>SMF Travel</strong><small>PANNELLO AGENZIA</small></div></Link><div className="agencyUser"><i>{actor.name.slice(0,2).toUpperCase()}</i><span><small>Responsabile</small><b>{actor.name}</b></span><form action="/api/auth/logout" method="post"><button type="submit" aria-label="Esci"><LogOut size={17}/></button></form></div></header>
    <section className="agencyHero"><div><h1>Agenti dell’agenzia</h1><span>Invita le persone che preparano e gestiscono i viaggi.</span></div></section>
    <div className="agencyShell"><aside className="agencySidebar"><label htmlFor="active-agency">Agenzia attiva</label><div className="agencySelect"><Building2 size={18}/><select id="active-agency" value={agency?.id??""} onChange={(event)=>{setAgencyId(event.target.value);setError("");setNotice("");setShowForm(false);}}>{agencies.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15}/></div><nav><Link href="/agenzia"><MapPinned size={18}/> Viaggi</Link><Link className="active" href="/agenzia/agenti" aria-current="page"><UsersRound size={18}/> Agenti</Link><Link href="/accessibilita"><Accessibility size={18}/> Accessibilità</Link></nav></aside>
      <section id="main-content" className="agencyContent" tabIndex={-1}>{error&&<div className="agencyMessage error" role="alert"><CircleAlert size={18}/><span>{error}</span></div>}{notice&&<div className="agencyMessage success" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}
        <section className="agencySection agentManagementSection"><div className="agencySectionHead"><div><h2>Elenco agenti</h2><p>{agents.length} {agents.length===1?"agente censito":"agenti censiti"}</p></div><button type="button" className="newTripButton" aria-expanded={showForm} aria-controls="new-agent-form" onClick={()=>{setShowForm((value)=>!value);setError("");}}><Plus size={17}/> Nuovo agente</button></div>
          {showForm&&<form id="new-agent-form" className="agencyAgentForm" onSubmit={createAgent}><div className="formIntro"><b>Invita un agente</b><span>Riceverà un link personale e sceglierà la propria password.</span></div><div className="agencyAgentFields"><label>Nome e cognome<input name="name" required minLength={2} maxLength={160} autoComplete="name"/></label><label>Username<input name="username" required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}" autoComplete="username" onBlur={(event)=>void checkUsername(event.currentTarget.value)} aria-describedby="agent-username-status"/><small id="agent-username-status" className={`usernameStatus ${usernameState}`} aria-live="polite">{usernameState==="checking"?"Verifica in corso…":usernameState==="available"?"Username disponibile":usernameState==="taken"?"Username già presente":"Deve essere unico nell’app."}</small></label><label>Email<input name="email" type="email" required autoComplete="email"/></label><label>Telefono<input name="phone" type="tel" required minLength={5} maxLength={40} autoComplete="tel"/></label></div><footer><button type="button" className="secondary" disabled={busy} onClick={()=>setShowForm(false)}>Annulla</button><button type="submit" disabled={busy||usernameState==="taken"}>{busy?<><LoaderCircle className="spin"/> Invio…</>:<><UserPlus/> Inserisci e invia invito</>}</button></footer></form>}
          <div className="agencyAgentList">{agents.map((agent)=><article key={agent.id}><i>{agent.name.split(/\s+/).slice(0,2).map((part)=>part[0]).join("").toUpperCase()}</i><div><h3>{agent.name}</h3><p>@{agent.username}</p><span><a href={`mailto:${agent.email}`}><Mail/> {agent.email}</a><b><Phone/> {agent.phone||"Telefono non indicato"}</b></span></div><strong className={agent.status}>{agent.status==="active"?"Attivo":agent.status==="invited"?"Invito inviato":"Sospeso"}</strong></article>)}{!agents.length&&<div className="agencyEmpty"><UsersRound/><h3>Nessun agente</h3><p>Inserisci il primo agente per condividere la gestione dei viaggi.</p><button type="button" onClick={()=>setShowForm(true)}><UserPlus/> Inserisci agente</button></div>}</div>
        </section></section></div>
  </main>;
}
