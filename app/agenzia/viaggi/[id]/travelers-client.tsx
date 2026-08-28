"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, BookOpen, CalendarDays, Check, CheckCircle2, CircleAlert, Copy, Crown, FolderOpen, LoaderCircle, Mail, Plus, ShieldCheck, Trophy, UserPlus, UsersRound, X } from "lucide-react";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";

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
  const [activationCopied, setActivationCopied] = useState(false);
  const [usernameState,setUsernameState]=useState<Record<string,"idle"|"checking"|"available"|"taken">>({});
  const travelerCount = data.families.reduce((sum, family) => sum + family.travelers.length, 0);
  const activeTravelerCount = data.families.reduce((sum, family) => sum + family.travelers.filter((traveler) => traveler.status !== "invited").length, 0);
  const invitedTravelerCount = travelerCount - activeTravelerCount;
  const agencyColor = validBrandColor(data.journey.agencyPrimaryColor);
  const agencyStyle = {
    "--agency-ui": agencyColor,
    "--agency-ui-ink": "#111111",
    "--smf-brand": agencyColor,
    "--smf-brand-deep": agencyColor,
    "--smf-action": agencyColor,
    "--smf-focus": accessibleBrandColor(agencyColor),
  } as CSSProperties;

  function formatDate(value: string) {
    if (!value) return "Data non indicata";
    const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(date.valueOf())) return "Data non indicata";
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      .format(date);
  }

  async function copyActivationLink() {
    try {
      await navigator.clipboard.writeText(activationUrl);
      setActivationCopied(true);
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
      setData(result.data); setFamilyForm(false); setNotice("Gruppo creato correttamente.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Operazione non riuscita"); }
    finally { setBusy(""); }
  }
  async function addTraveler(event: FormEvent<HTMLFormElement>, partyId: string) {
    event.preventDefault(); setBusy(`traveler-${partyId}`); setError(""); setNotice(""); setActivationUrl(""); setActivationCopied(false);
    const form = new FormData(event.currentTarget);
    if(!await checkUsername(partyId,String(form.get("username")??""))){setError("Username già presente o non verificabile. Scegline un altro.");setBusy("");return;}
    try {
      const result = await json<{ data: JourneyData; activationToken: string | null; invitationEmailSent: boolean }>(await fetch(`/api/admin/platform/trips/${data.journey.id}/travelers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: data.journey.agencyId, partyId, name: form.get("name"), username: form.get("username"), email: form.get("email"), phone: form.get("phone"), birthDate: form.get("birthDate") }) }));
      setData(result.data); setTravelerFamily("");
      setActivationUrl(result.activationToken ? `${window.location.origin}/attiva-account#token=${encodeURIComponent(result.activationToken)}` : "");
      setNotice(result.activationToken ? (result.invitationEmailSent ? "Viaggiatore registrato. L’invito personale è stato inviato via email." : "Viaggiatore registrato. L’invio email non è configurato: copia il link di attivazione.") : "Viaggiatore collegato a un account già attivo.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Operazione non riuscita"); }
    finally { setBusy(""); }
  }

  async function updateCompetition(partyId: string, enabled: boolean) {
    setBusy(`competition-${partyId}`); setError(""); setNotice("");
    try {
      const result = await json<{ data: JourneyData }>(await fetch(`/api/admin/platform/trips/${data.journey.id}/families/${partyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "competition", agencyId: data.journey.agencyId, enabled }),
      }));
      setData(result.data);
      setNotice(enabled ? "Il gruppo parteciperà anche alla classifica del viaggio." : "Il gruppo resterà nelle classifiche interne e non concorrerà con gli altri gruppi.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Aggiornamento non riuscito"); }
    finally { setBusy(""); }
  }

  async function setLeader(partyId: string, travelerId: string) {
    setBusy(`leader-${partyId}`); setError(""); setNotice("");
    try {
      const result = await json<{ data: JourneyData }>(await fetch(`/api/admin/platform/trips/${data.journey.id}/families/${partyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leader", agencyId: data.journey.agencyId, travelerId }),
      }));
      setData(result.data); setNotice("Capogruppo aggiornato correttamente.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Aggiornamento non riuscito"); }
    finally { setBusy(""); }
  }

  async function checkUsername(key:string,username:string){
    const normalized=username.trim();
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(normalized)){setUsernameState((state)=>({...state,[key]:"idle"}));return false;}
    setUsernameState((state)=>({...state,[key]:"checking"}));
    try{
      const result=await json<{available:boolean}>(await fetch("/api/platform/username-availability",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:normalized})}));
      setUsernameState((state)=>({...state,[key]:result.available?"available":"taken"}));return result.available;
    }catch{setUsernameState((state)=>({...state,[key]:"idle"}));return false;}
  }

  return <main className="journeyManagePage" style={agencyStyle}>
    <header><Link href="/agenzia"><ArrowLeft/> Tutti i viaggi</Link><nav aria-label="Gestione del viaggio"><Link href={`/agenzia/viaggi/${data.journey.id}/programma`}><BookOpen/> Programma</Link><span aria-current="page"><UsersRound/> Gruppi</span><Link href={`/agenzia/viaggi/${data.journey.id}/documenti`}><FolderOpen/> Documenti</Link></nav><span className="journeyAgencyName">{data.journey.agencyName}</span></header>
    <section className="journeyManageHero"><small>{data.journey.destinationCountry}</small><h1>{data.journey.title}</h1><p><CalendarDays/> {formatDate(data.journey.startsOn)} – {formatDate(data.journey.endsOn)} · {data.journey.code}</p></section>
    <div className="journeyManageShell">
      <section className="journeyPeopleSummary" aria-label="Riepilogo partecipanti"><article><UsersRound/><span><small>GRUPPI</small><strong>{data.families.length}</strong></span></article><article><UserPlus/><span><small>VIAGGIATORI</small><strong>{travelerCount}</strong></span></article><article><CheckCircle2/><span><small>ACCOUNT ATTIVI</small><strong>{activeTravelerCount}</strong></span></article>{invitedTravelerCount > 0 && <article className="pending"><Mail/><span><small>DA ATTIVARE</small><strong>{invitedTravelerCount}</strong></span></article>}</section>
      <div className="journeyManageHead"><div><small>PARTECIPANTI</small><h2>Gruppi e viaggiatori</h2></div><button type="button" aria-expanded={familyForm} aria-controls="family-create-form" onClick={() => { setFamilyForm(!familyForm); setError(""); }}><Plus/> {familyForm ? "Chiudi inserimento" : "Nuovo gruppo"}</button></div>
      {error && <div className="agencyMessage error" role="alert"><CircleAlert/>{error}</div>}
      {notice && <div className="agencyMessage success" role="status"><CheckCircle2/>{notice}</div>}
      {activationUrl && <div className="activationLinkBox"><ShieldCheck/><span><b>Link di attivazione monouso</b><small>Scade tra 14 giorni. Condividilo personalmente solo con il viaggiatore interessato.</small></span><label htmlFor="activation-link">Link da consegnare<input id="activation-link" readOnly value={activationUrl} onFocus={(event) => event.currentTarget.select()}/></label><button type="button" className={activationCopied ? "copied" : ""} onClick={() => void copyActivationLink()}>{activationCopied ? <Check/> : <Copy/>} {activationCopied ? "Copiato" : "Copia link"}</button><button type="button" className="activationDismiss" aria-label="Nascondi link di attivazione" onClick={() => { setActivationUrl(""); setActivationCopied(false); }}><X/></button></div>}
      {familyForm && <form className="familyCreateForm" id="family-create-form" onSubmit={addFamily} aria-busy={busy === "family"}><div><small>NUOVO GRUPPO DI CONDIVISIONE</small><strong>Crea un gruppo</strong><p>Spese, ricordi e classifiche resteranno separati dagli altri gruppi della partenza.</p></div><label htmlFor="family-name">Nome gruppo<input id="family-name" name="name" autoFocus autoComplete="off" required minLength={2} maxLength={160} placeholder="Es. Gruppo Rossi"/></label><footer><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => setFamilyForm(false)}>Annulla</button><button type="submit" disabled={Boolean(busy)}>{busy === "family" ? <><LoaderCircle className="spin"/> Creazione…</> : <><UsersRound/> Crea gruppo</>}</button></footer></form>}
      <section className="familyCards">
        {data.families.map((family) => { const leader = family.travelers.find((traveler) => traveler.role === "organizer"); return <article key={family.id}>
          <header><span><UsersRound/><b>{family.name}</b><small>{family.travelers.length} {family.travelers.length === 1 ? "viaggiatore" : "viaggiatori"} · {family.code}</small></span><div className="groupHeaderActions"><span className={leader ? "groupLeaderSummary" : "groupLeaderSummary missing"}><Crown/><small>Capogruppo</small><b>{leader?.name ?? "Da indicare"}</b></span><button type="button" aria-expanded={travelerFamily === family.id} aria-controls={`traveler-form-${family.id}`} onClick={() => { setTravelerFamily(travelerFamily === family.id ? "" : family.id); setError(""); }}><UserPlus/> {travelerFamily === family.id ? "Chiudi inserimento" : "Aggiungi viaggiatore"}</button></div></header>
          <div className="groupCompetitionSetting"><span><Trophy/><span><b>Partecipa ai giochi a livello di viaggio</b><small>Quiz, giochi e le stesse foto dei contest concorreranno anche con gli altri gruppi.</small></span></span><label className="groupCompetitionSwitch"><input type="checkbox" checked={family.participatesInTripGames} disabled={Boolean(busy)} onChange={(event) => void updateCompetition(family.id, event.currentTarget.checked)}/><span aria-hidden="true"/><em>{family.participatesInTripGames ? "Attiva" : "Non attiva"}</em></label></div>
          {travelerFamily === family.id && <form className="travelerCreateForm" id={`traveler-form-${family.id}`} onSubmit={(event) => addTraveler(event, family.id)} aria-busy={busy === `traveler-${family.id}`}>
            <div className="travelerFormIntro"><small>NUOVO ACCESSO</small><strong>Aggiungi un viaggiatore a {family.name}</strong><p>Ogni viaggiatore ha un proprio username. La stessa email può ricevere più inviti indipendenti.</p></div>
            <label htmlFor={`traveler-name-${family.id}`}>Nome e cognome *<input id={`traveler-name-${family.id}`} name="name" autoFocus autoComplete="name" required minLength={2} maxLength={160} placeholder="Nome e cognome"/></label>
            <label htmlFor={`traveler-username-${family.id}`}>Username *<input id={`traveler-username-${family.id}`} name="username" autoComplete="username" required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}" placeholder="es. mattia.rossi" onBlur={(event)=>void checkUsername(family.id,event.currentTarget.value)} aria-describedby={`traveler-username-status-${family.id}`}/><span id={`traveler-username-status-${family.id}`} className={`usernameStatus ${usernameState[family.id]??"idle"}`} aria-live="polite">{usernameState[family.id]==="checking"?"Verifica in corso…":usernameState[family.id]==="available"?"Username disponibile":usernameState[family.id]==="taken"?"Username già presente":"Lettere, numeri, punto, trattino e underscore."}</span></label>
            <label htmlFor={`traveler-email-${family.id}`}>Email per inviti e recupero password *<input id={`traveler-email-${family.id}`} name="email" type="email" inputMode="email" autoComplete="email" required maxLength={320} placeholder="nome@esempio.it"/></label>
            <label htmlFor={`traveler-phone-${family.id}`}>Telefono <span>(facoltativo)</span><input id={`traveler-phone-${family.id}`} name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={60} placeholder="+39 …"/></label>
            <label htmlFor={`traveler-birth-${family.id}`}>Data di nascita <span>(facoltativa)</span><input id={`traveler-birth-${family.id}`} name="birthDate" type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)}/></label>
            {family.travelers.length === 0 && <div className="firstLeaderNotice"><Crown/><span><b>Il primo viaggiatore sarà il capogruppo.</b><small>Deve essere maggiorenne; potrai sostituirlo in seguito.</small></span></div>}
            <footer><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => setTravelerFamily("")}>Annulla</button><button type="submit" disabled={Boolean(busy)}>{busy === `traveler-${family.id}` ? <><LoaderCircle className="spin"/> Registrazione…</> : <><Plus/> Registra viaggiatore</>}</button></footer>
          </form>}
          <div className="familyTravelers">{family.travelers.map((traveler) => <div key={traveler.id} className={traveler.role === "organizer" ? "isLeader" : ""}><i>{traveler.name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase()}</i><span><b>{traveler.name}</b><small>@{traveler.username} · <Mail/> {traveler.email}</small></span>{traveler.role === "organizer" ? <em className="leaderBadge"><Crown/> Capogruppo</em> : <button type="button" className="setLeaderButton" disabled={Boolean(busy)} onClick={() => void setLeader(family.id, traveler.id)}><Crown/> Imposta capogruppo</button>}<strong className={traveler.status}>{traveler.status === "invited" ? "Da attivare" : traveler.status === "active" ? "Attivo" : traveler.status}</strong></div>)}{family.travelers.length === 0 && <div className="familyTravelersEmpty"><UserPlus/><span><strong>Nessun viaggiatore</strong><small>Aggiungi per primo un adulto: diventerà il capogruppo.</small></span></div>}</div>
        </article>; })}
        {data.families.length === 0 && <div className="agencyEmpty"><UsersRound/><h3>Nessun gruppo</h3><p>Usa “Nuovo gruppo” per creare il gruppo e aggiungere i viaggiatori che accederanno all’app.</p></div>}
      </section>
    </div>
  </main>;
}
