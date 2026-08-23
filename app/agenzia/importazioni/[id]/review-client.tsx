"use client";

import {
  ArrowLeft, BedDouble, CalendarDays, Check, ChevronDown, CircleAlert, FileText,
  ExternalLink, GripVertical, Hotel, LoaderCircle, MapPin, Plus, Save, Send,
  ShieldCheck, Sparkles, Trash2,
} from "lucide-react";
import { useState } from "react";
import type { TravelProgrammeDraft } from "@/lib/platform/import-schema";
import type { PlatformImportReview } from "@/lib/platform/types";

const activityTypes = [
  ["visit", "Visita"], ["transport", "Trasferimento"], ["flight", "Volo"],
  ["train", "Treno"], ["hotel", "Hotel"], ["meal", "Pasto"],
  ["free_time", "Tempo libero"], ["meeting", "Incontro"], ["other", "Altro"],
] as const;

async function jsonResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
  return result;
}

function emptyActivity(): TravelProgrammeDraft["days"][number]["activities"][number] {
  return {
    type: "visit", title: "", description: "", startsAt: "", endsAt: "",
    placeName: "", placeCity: "", placeCountry: "",
    placeValidation: { needsValidation: true, reason: "Nuovo sito da verificare" },
  };
}

type EntityValidation = TravelProgrammeDraft["days"][number]["countryValidation"];

function changedValidation(entity: string): EntityValidation {
  return { needsValidation: true, reason: `${entity} modificato: controlla nome e località` };
}

function googleSearchUrl(parts: string[]) {
  return `https://www.google.com/search?q=${encodeURIComponent(parts.filter(Boolean).join(", "))}`;
}

function ValidationControl({
  validation, searchParts, onChange,
}: {
  validation: EntityValidation;
  searchParts: string[];
  onChange: (validation: EntityValidation) => void;
}) {
  return (
    <div className={validation.needsValidation ? "entityValidation pending" : "entityValidation valid"}>
      {validation.needsValidation ? <CircleAlert/> : <ShieldCheck/>}
      <span><b>{validation.needsValidation ? "DA VALIDARE" : "VALIDATO"}</b><small>{validation.reason}</small></span>
      <a href={googleSearchUrl(searchParts)} target="_blank" rel="noreferrer" title="Controlla su Google"><ExternalLink/></a>
      <button type="button" onClick={() => onChange(validation.needsValidation
        ? { needsValidation: false, reason: "Verificato e confermato dall’agente" }
        : { needsValidation: true, reason: "Segnalato dall’agente per un nuovo controllo" }
      )}>{validation.needsValidation ? "Conferma" : "Riapri"}</button>
    </div>
  );
}

function pendingValidationCount(draft: TravelProgrammeDraft) {
  return draft.days.reduce((total, day) => total
    + Number(!day.country.trim() || day.countryValidation.needsValidation)
    + Number(!day.city.trim() || day.cityValidation.needsValidation)
    + day.activities.filter((activity) => activity.type === "visit").reduce((subtotal, activity) => subtotal + Number(
      !activity.placeName.trim() || !activity.placeCity.trim() || !activity.placeCountry.trim() || activity.placeValidation.needsValidation
    ), 0)
    + Number(Boolean(day.accommodation.name.trim()) && (
      !day.accommodation.city.trim() || !day.accommodation.country.trim() || day.accommodation.validation.needsValidation
    )), 0);
}

