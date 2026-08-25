"use client";

import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, BedDouble, CalendarDays, CheckCircle2, Clock3, LoaderCircle, MapPin, Save } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgencyProgramme } from "@/lib/platform/programme-repository";

type Props = { initialProgramme: AgencyProgramme };
type Day = AgencyProgramme["days"][number];

function dateFor(startsOn: string, offset: number) {
  const date = new Date(`${startsOn}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function initialDayId(days: AgencyProgramme["days"], startsOn: string) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const current = days.find((day) => {
    const date = new Date(`${startsOn}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day.offset);
    return date.toISOString().slice(0, 10) === today;
  });
  return current?.id ?? days[0]?.id ?? "";
}

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || "Salvataggio non riuscito");
}

export default function ProgrammeEditor({ initialProgramme }: Props) {
  const [days, setDays] = useState(initialProgramme.days);
  const [openDayId, setOpenDayId] = useState(() => initialDayId(initialProgramme.days, initialProgramme.departure.startsOn));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const departure = initialProgramme.departure;
  const openDay = useMemo(() => days.find((day) => day.id === openDayId), [days, openDayId]);

  function updateDay(dayId: string, patch: Partial<Day>) {
    setDays((current) => current.map((day) => day.id === dayId ? { ...day, ...patch } : day));
  }

  function moveItem(day: Day, index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= day.items.length) return;
    const items = [...day.items];
    [items[index], items[target]] = [items[target], items[index]];
    updateDay(day.id, { items });
  }

  async function saveDay(day: Day) {
    setBusy(day.id); setMessage("");
    try {
      await responseJson(await fetch(`/api/admin/platform/departures/${departure.id}/programme`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(day),
      }));
      setMessage(`Giorno ${day.number} salvato. La modifica è condivisa da tutte le partenze del programma.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Salvataggio non riuscito");
    } finally { setBusy(""); }
  }

  return <main className="programmePage">
    <header className="programmeTopbar">
      <Link href="/agenzia"><ArrowLeft/> Viaggi</Link>
      <div><small>PROGRAMMA CONDIVISO · VERSIONE {departure.versionNumber}</small><h1>{departure.programmeTitle}</h1></div>
      <Link href={`/agenzia/viaggi/${departure.id}`}>Famiglie</Link>
    </header>
    <section className="programmeNotice">
      <CalendarDays/><div><b>Partenza visualizzata: {departure.title}</b><span>{dateFor(departure.startsOn, 0)} – {dateFor(departure.startsOn, Math.max(0, days.length - 1))}</span></div>
      <p>Itinerario e contenuti appartengono al preventivo: ogni modifica vale per tutte le partenze collegate. Spese, ricordi, giochi e contest restano invece separati per famiglia.</p>
    </section>
    {message && <div className="programmeMessage"><CheckCircle2/>{message}</div>}
    <div className="programmeLayout">
      <nav className="programmeDays" aria-label="Giornate del programma">
        {days.map((day) => <button key={day.id} className={day.id === openDayId ? "active" : ""} onClick={() => setOpenDayId(day.id)}>
          <small>GIORNO {day.number}</small><b>{dateFor(departure.startsOn, day.offset)}</b><span>{day.city || day.title || "Da completare"}</span>
        </button>)}
      </nav>
      {openDay && <section className="dayEditor">
        <div className="dayEditorHead"><div><small>GIORNO {openDay.number}</small><h2>{dateFor(departure.startsOn, openDay.offset)}</h2></div><button disabled={busy === openDay.id} onClick={() => void saveDay(openDay)}>{busy === openDay.id ? <LoaderCircle className="spin"/> : <Save/>} Salva giornata</button></div>
        <div className="dayFields">
          <label>Etichetta<input value={openDay.label} onChange={(event) => updateDay(openDay.id, { label: event.target.value })}/></label>
          <label>Titolo<input value={openDay.title} onChange={(event) => updateDay(openDay.id, { title: event.target.value })}/></label>
          <label><MapPin/> Località<input value={openDay.city} onChange={(event) => updateDay(openDay.id, { city: event.target.value })}/></label>
          <label className="wide">Descrizione<textarea rows={4} value={openDay.description} onChange={(event) => updateDay(openDay.id, { description: event.target.value })}/></label>
        </div>
        <div className="programmeBlock"><h3>Programma della giornata</h3>
          {openDay.items.map((item, index) => <article className="programmeItem" key={item.id}>
            <div className="orderButtons"><button aria-label="Sposta su" onClick={() => moveItem(openDay, index, -1)} disabled={index === 0}><ArrowUp/></button><button aria-label="Sposta giù" onClick={() => moveItem(openDay, index, 1)} disabled={index === openDay.items.length - 1}><ArrowDown/></button></div>
            <div className="itemFields"><label>Tipo<span>{item.type}</span></label><label>Titolo<input value={item.title} onChange={(event) => updateDay(openDay.id, { items: openDay.items.map((entry) => entry.id === item.id ? { ...entry, title: event.target.value } : entry) })}/></label>
              {(["transport", "flight", "train"].includes(item.type)) && <div className="timeFields"><Clock3/><label>Inizio<input type="time" value={item.startsAt} onChange={(event) => updateDay(openDay.id, { items: openDay.items.map((entry) => entry.id === item.id ? { ...entry, startsAt: event.target.value } : entry) })}/></label><label>Fine<input type="time" value={item.endsAt} onChange={(event) => updateDay(openDay.id, { items: openDay.items.map((entry) => entry.id === item.id ? { ...entry, endsAt: event.target.value } : entry) })}/></label></div>}
              {item.type === "meal" && <label className="mealIncluded">Inclusione nel preventivo<select value={item.includedInQuote == null ? "unknown" : item.includedInQuote ? "included" : "excluded"} onChange={(event) => updateDay(openDay.id, { items: openDay.items.map((entry) => entry.id === item.id ? { ...entry, includedInQuote: event.target.value === "unknown" ? null : event.target.value === "included" } : entry) })}><option value="unknown">Da confermare</option><option value="included">Incluso</option><option value="excluded">Non incluso</option></select></label>}
              <label className="wide">Note<textarea rows={2} value={item.description} onChange={(event) => updateDay(openDay.id, { items: openDay.items.map((entry) => entry.id === item.id ? { ...entry, description: event.target.value } : entry) })}/></label>
            </div>
          </article>)}
        </div>
        {openDay.hotels.length > 0 && <div className="programmeBlock"><h3><BedDouble/> Pernottamento</h3>{openDay.hotels.map((hotel) => <article className="hotelFields" key={hotel.id}><label>Hotel<input value={hotel.name} onChange={(event) => updateDay(openDay.id, { hotels: openDay.hotels.map((entry) => entry.id === hotel.id ? { ...entry, name: event.target.value } : entry) })}/></label><label>Note<textarea rows={2} value={hotel.notes} onChange={(event) => updateDay(openDay.id, { hotels: openDay.hotels.map((entry) => entry.id === hotel.id ? { ...entry, notes: event.target.value } : entry) })}/></label></article>)}</div>}
      </section>}
    </div>
  </main>;
}
