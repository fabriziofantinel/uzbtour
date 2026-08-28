"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, CheckCircle2, ChevronDown, CircleAlert, ImageUp, LoaderCircle, Mail, MapPinned,
  Palette, Pencil, Phone, Plus, Power, PowerOff, Save, Search, Trash2, UserPlus, UsersRound, X,
} from "lucide-react";
import type { AgencyRegistryItem } from "@/lib/platform/superadmin-repository";
import { agencyLogoSource } from "@/lib/platform/branding-ui";

const roleLabels = { owner: "Titolare", admin: "Amministratore", editor: "Agente", viewer: "Lettura" };

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Operazione non riuscita");
  return payload;
}

function stringField(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

export default function AgencyRegistry({ initialAgencies }: { initialAgencies: AgencyRegistryItem[] }) {
  const [agencies, setAgencies] = useState(initialAgencies);
  const [showAgencyForm, setShowAgencyForm] = useState(false);
  const [ownerAgencyId, setOwnerAgencyId] = useState("");
  const [editAgencyId, setEditAgencyId] = useState("");
  const [usernameState, setUsernameState] = useState<Record<string,"idle"|"checking"|"available"|"taken">>({});
  const [expandedAgencyId, setExpandedAgencyId] = useState(initialAgencies[0]?.id ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agencyToDelete, setAgencyToDelete] = useState<AgencyRegistryItem | null>(null);
  const [query, setQuery] = useState("");
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLElement>(null);
  const filteredAgencies = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("it");
    if (!needle) return agencies;
    return agencies.filter((agency) => [
      agency.name, agency.referenceName, agency.referenceEmail, agency.referencePhone,
      agency.registeredCity, agency.phone, agency.vatNumber,
      ...agency.agents.flatMap((agent) => [agent.name, agent.username, agent.email, agent.phone]),
    ].filter(Boolean).some((value) => value.toLocaleLowerCase("it").includes(needle)));
  }, [agencies, query]);

  async function checkUsername(key:string,username:string){
    const normalized=username.trim();
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(normalized)){setUsernameState((state)=>({...state,[key]:"idle"}));return false;}
    setUsernameState((state)=>({...state,[key]:"checking"}));
    try{
      const result=await readJson<{available:boolean}>(await fetch("/api/platform/username-availability",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:normalized})
      }));
      setUsernameState((state)=>({...state,[key]:result.available?"available":"taken"}));
      return result.available;
    }catch{setUsernameState((state)=>({...state,[key]:"idle"}));return false;}
  }

  useEffect(() => {
    if (!agencyToDelete) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    deleteCancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setAgencyToDelete(null);
      if (event.key === "Tab") {
        const focusable = Array.from(deleteDialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
        ) ?? []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); previousFocus?.focus(); };
  }, [agencyToDelete, busy]);

  async function createAgency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("agency"); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    if(!await checkUsername("new-agency",stringField(form,"referenceUsername"))){setError("Username già presente o non verificabile. Scegline un altro.");setBusy("");return;}
    const fields = [
      "name", "legalName", "vatNumber", "taxCode", "registeredAddress", "registeredCity",
      "registeredPostalCode", "registeredProvince", "registeredCountry", "pec", "sdiCode",
      "phone", "email", "website", "referenceName", "referenceUsername", "referenceEmail", "referencePhone",
    ];
    try {
      const result = await readJson<{ id: string; agencies: AgencyRegistryItem[]; invitationEmailSent:boolean }>(
        await fetch("/api/admin/platform/agencies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(fields.map((field) => [field, stringField(form, field)]))),
        })
      );
      setAgencies(result.agencies);
      setExpandedAgencyId(result.id);
      setShowAgencyForm(false);
      setNotice(result.invitationEmailSent
        ? "Agenzia e responsabile creati. L’invito personale è stato inviato via email."
        : "Agenzia e responsabile creati. L’invito è disponibile, ma l’email non è stata inviata.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creazione non riuscita");
    } finally {
      setBusy("");
    }
  }

  async function updateStatus(agency:AgencyRegistryItem,status:"active"|"suspended"){
    setBusy(`status-${agency.id}`);setError("");setNotice("");
    try{
      const result=await readJson<{agencies:AgencyRegistryItem[]}>(await fetch(`/api/admin/platform/agencies/${agency.id}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"status",status})
      }));
      setAgencies(result.agencies);
      setNotice(status==="suspended"?`Agenzia “${agency.name}” disattivata. Gli accessi sono bloccati.`:`Agenzia “${agency.name}” attivata.`);
    }catch(caught){setError(caught instanceof Error?caught.message:"Stato non aggiornato");}
    finally{setBusy("");}
  }

  async function replaceOwner(event:FormEvent<HTMLFormElement>,agencyId:string){
    event.preventDefault();setBusy(`owner-${agencyId}`);setError("");setNotice("");
    const form=new FormData(event.currentTarget);
    if(!await checkUsername(`owner-${agencyId}`,stringField(form,"username"))){setError("Username già presente o non verificabile. Scegline un altro.");setBusy("");return;}
    try{
      const result=await readJson<{agencies:AgencyRegistryItem[];invitationEmailSent:boolean}>(await fetch(`/api/admin/platform/agencies/${agencyId}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"replace-owner",
          name:stringField(form,"name"),username:stringField(form,"username"),email:stringField(form,"email"),phone:stringField(form,"phone")})
      }));
      setAgencies(result.agencies);setOwnerAgencyId("");
      setNotice(result.invitationEmailSent?"Nuovo responsabile creato, precedente rimosso e invito inviato.":"Nuovo responsabile creato e precedente rimosso. Invio email non disponibile.");
    }catch(caught){setError(caught instanceof Error?caught.message:"Responsabile non sostituito");}
    finally{setBusy("");}
  }

  async function updateAgencyDetails(event:FormEvent<HTMLFormElement>,agencyId:string){
    event.preventDefault();setBusy(`agency-details-${agencyId}`);setError("");setNotice("");
    const form=new FormData(event.currentTarget);
    try{
      let logoUrl=stringField(form,"currentLogoUrl");
      if(form.get("removeLogo")==="on")logoUrl="";
      const logoFile=form.get("logoFile");
      if(logoFile instanceof File&&logoFile.size>0){
        const authorization=await readJson<{key:string;url:string;headers:Record<string,string>}>(await fetch(`/api/admin/platform/agencies/${agencyId}/logo/upload`,{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contentType:logoFile.type,sizeBytes:logoFile.size})
        }));
        const upload=await fetch(authorization.url,{method:"PUT",headers:authorization.headers,body:logoFile});
        if(!upload.ok)throw new Error("Caricamento del logo su R2 non riuscito");
        logoUrl=`r2://${authorization.key}`;
      }
      const result=await readJson<{agencies:AgencyRegistryItem[]}>(await fetch(`/api/admin/platform/agencies/${agencyId}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"update-details",
          ...Object.fromEntries(["name","legalName","vatNumber","taxCode","registeredAddress","registeredCity","registeredPostalCode","registeredProvince","registeredCountry","pec","sdiCode","phone","email","website","referenceEmail","referencePhone","primaryColor"].map((field)=>[field,stringField(form,field)])),logoUrl})
      }));
      setAgencies(result.agencies);setEditAgencyId("");setNotice("Dati dell’agenzia aggiornati.");
    }catch(caught){setError(caught instanceof Error?caught.message:"Dati dell’agenzia non aggiornati");}
    finally{setBusy("");}
  }

  async function deleteAgency() {
    if (!agencyToDelete) return;
    setBusy(`delete-${agencyToDelete.id}`); setError(""); setNotice("");
    try {
      const result = await readJson<{
        agencies: AgencyRegistryItem[];
        deletedAgency: string;
        deletionJobId: string;
        queued: true;
      }>(await fetch(`/api/admin/platform/agencies/${agencyToDelete.id}`, { method: "DELETE" }));
      setAgencies(result.agencies);
      setExpandedAgencyId("");
      setAgencyToDelete(null);
      setNotice(
        `Cancellazione di “${result.deletedAgency}” avviata. File, viaggiatori e viaggi ` +
        `saranno rimossi in sicurezza dal processo asincrono.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Eliminazione non riuscita");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="superadminShell">
      <section className="registryHead">
        <div><small>ANAGRAFICHE</small><h1>Agenzie</h1><p>{agencies.length} agenzie presenti nella piattaforma</p></div>
        <button type="button" onClick={() => { setShowAgencyForm(true); setError(""); setNotice(""); }}><Plus size={17}/> Nuova agenzia</button>
      </section>

      {error && !agencyToDelete && <div className="superadminMessage error" role="alert"><CircleAlert size={18}/>{error}</div>}
      {notice && <div className="superadminMessage success" role="status"><CheckCircle2 size={18}/>{notice}</div>}

      {showAgencyForm && (
        <form className="agencyRegistryForm" onSubmit={createAgency}>
          <header><div><Building2/><span><small>NUOVA ANAGRAFICA</small><h2>Inserisci agenzia</h2><p>Inizia dai dati indispensabili. Le informazioni facoltative possono essere aggiunte ora o in seguito.</p></span></div><button type="button" onClick={() => setShowAgencyForm(false)} aria-label="Chiudi"><X/></button></header>
          <fieldset className="agencyRequiredFields">
            <legend>Dati obbligatori</legend>
            <label htmlFor="agency-name">Nome agenzia *<input id="agency-name" name="name" autoComplete="organization" required minLength={2} maxLength={160} autoFocus/></label>
            <label htmlFor="agency-reference-name">Persona di riferimento *<input id="agency-reference-name" name="referenceName" autoComplete="name" required minLength={2} maxLength={160}/></label>
            <label htmlFor="agency-reference-username">Username responsabile *<input id="agency-reference-username" name="referenceUsername" autoComplete="username" required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}" onBlur={(event)=>void checkUsername("new-agency",event.currentTarget.value)} aria-describedby="new-agency-username-status"/><small id="new-agency-username-status" className={`usernameStatus ${usernameState["new-agency"]??"idle"}`} aria-live="polite">{usernameState["new-agency"]==="checking"?"Verifica in corso…":usernameState["new-agency"]==="available"?"Username disponibile":usernameState["new-agency"]==="taken"?"Username già presente":"Unico nell’app; sarà indicato nell’email di invito."}</small></label>
            <label htmlFor="agency-reference-email">Email referente *<input id="agency-reference-email" name="referenceEmail" type="email" autoComplete="email" required maxLength={320}/></label>
            <label htmlFor="agency-reference-phone">Telefono referente *<input id="agency-reference-phone" name="referencePhone" type="tel" autoComplete="tel" required minLength={5} maxLength={40}/></label>
          </fieldset>
          <div className="agencyOptionalSections">
            <details className="agencyOptionalSection">
              <summary><Building2/><span><b>Dati legali e aziendali</b><small>Ragione sociale, fiscalità, contatti e sede</small></span><ChevronDown/></summary>
              <fieldset>
                <legend className="srOnly">Dati legali e aziendali facoltativi</legend>
                <label>Ragione sociale<input name="legalName" autoComplete="organization" maxLength={200}/></label>
                <label>Partita IVA<input name="vatNumber" inputMode="numeric" maxLength={32}/></label>
                <label>Codice fiscale<input name="taxCode" maxLength={32}/></label>
                <label>PEC<input name="pec" type="email" autoComplete="email" maxLength={320}/></label>
                <label>Codice SDI<input name="sdiCode" maxLength={16}/></label>
                <label>Email agenzia<input name="email" type="email" autoComplete="email" maxLength={320}/></label>
                <label>Telefono agenzia<input name="phone" type="tel" autoComplete="tel" maxLength={40}/></label>
                <label>Sito web<input name="website" type="url" autoComplete="url" placeholder="https://" maxLength={500}/></label>
                <label className="wide">Sede legale<input name="registeredAddress" autoComplete="street-address" maxLength={300}/></label>
                <label>Città<input name="registeredCity" autoComplete="address-level2" maxLength={120}/></label>
                <label>CAP<input name="registeredPostalCode" autoComplete="postal-code" maxLength={20}/></label>
                <label>Provincia<input name="registeredProvince" autoComplete="address-level1" maxLength={80}/></label>
                <label>Paese<input name="registeredCountry" autoComplete="country-name" defaultValue="Italia" maxLength={80}/></label>
              </fieldset>
            </details>
          </div>
          <footer><button type="button" className="secondary" onClick={() => setShowAgencyForm(false)}>Annulla</button><button type="submit" disabled={busy === "agency"}>{busy === "agency" ? <><LoaderCircle className="spin"/> Salvataggio…</> : <><Save/> Salva agenzia</>}</button></footer>
        </form>
      )}

      {agencies.length > 0 && (
        <div className="registryTools">
          <label className="userSearch" htmlFor="agency-search"><Search/><span className="srOnly">Cerca agenzia</span><input id="agency-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, referente, città o telefono…" autoComplete="off"/></label>
          <span className="registryResultCount" aria-live="polite">{filteredAgencies.length} {filteredAgencies.length === 1 ? "agenzia" : "agenzie"}</span>
          {query && <button type="button" className="registryClear" onClick={() => setQuery("")}><X/> Azzera ricerca</button>}
        </div>
      )}

      <section className="agencyRegistryList">
        {filteredAgencies.map((agency) => {
          const expanded = expandedAgencyId === agency.id;
          return (
            <article key={agency.id} className={expanded ? "expanded" : ""}>
              <button type="button" className="agencyRegistrySummary" aria-expanded={expanded} aria-controls={`agency-detail-${agency.id}`} onClick={() => setExpandedAgencyId(expanded ? "" : agency.id)}>
                <span className="agencyMark"><Building2/></span>
                <span className="agencyIdentity">{agency.status !== "trial" && <small>{agency.status.toUpperCase()}</small>}<strong>{agency.name}</strong><em>{agency.referenceName} · {agency.referenceEmail}</em></span>
                <span className="registryCounters"><b><MapPinned/> {agency.tripCount} viaggi</b><b className={agency.ongoingTripCount?"isOngoing":""}>{agency.ongoingTripCount} in corso</b><b className={agency.upcomingTripCount?"isUpcoming":""}>{agency.upcomingTripCount} futuri</b><b><UsersRound/> {agency.travelerCount} viaggiatori</b><b><UserPlus/> {agency.agents.length} agenti</b></span>
                <ChevronDown className={expanded ? "rotated" : ""}/>
              </button>
              {expanded && (
                <div className="agencyRegistryDetail" id={`agency-detail-${agency.id}`}>
                  <div className="agencyContactGrid">
                    <span><small>REFERENTE</small><b>{agency.referenceName}</b></span>
                    <a href={`mailto:${agency.referenceEmail}`}><Mail/><span><small>EMAIL</small><b>{agency.referenceEmail}</b></span></a>
                    <a href={`tel:${agency.referencePhone}`}><Phone/><span><small>TELEFONO</small><b>{agency.referencePhone}</b></span></a>
                    <button type="button" className="agencyEditButton" aria-expanded={editAgencyId===agency.id} aria-controls={`agency-edit-form-${agency.id}`} onClick={()=>setEditAgencyId(editAgencyId===agency.id?"":agency.id)}><Pencil/> Modifica dati agenzia</button>
                    {agency.vatNumber && <span><small>PARTITA IVA</small><b>{agency.vatNumber}</b></span>}
                  </div>
                  {editAgencyId===agency.id&&<form className="agencyEditForm" id={`agency-edit-form-${agency.id}`} onSubmit={(event)=>updateAgencyDetails(event,agency.id)}>
                    <label>Nome agenzia<input name="name" required minLength={2} maxLength={200} defaultValue={agency.name}/></label>
                    <label>Ragione sociale<input name="legalName" maxLength={240} defaultValue={agency.legalName}/></label>
                    <label>Partita IVA<input name="vatNumber" maxLength={32} defaultValue={agency.vatNumber}/></label>
                    <label>Codice fiscale<input name="taxCode" maxLength={32} defaultValue={agency.taxCode}/></label>
                    <label className="wide">Sede legale<input name="registeredAddress" maxLength={240} defaultValue={agency.registeredAddress}/></label>
                    <label>Città<input name="registeredCity" maxLength={120} defaultValue={agency.registeredCity}/></label>
                    <label>CAP<input name="registeredPostalCode" maxLength={16} defaultValue={agency.registeredPostalCode}/></label>
                    <label>Provincia<input name="registeredProvince" maxLength={80} defaultValue={agency.registeredProvince}/></label>
                    <label>Paese<input name="registeredCountry" maxLength={100} defaultValue={agency.registeredCountry}/></label>
                    <label>PEC<input name="pec" type="email" maxLength={320} defaultValue={agency.pec}/></label>
                    <label>Codice SDI<input name="sdiCode" maxLength={16} defaultValue={agency.sdiCode}/></label>
                    <label>Telefono agenzia<input name="phone" type="tel" maxLength={40} defaultValue={agency.phone}/></label>
                    <label>Email agenzia<input name="email" type="email" maxLength={320} defaultValue={agency.email}/></label>
                    <label className="wide">Sito web<input name="website" type="url" maxLength={500} defaultValue={agency.website}/></label>
                    <label>Email responsabile<input name="referenceEmail" type="email" required maxLength={320} defaultValue={agency.referenceEmail}/></label>
                    <label>Telefono responsabile<input name="referencePhone" type="tel" required minLength={5} maxLength={40} defaultValue={agency.referencePhone}/></label>
                    <div className="agencyEditBranding wide">
                      <div className="agencyBrandPreview" style={{background:agency.primaryColor}}>{agency.logoUrl?<img src={agencyLogoSource(agency.logoUrl,agency.id)} alt={`Logo attuale ${agency.name}`}/>:<Palette/>}</div>
                      <span><b>Identità visiva</b><small>Applicata al pannello agenzia e all’esperienza dei viaggiatori.</small></span>
                      <label>Colore agenzia<input name="primaryColor" type="color" defaultValue={agency.primaryColor||"#247A6B"}/></label>
                      <label className="logoFileField">Logo agenzia<span><ImageUp/> Scegli file locale</span><input name="logoFile" type="file" accept="image/png,image/jpeg,image/webp"/><small>PNG, JPG o WebP · massimo 2 MB</small></label>
                      <input name="currentLogoUrl" type="hidden" value={agency.logoUrl}/>
                      {agency.logoUrl&&<label className="removeLogo"><input name="removeLogo" type="checkbox"/> Rimuovi il logo attuale</label>}
                    </div>
                    <footer><button type="button" className="secondary" onClick={()=>setEditAgencyId("")}>Annulla</button><button type="submit" disabled={busy===`agency-details-${agency.id}`}>{busy===`agency-details-${agency.id}`?<><LoaderCircle className="spin"/> Salvataggio…</>:<><Save/> Salva modifiche</>}</button></footer>
                  </form>}
                  <div className="agentsHeader"><div><small>UTENTI AGENZIA</small><h3>Responsabile e agenti</h3></div><span><button type="button" aria-expanded={ownerAgencyId===agency.id} aria-controls={`owner-form-${agency.id}`} onClick={()=>setOwnerAgencyId(ownerAgencyId===agency.id?"":agency.id)}><UsersRound/> Sostituisci responsabile</button></span></div>
                  {ownerAgencyId===agency.id&&<form className="agentForm" id={`owner-form-${agency.id}`} onSubmit={(event)=>replaceOwner(event,agency.id)}>
                    <p className="wide">Il nuovo responsabile riceverà il link personale di attivazione. Il precedente responsabile sarà rimosso dall’agenzia.</p>
                    <label>Nome e cognome<input name="name" autoComplete="name" required minLength={2} maxLength={160}/></label>
                    <label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}" onBlur={(event)=>void checkUsername(`owner-${agency.id}`,event.currentTarget.value)} aria-describedby={`owner-username-status-${agency.id}`}/><small id={`owner-username-status-${agency.id}`} className={`usernameStatus ${usernameState[`owner-${agency.id}`]??"idle"}`} aria-live="polite">{usernameState[`owner-${agency.id}`]==="checking"?"Verifica in corso…":usernameState[`owner-${agency.id}`]==="available"?"Username disponibile":usernameState[`owner-${agency.id}`]==="taken"?"Username già presente":"Deve essere unico nell’app."}</small></label>
                    <label>Email<input name="email" type="email" autoComplete="email" required maxLength={320}/></label>
                    <label>Telefono<input name="phone" type="tel" autoComplete="tel" required minLength={5} maxLength={40}/></label>
                    <button type="submit" disabled={busy===`owner-${agency.id}`}>{busy===`owner-${agency.id}`?<><LoaderCircle className="spin"/> Sostituzione…</>:<><Save/> Conferma sostituzione</>}</button>
                  </form>}
                  <div className="agentsList">
                    {agency.agents.map((agent) => <div key={agent.id}><i>{agent.initials || agent.name.slice(0, 2).toUpperCase()}</i><span><b>{agent.name}</b><small>@{agent.username} · {agent.email} · {agent.phone || "telefono non indicato"}</small></span><em>{roleLabels[agent.role]}</em><strong className={agent.status}>{agent.status === "invited" ? "Invitato" : "Attivo"}</strong></div>)}
                    {agency.agents.length === 0 && <p>Nessun agente censito.</p>}
                  </div>
                  <div className={`agencyDangerZone agencyStatusZone ${agency.status==="suspended"?"isSuspended":""}`}>
                    <span><small>STATO AGENZIA</small><b>{agency.status==="suspended"?"Agenzia disattivata":"Disattiva temporaneamente l’agenzia"}</b><p>La disattivazione blocca immediatamente agenti e viaggiatori senza cancellare i dati.</p></span>
                    <button type="button" disabled={Boolean(busy)} onClick={()=>void updateStatus(agency,agency.status==="suspended"?"active":"suspended")}>
                      {agency.status==="suspended"?<><Power/> Attiva agenzia</>:<><PowerOff/> Disattiva agenzia</>}
                    </button>
                  </div>
                  <div className="agencyDangerZone">
                    <span><small>ZONA PERICOLO</small><b>Elimina definitivamente l’agenzia</b><p>Verranno rimossi tutti i viaggi, i gruppi, i viaggiatori e i file collegati.</p></span>
                    <button type="button" disabled={Boolean(busy)} onClick={() => { setError(""); setAgencyToDelete(agency); }}><Trash2/> Elimina agenzia</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {agencies.length === 0 && <div className="registryEmpty"><Building2/><h2>Nessuna agenzia</h2><p>Inserisci la prima anagrafica per iniziare a configurare la piattaforma.</p><button type="button" onClick={() => setShowAgencyForm(true)}><Plus/> Crea la prima agenzia</button></div>}
        {agencies.length > 0 && filteredAgencies.length === 0 && <div className="registryEmpty" role="status"><Search/><h2>Nessuna agenzia trovata</h2><p>Nessun nome, referente, città o telefono corrisponde a “{query}”.</p><button type="button" onClick={() => setQuery("")}><X/> Azzera ricerca</button></div>}
      </section>
      {agencyToDelete && (
        <div className="agencyDeleteBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setAgencyToDelete(null);
        }}>
          <section ref={deleteDialogRef} className="agencyDeleteDialog" role="dialog" aria-modal="true" aria-labelledby="delete-agency-title">
            <button type="button" className="agencyDeleteClose" aria-label="Chiudi" disabled={Boolean(busy)} onClick={() => setAgencyToDelete(null)}><X/></button>
            <i><Trash2/></i>
            <small>OPERAZIONE DEFINITIVA</small>
            <h2 id="delete-agency-title">Eliminare “{agencyToDelete.name}”?</h2>
            <p>{agencyToDelete.ongoingTripCount+agencyToDelete.upcomingTripCount>0&&<strong>Attenzione: sono presenti {agencyToDelete.ongoingTripCount} viaggi in corso e {agencyToDelete.upcomingTripCount} futuri. </strong>}La cancellazione comprende {agencyToDelete.tripCount} viaggi, {agencyToDelete.travelerCount} viaggiatori, gruppi, importazioni, documenti e foto. Non sarà possibile recuperare i dati.</p>
            {error && <div className="superadminMessage error dialogMessage" role="alert"><CircleAlert size={18}/>{error}</div>}
            <div>
              <button ref={deleteCancelRef} type="button" className="secondary" disabled={Boolean(busy)} onClick={() => setAgencyToDelete(null)}>Annulla</button>
              <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void deleteAgency()}>{busy === `delete-${agencyToDelete.id}` ? <><LoaderCircle className="spin"/> Eliminazione…</> : <><Trash2/> Elimina definitivamente</>}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