export default function ImportReview({ initialImport }: { initialImport: PlatformImportReview }) {
  const [draft, setDraft] = useState(initialImport.draft);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(initialImport.errorMessage ?? "");
  const [notice, setNotice] = useState("");

  function updateDay(index: number, changes: Partial<TravelProgrammeDraft["days"][number]>) {
    if (!draft) return;
    setDraft({ ...draft, days: draft.days.map((day, position) => position === index ? { ...day, ...changes } : day) });
  }

  function updateActivity(dayIndex: number, activityIndex: number, changes: Partial<TravelProgrammeDraft["days"][number]["activities"][number]>) {
    if (!draft) return;
    updateDay(dayIndex, {
      activities: draft.days[dayIndex].activities.map((activity, position) =>
        position === activityIndex ? { ...activity, ...changes } : activity
      ),
    });
  }

  async function save() {
    if (!draft) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      await jsonResponse(await fetch(`/api/admin/platform/imports/${initialImport.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      }));
      setNotice("Revisione salvata.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Salvataggio non riuscito");
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!draft) return;
    const pending = pendingValidationCount(draft);
    if (pending > 0) {
      setError(`Restano ${pending} anagrafiche da validare. Controllale su Google e confermale prima di pubblicare.`);
      return;
    }
    if (!confirm("Pubblicare questo programma? Le giornate della versione corrente saranno sostituite.")) return;
    setBusy("publish"); setError(""); setNotice("");
    try {
      await jsonResponse(await fetch(`/api/admin/platform/imports/${initialImport.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      }));
      await jsonResponse(await fetch(`/api/admin/platform/imports/${initialImport.id}/publish`, { method: "POST" }));
      window.location.href = "/agenzia";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pubblicazione non riuscita");
      setBusy("");
    }
  }

  async function removeDraft() {
    if (!confirm("Eliminare questa bozza e il documento privato associato? L’operazione non è reversibile.")) return;
    setBusy("delete"); setError(""); setNotice("");
    try {
      await jsonResponse(await fetch(`/api/admin/platform/imports/${initialImport.id}`, {
        method: "DELETE",
      }));
      window.location.href = "/agenzia";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Eliminazione non riuscita");
      setBusy("");
    }
  }

  if (!draft) {
    return <main className="reviewPage"><section className="reviewUnavailable"><CircleAlert/><h1>Bozza non disponibile</h1><p>Stato: {initialImport.status}. Avvia o riprova l’elaborazione dal pannello.</p><a href="/agenzia"><ArrowLeft/> Torna al pannello</a></section></main>;
  }

  return (
    <main className="reviewPage">
      <header className="reviewTopbar">
        <a href="/agenzia"><ArrowLeft size={17}/> Pannello</a>
        <div><FileText size={18}/><span><small>REVISIONE PROGRAMMA</small><b>{initialImport.fileName}</b></span></div>
        <button onClick={save} disabled={Boolean(busy)}>{busy === "save" ? <LoaderCircle className="spin"/> : <Save/>}<span>Salva</span></button>
      </header>

      <section className="reviewHero">
        <p><Sparkles size={14}/> BOZZA GENERATA CON {initialImport.model ?? "GEMINI"}</p>
        <h1>Controlla prima di pubblicare.</h1>
        <span>Correggi interpretazioni e nomi. Paesi, città, siti e hotel devono risultare validati prima della pubblicazione.</span>
      </section>

      <div className="reviewShell">
        {error && <div className="agencyMessage error"><CircleAlert size={18}/>{error}</div>}
        {notice && <div className="agencyMessage success"><Check size={18}/>{notice}</div>}

        <section className="reviewGeneral">
          <label>Titolo del viaggio<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
          <label>Paese<input value={draft.destinationCountry} onChange={(event) => setDraft({ ...draft, destinationCountry: event.target.value })}/></label>
          <label>Data inizio<input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}/></label>
          <label>Data fine<input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}/></label>
          <label className="wide">Descrizione<textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })}/></label>
        </section>

        <div className="reviewHeading"><div><small>ITINERARIO ESTRATTO</small><h2>{draft.days.length} giornate</h2></div><span><CalendarDays/> Modifica liberamente ogni campo</span></div>

        <section className="reviewDays">
          {draft.days.map((day, dayIndex) => (
            <article className="reviewDay" key={`${day.dayNumber}-${dayIndex}`}>
              <header><span>{String(dayIndex + 1).padStart(2, "0")}</span><div><small>GIORNO {dayIndex + 1}</small><b>{day.title || "Senza titolo"}</b></div><button aria-label="Rimuovi giornata" onClick={() => setDraft({ ...draft, days: draft.days.filter((_, position) => position !== dayIndex) })}><Trash2/></button></header>
              <div className="dayFields">
                <label>Data<input type="date" value={day.date} onChange={(event) => updateDay(dayIndex, { date: event.target.value })}/></label>
                <label>Paese<input value={day.country} onChange={(event) => updateDay(dayIndex, { country: event.target.value, countryValidation: changedValidation("Paese") })}/></label>
                <div className="validationField"><ValidationControl validation={day.countryValidation} searchParts={[day.country]} onChange={(countryValidation) => updateDay(dayIndex, { countryValidation })}/></div>
                <label>Città<div className="iconInput"><MapPin/><input value={day.city} onChange={(event) => updateDay(dayIndex, { city: event.target.value, cityValidation: changedValidation("Città") })}/></div></label>
                <div className="validationField"><ValidationControl validation={day.cityValidation} searchParts={[day.city, day.country]} onChange={(cityValidation) => updateDay(dayIndex, { cityValidation })}/></div>
                <label className="wide">Titolo<input value={day.title} onChange={(event) => updateDay(dayIndex, { title: event.target.value })}/></label>
                <label className="wide">Descrizione<textarea value={day.description} onChange={(event) => updateDay(dayIndex, { description: event.target.value })}/></label>
              </div>

              <div className="activitiesEditor">
                <div className="subheading"><b>Visite e trasferimenti</b><button onClick={() => updateDay(dayIndex, { activities: [...day.activities, emptyActivity()] })}><Plus/> Aggiungi</button></div>
                {day.activities.map((activity, activityIndex) => (
                  <div className="activityEditor" key={activityIndex}>
                    <GripVertical className="dragHint"/>
                    <label>Tipo<div className="selectWrap"><select value={activity.type} onChange={(event) => updateActivity(dayIndex, activityIndex, { type: event.target.value as typeof activity.type })}>{activityTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown/></div></label>
                    {activity.type !== "visit" && <label className="activityTitle">Attività<input value={activity.title} onChange={(event) => updateActivity(dayIndex, activityIndex, { title: event.target.value })}/></label>}
                    {activity.type === "visit" && <>
                      <label className="activityTitle">Sito / luogo<input value={activity.placeName} onChange={(event) => updateActivity(dayIndex, activityIndex, { title: event.target.value, placeName: event.target.value, placeValidation: changedValidation("Sito") })}/></label>
                      <label>Paese del sito<input value={activity.placeCountry} onChange={(event) => updateActivity(dayIndex, activityIndex, { placeCountry: event.target.value, placeValidation: changedValidation("Località del sito") })}/></label>
                      <label>Città del sito<input value={activity.placeCity} onChange={(event) => updateActivity(dayIndex, activityIndex, { placeCity: event.target.value, placeValidation: changedValidation("Località del sito") })}/></label>
                      <div className="siteValidation"><ValidationControl validation={activity.placeValidation} searchParts={[activity.placeName, activity.placeCity, activity.placeCountry]} onChange={(placeValidation) => updateActivity(dayIndex, activityIndex, { placeValidation })}/></div>
                    </>}
                    <button className="removeActivity" aria-label="Rimuovi attività" onClick={() => updateDay(dayIndex, { activities: day.activities.filter((_, position) => position !== activityIndex) })}><Trash2/></button>
                  </div>
                ))}
              </div>

              <div className="hotelEditor"><Hotel/><div><b>Pernottamento</b><span>Lascia vuoto se non previsto</span></div><label>Hotel<input value={day.accommodation.name} onChange={(event) => updateDay(dayIndex, { accommodation: { ...day.accommodation, name: event.target.value, validation: changedValidation("Hotel") } })}/></label><label>Città<input value={day.accommodation.city} onChange={(event) => updateDay(dayIndex, { accommodation: { ...day.accommodation, city: event.target.value, validation: changedValidation("Località dell’hotel") } })}/></label><label>Paese<input value={day.accommodation.country} onChange={(event) => updateDay(dayIndex, { accommodation: { ...day.accommodation, country: event.target.value, validation: changedValidation("Località dell’hotel") } })}/></label>{day.accommodation.name.trim() && <div className="hotelValidation"><ValidationControl validation={day.accommodation.validation} searchParts={[day.accommodation.name, day.accommodation.city, day.accommodation.country]} onChange={(validation) => updateDay(dayIndex, { accommodation: { ...day.accommodation, validation } })}/></div>}</div>
            </article>
          ))}
        </section>

        <button className="addDay" onClick={() => setDraft({ ...draft, days: [...draft.days, { dayNumber: draft.days.length + 1, date: "", label: "", title: "Nuova giornata", country: "", countryValidation: changedValidation("Paese"), city: "", cityValidation: changedValidation("Città"), description: "", activities: [], accommodation: { name: "", city: "", country: "", notes: "", validation: changedValidation("Hotel") } }] })}><Plus/> Aggiungi giornata</button>

        <section className="reviewUseful">
          <div className="reviewHeading"><div><small>DAL DOCUMENTO</small><h2>Informazioni utili</h2></div></div>
          {draft.usefulInformation.map((info, index) => <article key={index}><input value={info.category} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, category: event.target.value } : item) })}/><input value={info.title} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, title: event.target.value } : item) })}/><textarea value={info.body} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, body: event.target.value } : item) })}/><button aria-label="Rimuovi informazione" onClick={() => setDraft({ ...draft, usefulInformation: draft.usefulInformation.filter((_, position) => position !== index) })}><Trash2/></button></article>)}
        </section>

        <footer className="reviewActions"><div><BedDouble/><span><b>{pendingValidationCount(draft) > 0 ? `${pendingValidationCount(draft)} anagrafiche da validare` : "Pronto per la pubblicazione"}</b><small>{pendingValidationCount(draft) > 0 ? "Apri Google, correggi se necessario e conferma ogni elemento." : `Verranno create ${draft.days.length} giornate.`}</small></span></div><button className="secondary" onClick={removeDraft} disabled={Boolean(busy)}>{busy === "delete" ? <LoaderCircle className="spin"/> : <Trash2/>} Elimina bozza</button><button className="secondary" onClick={save} disabled={Boolean(busy)}><Save/> Salva bozza</button><button onClick={publish} disabled={Boolean(busy) || pendingValidationCount(draft) > 0}>{busy === "publish" ? <LoaderCircle className="spin"/> : <Send/>} Pubblica programma</button></footer>
      </div>
    </main>
  );
}
