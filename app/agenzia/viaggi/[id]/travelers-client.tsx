"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, CircleAlert, Copy, LoaderCircle, Mail, Plus, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";

type JourneyData = Awaited<ReturnType<typeof getJourneyManagement>>;
async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Operazione non riuscita");
  return body;
}

export default function JourneyTravelers({ initialData }: { initialData: JourneyData }) {
  const [data, setData] = useState(initialData);
  const [familyForm, setFamilyForm] = useState(false);
  const [travelerFamily, setTravelerFamily] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activationUrl, setActivationUrl] = useState("");

  function formatDate(value: string) {
    if (!value) return "Data non indicata";
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${value}T12:00:00Z`));
  }

  async function copyActivationLink() {
    try {
      await navigator.clipboard.writeText(activationUrl);
      setNotice("Link di attivazione copiato. Condividilo solo con il viaggiatore interessato.");
      setError("");
    } catch {
      setError("Copia automatica non disponibile. Seleziona il link e copialo manualmente.");
    }
  }

  async function addFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("family"); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await json<{ data: JourneyData }>(await fetch(`/api/admin/platform/trips/${data.journey.id}/families`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: data.journey.agencyId, name: form.get("name") }) }));
      setData(result.data); setFamilyForm(false); setNotice("Famiglia creata correttamente.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Operazione non riuscita"); }
    finally { setBusy(""); }
  }
  async function addTraveler(event: FormEvent<HTMLFormElement>, partyId: string) {
    event.preventDefault(); setBusy(`traveler-${partyId}`); setError(""); setNotice(""); setActivationUrl("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await json<{ data: JourneyData; activationToken: string | null }>(await fetch(`/api/admin/platform/trips/${data.journey.id}/travelers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: data.journey.agencyId, partyId, name: form.get("name"), email: form.get("email"), phone: form.get("phone"), birthDate: form.get("birthDate"), role: form.get("role") }) }));
      setData(result.data); setTravelerFamily("");
      setActivationUrl(result.activationToken ? `${window.location.origin}/attiva-account#token=${encodeURIComponent(result.activationToken)}` : "");
      setNotice(result.activationToken ? "Viaggiatore registrato. Copia ora il link di attivazione." : "Viaggiatore collegato a un account già attivo.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Operazione non riuscita"); }
    finally { setBusy(""); }
  }

  return <main className="journeyManagePage">
    <header><a href="/agenzia"><ArrowLeft/> Tutti i viaggi</a><span>{data.journey.agencyName}</span></header>
    <section className="journeyManageHero"><small>{data.journey.destinationCountry}</small><h1>{data.journey.title}</h1><p><CalendarDays/> {formatDate(data.journey.startsOn)} – {formatDate(data.journey.endsOn)} · {data.journey.code}</p></section>
    <div className="journeyManageShell">
      <div className="journeyManageHead"><div><small>PARTECIPANTI</small><h2>Famiglie e viaggiatori</h2></div><button type="button" aria-expanded={familyForm} aria-controls="family-create-form" onClick={() => { setFamilyForm(!familyForm); setError(""); }}><Plus/> {familyForm ? "Chiudi inserimento" : "Nuova famiglia"}</button></div>
      {error && <div className="agencyMessage error" role="alert"><CircleAlert/>{error}</div>}
      {notice && <div className="agencyMessage success" role="status"><CheckCircle2/>{notice}</div>}
      {activationUrl && <div className="activationLinkBox"><ShieldCheck/><span><b>Link di attivazione monouso</b><small>Scade tra 14 giorni. Condividilo personalmente solo con il viaggiatore interessato.</small></span><label htmlFor="activation-link">Link da consegnare<input id="activation-link" readOnly value={activationUrl} onFocus={(event) => event.currentTarget.select()}/></label><button type="button" onClick={() => void copyActivationLink()}><Copy/> Copia link</button><button type="button" className="activationDismiss" aria-label="Nascondi link di attivazione" onClick={() => setActivationUrl("")}><X/></button></div>}
      {familyForm && <form className="familyCreateForm" id="family-create-form" onSubmit={addFamily}><label htmlFor="family-name">Nome famiglia o gruppo<input id="family-name" name="name" autoComplete="off" required minLength={2} maxLength={160} placeholder="Es. Famiglia Rossi"/></label><button type="submit" disabled={Boolean(busy)}>{busy === "family" ? <><LoaderCircle className="spin"/> Creazione…</> : <><UsersRound/> Crea famiglia</>}</button></form>}
      <section className="familyCards">
        {data.families.map((family) => <article key={family.id}>
          <header><span><UsersRound/><b>{family.name}</b><small>{family.travelers.length} {family.travelers.length === 1 ? "viaggiatore" : "viaggiatori"} · {family.code}</small></span><button type="button" aria-expanded={travelerFamily === family.id} aria-controls={`traveler-form-${family.id}`} onClick={() => { setTravelerFamily(travelerFamily === family.id ? "" : family.id); setError(""); }}><UserPlus/> {travelerFamily === family.id ? "Chiudi inserimento" : "Aggiungi viaggiatore"}</button></header>
          {travelerFamily === family.id && <form className="travelerCreateForm" id={`traveler-form-${family.id}`} onSubmit={(event) => addTraveler(event, family.id)}><label>Nome e cognome<input name="name" autoComplete="name" required minLength={2} maxLength={160}/></label><label>Email per il login<input name="email" type="email" autoComplete="email" required maxLength={320}/></label><label>Telefono<input name="phone" type="tel" autoComplete="tel" maxLength={60}/></label><label>Data di nascita<input name="birthDate" type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)}/></label><label>Ruolo<select name="role" defaultValue="member"><option value="member">Componente</option><option value="organizer">Organizzatore</option></select></label><button type="submit" disabled={Boolean(busy)}>{busy === `traveler-${family.id}` ? <><LoaderCircle className="spin"/> Registrazione…</> : <><Plus/> Registra</>}</button></form>}
          <div className="familyTravelers">{family.travelers.map((traveler) => <div key={traveler.id}><i>{traveler.name.slice(0,2).toUpperCase()}</i><span><b>{traveler.name}</b><small><Mail/> {traveler.email}</small></span><em>{traveler.role === "organizer" ? "Organizzatore" : "Componente"}</em><strong className={traveler.status}>{traveler.status === "invited" ? "Da attivare" : "Attivo"}</strong></div>)}{family.travelers.length === 0 && <p>Nessun viaggiatore configurato.</p>}</div>
        </article>)}
        {data.families.length === 0 && <div className="agencyEmpty"><UsersRound/><h3>Nessuna famiglia</h3><p>Crea la prima famiglia e aggiungi i viaggiatori che accederanno all’app.</p><button type="button" onClick={() => setFamilyForm(true)}><Plus/> Crea la prima famiglia</button></div>}
      </section>
    </div>
  </main>;
}
