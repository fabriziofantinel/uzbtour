"use client";

import {
  ArrowLeft, BedDouble, CalendarDays, Check, ChevronDown, CircleAlert, FileText,
  GripVertical, Hotel, LoaderCircle, MapPin, Plus, Save, Send, Sparkles, Trash2,
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
  return { type: "visit", title: "", description: "", startsAt: "", endsAt: "", placeName: "" };
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
    if (!draft || !confirm("Pubblicare questo programma? Le giornate della versione corrente saranno sostituite.")) return;
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
    if (!confirm("Eliminare questa bozza e il PDF privato associato? L’operazione non è reversibile.")) return;
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
        <span>Correggi interpretazioni, orari e nomi. Nulla sarà visibile ai viaggiatori finché non confermi.</span>
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
                <label>Città<div className="iconInput"><MapPin/><input value={day.city} onChange={(event) => updateDay(dayIndex, { city: event.target.value })}/></div></label>
                <label className="wide">Titolo<input value={day.title} onChange={(event) => updateDay(dayIndex, { title: event.target.value })}/></label>
                <label className="wide">Descrizione<textarea value={day.description} onChange={(event) => updateDay(dayIndex, { description: event.target.value })}/></label>
              </div>

              <div className="activitiesEditor">
                <div className="subheading"><b>Attività e trasferimenti</b><button onClick={() => updateDay(dayIndex, { activities: [...day.activities, emptyActivity()] })}><Plus/> Aggiungi</button></div>
                {day.activities.map((activity, activityIndex) => (
                  <div className="activityEditor" key={activityIndex}>
                    <GripVertical className="dragHint"/>
                    <label>Tipo<div className="selectWrap"><select value={activity.type} onChange={(event) => updateActivity(dayIndex, activityIndex, { type: event.target.value as typeof activity.type })}>{activityTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown/></div></label>
                    <label className="activityTitle">Attività<input value={activity.title} onChange={(event) => updateActivity(dayIndex, activityIndex, { title: event.target.value })}/></label>
                    <label className="activityTitle">Sito / luogo<input value={activity.placeName} onChange={(event) => updateActivity(dayIndex, activityIndex, { placeName: event.target.value })}/></label>
                    <label>Inizio<input type="time" value={activity.startsAt} onChange={(event) => updateActivity(dayIndex, activityIndex, { startsAt: event.target.value })}/></label>
                    <label>Fine<input type="time" value={activity.endsAt} onChange={(event) => updateActivity(dayIndex, activityIndex, { endsAt: event.target.value })}/></label>
                    <button className="removeActivity" aria-label="Rimuovi attività" onClick={() => updateDay(dayIndex, { activities: day.activities.filter((_, position) => position !== activityIndex) })}><Trash2/></button>
                  </div>
                ))}
              </div>

              <div className="hotelEditor"><Hotel/><div><b>Pernottamento</b><span>Lascia vuoto se non previsto</span></div><label>Hotel<input value={day.accommodation.name} onChange={(event) => updateDay(dayIndex, { accommodation: { ...day.accommodation, name: event.target.value } })}/></label><label>Città<input value={day.accommodation.city} onChange={(event) => updateDay(dayIndex, { accommodation: { ...day.accommodation, city: event.target.value } })}/></label></div>
            </article>
          ))}
        </section>

        <button className="addDay" onClick={() => setDraft({ ...draft, days: [...draft.days, { dayNumber: draft.days.length + 1, date: "", label: "", title: "Nuova giornata", city: "", description: "", activities: [], accommodation: { name: "", city: "", notes: "" } }] })}><Plus/> Aggiungi giornata</button>

        <section className="reviewUseful">
          <div className="reviewHeading"><div><small>DAL DOCUMENTO</small><h2>Informazioni utili</h2></div></div>
          {draft.usefulInformation.map((info, index) => <article key={index}><input value={info.category} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, category: event.target.value } : item) })}/><input value={info.title} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, title: event.target.value } : item) })}/><textarea value={info.body} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, body: event.target.value } : item) })}/><button aria-label="Rimuovi informazione" onClick={() => setDraft({ ...draft, usefulInformation: draft.usefulInformation.filter((_, position) => position !== index) })}><Trash2/></button></article>)}
        </section>

        <footer className="reviewActions"><div><BedDouble/><span><b>Pronto per la pubblicazione?</b><small>Verranno create {draft.days.length} giornate modificabili anche successivamente.</small></span></div><button className="secondary" onClick={removeDraft} disabled={Boolean(busy)}>{busy === "delete" ? <LoaderCircle className="spin"/> : <Trash2/>} Elimina bozza</button><button className="secondary" onClick={save} disabled={Boolean(busy)}><Save/> Salva bozza</button><button onClick={publish} disabled={Boolean(busy)}>{busy === "publish" ? <LoaderCircle className="spin"/> : <Send/>} Pubblica programma</button></footer>
      </div>
    </main>
  );
}
