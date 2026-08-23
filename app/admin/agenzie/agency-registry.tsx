"use client";

import { FormEvent, useState } from "react";
import {
  Building2, ChevronDown, CircleAlert, LoaderCircle, Mail, MapPinned,
  Phone, Plus, Save, UserPlus, UsersRound, X,
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
  const [expandedAgencyId, setExpandedAgencyId] = useState(initialAgencies[0]?.id ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function createAgency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("agency"); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const fields = [
      "name", "legalName", "vatNumber", "taxCode", "registeredAddress", "registeredCity",
      "registeredPostalCode", "registeredProvince", "registeredCountry", "pec", "sdiCode",
      "phone", "email", "website", "referenceName", "referenceEmail", "referencePhone",
    ];
    try {
      const result = await readJson<{ id: string; agencies: AgencyRegistryItem[] }>(
        await fetch("/api/admin/platform/agencies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(fields.map((field) => [field, stringField(form, field)]))),
        })
      );
      setAgencies(result.agencies);
      setExpandedAgencyId(result.id);
      setShowAgencyForm(false);
      setNotice("Agenzia creata correttamente.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creazione non riuscita");
    } finally {
      setBusy("");
    }
  }

  async function createAgent(event: FormEvent<HTMLFormElement>, agencyId: string) {
    event.preventDefault();
    setBusy(`agent-${agencyId}`); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await readJson<{ agency: AgencyRegistryItem }>(
        await fetch(`/api/admin/platform/agencies/${agencyId}/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: stringField(form, "name"),
            email: stringField(form, "email"),
            phone: stringField(form, "phone"),
            role: stringField(form, "role"),
          }),
        })
      );
      setAgencies((current) => current.map((agency) => agency.id === agencyId ? result.agency : agency));
      setAgentAgencyId("");
      setNotice("Agente censito nell’agenzia.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Inserimento agente non riuscito");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="superadminShell">
      <section className="registryHead">
        <div><small>ANAGRAFICHE</small><h1>Agenzie</h1><p>{agencies.length} agenzie presenti nella piattaforma</p></div>
        <button onClick={() => setShowAgencyForm(true)}><Plus size={17}/> Nuova agenzia</button>
      </section>

      {error && <div className="superadminMessage error"><CircleAlert size={18}/>{error}</div>}
      {notice && <div className="superadminMessage success">{notice}</div>}

      {showAgencyForm && (
        <form className="agencyRegistryForm" onSubmit={createAgency}>
          <header><div><Building2/><span><small>NUOVA ANAGRAFICA</small><h2>Inserisci agenzia</h2></span></div><button type="button" onClick={() => setShowAgencyForm(false)} aria-label="Chiudi"><X/></button></header>
          <fieldset>
            <legend>Dati obbligatori</legend>
            <label>Nome agenzia *<input name="name" required minLength={2}/></label>
            <label>Persona di riferimento *<input name="referenceName" required minLength={2}/></label>
            <label>Email referente *<input name="referenceEmail" type="email" required/></label>
            <label>Telefono referente *<input name="referencePhone" type="tel" required minLength={5}/></label>
          </fieldset>
          <fieldset>
            <legend>Dati legali e aziendali facoltativi</legend>
            <label>Ragione sociale<input name="legalName"/></label>
            <label>Partita IVA<input name="vatNumber"/></label>
            <label>Codice fiscale<input name="taxCode"/></label>
            <label>PEC<input name="pec" type="email"/></label>
            <label>Codice SDI<input name="sdiCode"/></label>
            <label>Email agenzia<input name="email" type="email"/></label>
            <label>Telefono agenzia<input name="phone" type="tel"/></label>
            <label>Sito web<input name="website" type="url" placeholder="https://"/></label>
            <label className="wide">Sede legale<input name="registeredAddress"/></label>
            <label>Città<input name="registeredCity"/></label>
            <label>CAP<input name="registeredPostalCode"/></label>
            <label>Provincia<input name="registeredProvince"/></label>
            <label>Paese<input name="registeredCountry" defaultValue="Italia"/></label>
          </fieldset>
          <footer><button type="button" className="secondary" onClick={() => setShowAgencyForm(false)}>Annulla</button><button disabled={busy === "agency"}>{busy === "agency" ? <LoaderCircle className="spin"/> : <Save/>} Salva agenzia</button></footer>
        </form>
      )}

      <section className="agencyRegistryList">
        {agencies.map((agency) => {
          const expanded = expandedAgencyId === agency.id;
          return (
            <article key={agency.id} className={expanded ? "expanded" : ""}>
              <button className="agencyRegistrySummary" onClick={() => setExpandedAgencyId(expanded ? "" : agency.id)}>
                <span className="agencyMark"><Building2/></span>
                <span className="agencyIdentity"><small>{agency.status === "trial" ? "DEMO" : agency.status.toUpperCase()}</small><strong>{agency.name}</strong><em>{agency.referenceName} · {agency.referenceEmail}</em></span>
                <span className="registryCounters"><b><MapPinned/> {agency.tripCount} viaggi</b><b><UsersRound/> {agency.travelerCount} viaggiatori</b><b><UserPlus/> {agency.agents.length} agenti</b></span>
                <ChevronDown className={expanded ? "rotated" : ""}/>
              </button>
              {expanded && (
                <div className="agencyRegistryDetail">
                  <div className="agencyContactGrid">
                    <span><small>REFERENTE</small><b>{agency.referenceName}</b></span>
                    <a href={`mailto:${agency.referenceEmail}`}><Mail/><span><small>EMAIL</small><b>{agency.referenceEmail}</b></span></a>
                    <a href={`tel:${agency.referencePhone}`}><Phone/><span><small>TELEFONO</small><b>{agency.referencePhone}</b></span></a>
                    {agency.vatNumber && <span><small>PARTITA IVA</small><b>{agency.vatNumber}</b></span>}
                  </div>
                  <div className="agentsHeader"><div><small>UTENTI AGENZIA</small><h3>Agenti</h3></div><button onClick={() => setAgentAgencyId(agentAgencyId === agency.id ? "" : agency.id)}><UserPlus/> Aggiungi agente</button></div>
                  {agentAgencyId === agency.id && (
                    <form className="agentForm" onSubmit={(event) => createAgent(event, agency.id)}>
                      <label>Nome e cognome<input name="name" required minLength={2}/></label>
                      <label>Email<input name="email" type="email" required/></label>
                      <label>Telefono<input name="phone" type="tel" required minLength={5}/></label>
                      <label>Ruolo<select name="role" defaultValue="editor"><option value="admin">Amministratore</option><option value="editor">Agente</option><option value="viewer">Solo lettura</option></select></label>
                      <button disabled={busy === `agent-${agency.id}`}>{busy === `agent-${agency.id}` ? <LoaderCircle className="spin"/> : <Plus/>} Registra</button>
                    </form>
                  )}
                  <div className="agentsList">
                    {agency.agents.map((agent) => <div key={agent.id}><i>{agent.initials || agent.name.slice(0, 2).toUpperCase()}</i><span><b>{agent.name}</b><small>{agent.email} · {agent.phone || "telefono non indicato"}</small></span><em>{roleLabels[agent.role]}</em><strong className={agent.status}>{agent.status === "invited" ? "Invitato" : "Attivo"}</strong></div>)}
                    {agency.agents.length === 0 && <p>Nessun agente censito.</p>}
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {agencies.length === 0 && <div className="registryEmpty"><Building2/><h2>Nessuna agenzia</h2><p>Inserisci la prima anagrafica per iniziare.</p></div>}
      </section>
    </div>
  );
}
