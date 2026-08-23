"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft, CalendarDays, CircleAlert, LoaderCircle, Mail, Plus, UserPlus, UsersRound } from "lucide-react";
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
  const [activationUrl, setActivationUrl] = useState("");

  async function addFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("family"); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await json<{ data: JourneyData }>(await fetch(`/api/admin/platform/trips/${data.journey.id}/families`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: data.journey.agencyId, name: form.get("name") }) }));
      setData(result.data); setFamilyForm(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Operazione non riuscita"); }
    finally { setBusy(""); }
  }
  async function addTraveler(event: FormEvent<HTMLFormElement>, partyId: string) {
    event.preventDefault(); setBusy(`traveler-${partyId}`); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await json<{ data: JourneyData; activationToken: string | null }>(await fetch(`/api/admin/platform/trips/${data.journey.id}/travelers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyId: data.journey.agencyId, partyId, name: form.get("name"), email: form.get("email"), phone: form.get("phone"), birthDate: form.get("birthDate"), role: form.get("role") }) }));
      setData(result.data); setTravelerFamily("");
      setActivationUrl(result.activationToken ? `${window.location.origin}/attiva-account#token=${encodeURIComponent(result.activationToken)}` : "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Operazione non riuscita"); }
    finally { setBusy(""); }
  }

  return <main className="journeyManagePage">
    <header><a href="/agenzia"><ArrowLeft/> Tutti i viaggi</a><span>{data.journey.agencyName}</span></header>
    <section className="journeyManageHero"><small>{data.journey.destinationCountry}</small><h1>{data.journey.title}</h1><p><CalendarDays/> {data.journey.startsOn} → {data.journey.endsOn} · {data.journey.code}</p></section>
    <div className="journeyManageShell">
      <div className="journeyManageHead"><div><small>PARTECIPANTI</small><h2>Famiglie e viaggiatori</h2></div><button onClick={() => setFamilyForm(!familyForm)}><Plus/> Nuova famiglia</button></div>
      {error && <div className="agencyMessage error"><CircleAlert/>{error}</div>}
      {activationUrl && <div className="activationLinkBox"><b>Link di attivazione monouso</b><span>Copialo e invialo personalmente al viaggiatore; scade tra 14 giorni.</span><input readOnly value={activationUrl} onFocus={(event) => event.currentTarget.select()}/></div>}
      {familyForm && <form className="familyCreateForm" onSubmit={addFamily}><label>Nome famiglia o gruppo<input name="name" required minLength={2} placeholder="Es. Famiglia Rossi"/></label><button disabled={Boolean(busy)}>{busy === "family" ? <LoaderCircle className="spin"/> : <UsersRound/>} Crea famiglia</button></form>}
      <section className="familyCards">
        {data.families.map((family) => <article key={family.id}>
          <header><span><UsersRound/><b>{family.name}</b><small>{family.travelers.length} viaggiatori · {family.code}</small></span><button onClick={() => setTravelerFamily(travelerFamily === family.id ? "" : family.id)}><UserPlus/> Aggiungi viaggiatore</button></header>
          {travelerFamily === family.id && <form className="travelerCreateForm" onSubmit={(event) => addTraveler(event, family.id)}><label>Nome e cognome<input name="name" required/></label><label>Email per il login<input name="email" type="email" required/></label><label>Telefono<input name="phone" type="tel"/></label><label>Data di nascita<input name="birthDate" type="date"/></label><label>Ruolo<select name="role"><option value="member">Componente</option><option value="organizer">Organizzatore</option></select></label><button disabled={Boolean(busy)}>{busy === `traveler-${family.id}` ? <LoaderCircle className="spin"/> : <Plus/>} Registra</button></form>}
          <div className="familyTravelers">{family.travelers.map((traveler) => <div key={traveler.id}><i>{traveler.name.slice(0,2).toUpperCase()}</i><span><b>{traveler.name}</b><small><Mail/> {traveler.email}</small></span><em>{traveler.role === "organizer" ? "Organizzatore" : "Componente"}</em><strong className={traveler.status}>{traveler.status === "invited" ? "Da attivare" : "Attivo"}</strong></div>)}{family.travelers.length === 0 && <p>Nessun viaggiatore configurato.</p>}</div>
        </article>)}
        {data.families.length === 0 && <div className="agencyEmpty"><UsersRound/><h3>Nessuna famiglia</h3><p>Crea la prima famiglia e aggiungi i viaggiatori che accederanno all’app.</p></div>}
      </section>
    </div>
  </main>;
}
