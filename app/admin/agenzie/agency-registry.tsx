"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, CheckCircle2, ChevronDown, CircleAlert, LoaderCircle, Mail, MapPinned,
  Palette, Phone, Plus, Power, PowerOff, Save, Search, Trash2, UserPlus, UsersRound, X,
} from "lucide-react";
import type { AgencyRegistryItem } from "@/lib/platform/superadmin-repository";

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
  const [agentAgencyId, setAgentAgencyId] = useState("");
  const [ownerAgencyId, setOwnerAgencyId] = useState("");
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
    const fields = [
      "name", "legalName", "vatNumber", "taxCode", "registeredAddress", "registeredCity",
      "registeredPostalCode", "registeredProvince", "registeredCountry", "pec", "sdiCode",
      "phone", "email", "website", "referenceName", "referenceUsername", "referenceEmail", "referencePhone",
      "primaryColor", "logoUrl",
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

  async function updateBranding(event: FormEvent<HTMLFormElement>, agencyId: string) {
    event.preventDefault();
    setBusy(`branding-${agencyId}`); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await readJson<{ agencies: AgencyRegistryItem[] }>(
        await fetch(`/api/admin/platform/agencies/${agencyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            primaryColor: stringField(form, "primaryColor"),
            logoUrl: stringField(form, "logoUrl"),
          }),
        })
      );
      setAgencies(result.agencies);
      setNotice("Logo e colore dell’agenzia aggiornati.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Branding non aggiornato");
    } finally {
      setBusy("");
    }
  }

  async function createAgent(event: FormEvent<HTMLFormElement>, agencyId: string) {
    event.preventDefault();
    setBusy(`agent-${agencyId}`); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await readJson<{ agency: AgencyRegistryItem; invitationEmailSent: boolean; activationToken: string | null }>(
        await fetch(`/api/admin/platform/agencies/${agencyId}/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: stringField(form, "name"),
            username: stringField(form, "username"),
            email: stringField(form, "email"),
            phone: stringField(form, "phone"),
            role: stringField(form, "role"),
          }),
        })
      );
      setAgencies((current) => current.map((agency) => agency.id === agencyId ? result.agency : agency));
      setAgentAgencyId("");
      setNotice(result.invitationEmailSent ? "Agente censito. L’invito personale è stato inviato via email." : "Agente censito. Invio email non disponibile: rigenera l’invito dopo la configurazione SES.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Inserimento agente non riuscito");
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
    try{
      const result=await readJson<{agencies:AgencyRegistryItem[];invitationEmailSent:boolean}>(await fetch(`/api/admin/platform/agencies/${agencyId}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"replace-owner",
          name:stringField(form,"name"),username:stringField(form,"username"),email:stringField(form,"email"),phone:stringField(form,"phone")})
      }));
      setAgencies(result.agencies);setOwnerAgencyId("");
      setNotice(result.invitationEmailSent?"Responsabile sostituito e invito inviato.":"Responsabile sostituito. Invio email non disponibile.");
    }catch(caught){setError(caught instanceof Error?caught.message:"Responsabile non sostituito");}
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
      setAgentAgencyId("");
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
            <label htmlFor="agency-reference-username">Username responsabile *<input id="agency-reference-username" name="referenceUsername" autoComplete="username" required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}"/><small>Unico nell’app; sarà indicato nell’email di invito.</small></label>
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
            <details className="agencyOptionalSection">
              <summary><Palette/><span><b>Identità visiva</b><small>Colore e logo mostrati ai viaggiatori</small></span><ChevronDown/></summary>
              <fieldset>
                <legend className="srOnly">Identità visiva facoltativa</legend>
                <label>Colore principale<input name="primaryColor" type="color" defaultValue="#247A6B"/></label>
                <label className="wide">URL del logo<input name="logoUrl" type="url" autoComplete="url" placeholder="https://agenzia.it/logo.png" maxLength={1000}/></label>
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
                    {agency.vatNumber && <span><small>PARTITA IVA</small><b>{agency.vatNumber}</b></span>}
                  </div>
                  <div className="agencyLifecycleActions">
                    <span><small>STATO AGENZIA</small><b>{agency.status==="suspended"?"Disattivata":"Abilitata"}</b><p>La disattivazione blocca immediatamente agenti e viaggiatori.</p></span>
                    <button type="button" disabled={Boolean(busy)} onClick={()=>void updateStatus(agency,agency.status==="suspended"?"active":"suspended")}>
                      {agency.status==="suspended"?<><Power/> Attiva agenzia</>:<><PowerOff/> Disattiva agenzia</>}
                    </button>
                  </div>
                  <form className="agencyBrandingForm" onSubmit={(event) => updateBranding(event, agency.id)}>
                    <div className="agencyBrandPreview" style={{ background: agency.primaryColor }}>{agency.logoUrl ? <img src={agency.logoUrl} alt=""/> : <Palette/>}</div>
                    <span><small>IDENTITÀ VISIVA</small><strong>Logo e colore nell’app viaggiatore</strong></span>
                    <label>Colore<input name="primaryColor" type="color" defaultValue={agency.primaryColor}/></label>
                    <label>URL logo<input name="logoUrl" type="url" defaultValue={agency.logoUrl} placeholder="https://"/></label>
                    <button type="submit" disabled={busy === `branding-${agency.id}`}>{busy === `branding-${agency.id}` ? <><LoaderCircle className="spin"/> Salvataggio…</> : <><Save/> Salva</>}</button>
                  </form>
                  <div className="agentsHeader"><div><small>UTENTI AGENZIA</small><h3>Responsabile e agenti</h3></div><span><button type="button" aria-expanded={ownerAgencyId===agency.id} aria-controls={`owner-form-${agency.id}`} onClick={()=>setOwnerAgencyId(ownerAgencyId===agency.id?"":agency.id)}><UsersRound/> Sostituisci responsabile</button><button type="button" aria-expanded={agentAgencyId === agency.id} aria-controls={`agent-form-${agency.id}`} onClick={() => setAgentAgencyId(agentAgencyId === agency.id ? "" : agency.id)}><UserPlus/> {agentAgencyId === agency.id ? "Chiudi inserimento" : "Aggiungi agente"}</button></span></div>
                  {ownerAgencyId===agency.id&&<form className="agentForm" id={`owner-form-${agency.id}`} onSubmit={(event)=>replaceOwner(event,agency.id)}>
                    <p className="wide">Il referente attuale perderà il ruolo di responsabile. La sostituzione è atomica: non possono esistere due responsabili attivi.</p>
                    <label>Nome e cognome<input name="name" autoComplete="name" required minLength={2} maxLength={160}/></label>
                    <label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}"/></label>
                    <label>Email<input name="email" type="email" autoComplete="email" required maxLength={320}/></label>
                    <label>Telefono<input name="phone" type="tel" autoComplete="tel" required minLength={5} maxLength={40}/></label>
                    <button type="submit" disabled={busy===`owner-${agency.id}`}>{busy===`owner-${agency.id}`?<><LoaderCircle className="spin"/> Sostituzione…</>:<><Save/> Conferma sostituzione</>}</button>
                  </form>}
                  {agentAgencyId === agency.id && (
                    <form className="agentForm" id={`agent-form-${agency.id}`} onSubmit={(event) => createAgent(event, agency.id)}>
                      <label>Nome e cognome<input name="name" autoComplete="name" required minLength={2} maxLength={160}/></label>
                      <label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}"/></label>
                      <label>Email<input name="email" type="email" autoComplete="email" required maxLength={320}/></label>
                      <label>Telefono<input name="phone" type="tel" autoComplete="tel" required minLength={5} maxLength={40}/></label>
                      <label>Ruolo<select name="role" defaultValue="editor"><option value="admin">Amministratore</option><option value="editor">Agente</option><option value="viewer">Solo lettura</option></select></label>
                      <button type="submit" disabled={busy === `agent-${agency.id}`}>{busy === `agent-${agency.id}` ? <><LoaderCircle className="spin"/> Registrazione…</> : <><Plus/> Registra</>}</button>
                    </form>
                  )}
                  <div className="agentsList">
                    {agency.agents.map((agent) => <div key={agent.id}><i>{agent.initials || agent.name.slice(0, 2).toUpperCase()}</i><span><b>{agent.name}</b><small>@{agent.username} · {agent.email} · {agent.phone || "telefono non indicato"}</small></span><em>{roleLabels[agent.role]}</em><strong className={agent.status}>{agent.status === "invited" ? "Invitato" : "Attivo"}</strong></div>)}
                    {agency.agents.length === 0 && <p>Nessun agente censito.</p>}
                  </div>
                  <div className="agencyDangerZone">
                    <span><small>ZONA PERICOLO</small><b>Elimina definitivamente l’agenzia</b><p>Verranno rimossi tutti i viaggi, le famiglie, i viaggiatori e i file collegati.</p></span>
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
            <p>{agencyToDelete.ongoingTripCount+agencyToDelete.upcomingTripCount>0&&<strong>Attenzione: sono presenti {agencyToDelete.ongoingTripCount} viaggi in corso e {agencyToDelete.upcomingTripCount} futuri. </strong>}La cancellazione comprende {agencyToDelete.tripCount} viaggi, {agencyToDelete.travelerCount} viaggiatori, famiglie, importazioni, documenti e foto. Non sarà possibile recuperare i dati.</p>
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
