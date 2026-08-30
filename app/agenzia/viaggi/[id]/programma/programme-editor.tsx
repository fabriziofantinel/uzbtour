"use client";

import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, BedDouble, BookOpen, Bus, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, Download, FileText, LoaderCircle, MapPin, MessageCircle, Plane, Plus, Save, TrainFront, Trash2, Upload, UsersRound, Utensils } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { uploadPrivateFile } from "@/lib/private-upload-client";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";
import type { AgencyProgramme } from "@/lib/platform/programme-repository";

type Props = { initialProgramme: AgencyProgramme };
type Day = AgencyProgramme["days"][number];
type Item = Day["items"][number];

const activityTypes = [
  ["visit", "Visita"], ["transport", "Trasferimento"], ["flight", "Volo"],
  ["train", "Treno"], ["hotel", "Hotel"], ["meal", "Pasto"],
  ["free_time", "Tempo libero"], ["meeting", "Incontro"], ["other", "Altro"],
] as const satisfies ReadonlyArray<readonly [Item["type"], string]>;
const timedActivityTypes = new Set<Item["type"]>(["transport", "flight", "train", "meal", "meeting"]);

function emptyItem(sortOrder: number): Item {
  return { id: crypto.randomUUID(), type: "visit", title: "", description: "", startsAt: "", endsAt: "", sortOrder,
    operationalStatus: "planned", statusReason: "", tickets: [], includedInQuote: null };
}

function emptyHotel(sortOrder: number): Day["hotels"][number] {
  return { id: crypto.randomUUID(), name: "", notes: "", sortOrder };
}

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

function itemPresentation(type: string) {
  if (type === "transport") return { Icon: Bus, label: "Trasferimento" };
  if (type === "flight") return { Icon: Plane, label: "Volo" };
  if (type === "train") return { Icon: TrainFront, label: "Treno" };
  if (type === "meal") return { Icon: Utensils, label: "Pasto" };
  if (type === "hotel") return { Icon: BedDouble, label: "Hotel" };
  return { Icon: MapPin, label: type === "visit" ? "Visita" : "Attività" };
}

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || "Salvataggio non riuscito");
}

export default function ProgrammeEditor({ initialProgramme }: Props) {
  const [days, setDays] = useState(initialProgramme.days);
  const [openDayId, setOpenDayId] = useState(() => initialDayId(initialProgramme.days, initialProgramme.departure.startsOn));
  const [expandedItems, setExpandedItems] = useState(() => new Set(initialProgramme.days.flatMap((day) => day.items[0] ? [day.items[0].id] : [])));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [cancellationReasons, setCancellationReasons] = useState<Record<string, string>>({});
  const savedDaysRef = useRef(new Map(initialProgramme.days.map((day) => [day.id, JSON.stringify(day)])));
  const departure = initialProgramme.departure;
  const openDay = useMemo(() => days.find((day) => day.id === openDayId), [days, openDayId]);
  const openDayIndex = useMemo(() => days.findIndex((day) => day.id === openDayId), [days, openDayId]);
  const dirtyDayIds = useMemo(() => new Set(days
    .filter((day) => savedDaysRef.current.get(day.id) !== JSON.stringify(day))
    .map((day) => day.id)), [days, message]);
  const agencyColor = validBrandColor(departure.agencyPrimaryColor);
  const agencyStyle = {
    "--agency-ui": agencyColor,
    "--agency-ui-ink": "#111111",
    "--smf-brand": agencyColor,
    "--smf-brand-deep": agencyColor,
    "--smf-action": agencyColor,
    "--smf-focus": accessibleBrandColor(agencyColor),
  } as CSSProperties;

  useEffect(() => {
    if (!dirtyDayIds.size) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirtyDayIds]);

  function updateDay(dayId: string, patch: Partial<Day>) {
    setDays((current) => current.map((day) => day.id === dayId ? { ...day, ...patch } : day));
  }

  function updateItem(day: Day, itemId: string, patch: Partial<Day["items"][number]>) {
    updateDay(day.id, { items: day.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) });
  }

  function updateHotel(day: Day, hotelId: string, patch: Partial<Day["hotels"][number]>) {
    updateDay(day.id, { hotels: day.hotels.map((hotel) => hotel.id === hotelId ? { ...hotel, ...patch } : hotel) });
  }

  function addItem(day: Day) {
    const item = emptyItem(day.items.length);
    updateDay(day.id, { items: [...day.items, item] });
    setItemExpanded(item.id, true);
  }

  function removeItem(day: Day, itemId: string) {
    updateDay(day.id, { items: day.items.filter((item) => item.id !== itemId) });
    setItemExpanded(itemId, false);
  }

  async function cancelItem(day: Day, item: Item) {
    const reason = (cancellationReasons[item.id] || "").trim();
    if (reason.length < 3) {
      setMessage({ kind: "error", text: "Indica il motivo dell’annullamento della tappa." });
      return;
    }
    if (!confirm(`Annullare “${item.title}”? La tappa resterà nello storico operativo.`)) return;
    setBusy(`cancel-${item.id}`); setMessage(null);
    try {
      await responseJson(await fetch(`/api/admin/platform/departures/${departure.id}/programme`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancelItem", itemId: item.id, reason, clientOperationId: crypto.randomUUID() }),
      }));
      const nextDay = { ...day, items: day.items.filter((entry) => entry.id !== item.id) };
      setDays((current) => current.map((entry) => entry.id === day.id ? nextDay : entry));
      savedDaysRef.current.set(day.id, JSON.stringify(nextDay));
      setMessage({ kind: "success", text: "Tappa annullata. Lo storico operativo è stato conservato e i viaggiatori saranno avvisati." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Annullamento non riuscito." });
    } finally { setBusy(""); }
  }

  function addHotel(day: Day) {
    updateDay(day.id, { hotels: [...day.hotels, emptyHotel(day.hotels.length)] });
  }

  function removeHotel(day: Day, hotelId: string) {
    updateDay(day.id, { hotels: day.hotels.filter((hotel) => hotel.id !== hotelId) });
  }

  function moveItem(day: Day, index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= day.items.length) return;
    const items = [...day.items];
    [items[index], items[target]] = [items[target], items[index]];
    updateDay(day.id, { items });
  }

  function setItemExpanded(itemId: string, expanded: boolean) {
    setExpandedItems((current) => {
      const next = new Set(current);
      if (expanded) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  async function saveDay(day: Day) {
    if (!day.title.trim()) { setMessage({ kind: "error", text: `Inserisci il titolo del giorno ${day.number} prima di salvare.` }); return; }
    setBusy(day.id); setMessage(null);
    try {
      await responseJson(await fetch(`/api/admin/platform/departures/${departure.id}/programme`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...day, dayId: day.id }),
      }));
      savedDaysRef.current.set(day.id, JSON.stringify(day));
      setMessage({ kind: "success", text: `Giorno ${day.number} salvato. La modifica è condivisa da tutte le partenze del programma.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Salvataggio non riuscito. Riprova senza perdere le modifiche." });
    } finally { setBusy(""); }
  }

  async function uploadTicket(dayId: string, itemId: string, file: File) {
    const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (file.size > 25 * 1024 * 1024) { setMessage({ kind: "error", text: "Il biglietto supera 25 MB. Scegli un file più piccolo." }); return; }
    if (!allowedTypes.has(file.type)) { setMessage({ kind: "error", text: "Formato non supportato. Carica un PDF oppure un’immagine JPG, PNG o WebP." }); return; }
    setBusy(`ticket-${itemId}`); setMessage(null);
    try {
      const uploaded = await uploadPrivateFile({
        endpoint: `/api/admin/platform/departures/${departure.id}/tickets/upload`,
        file,
        payload: { itemId },
      });
      const response = await fetch(`/api/admin/platform/departures/${departure.id}/tickets`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, objectKey: uploaded.key, originalName: file.name, contentType: uploaded.contentType }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; ticket?: Day["items"][number]["tickets"][number] };
      if (!response.ok || !result.ticket) throw new Error(result.error || "Biglietto non registrato");
      setDays((current) => current.map((day) => day.id !== dayId ? day : ({ ...day,
        items: day.items.map((item) => item.id === itemId ? { ...item, tickets: [...item.tickets, result.ticket!] } : item),
      })));
      setMessage({ kind: "success", text: "Biglietto caricato. I viaggiatori potranno scaricarlo dal programma." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Caricamento del biglietto non riuscito. Riprova." });
    } finally { setBusy(""); }
  }

  return <main className="programmePage" style={agencyStyle}>
    <header className="programmeTopbar">
      <Link href="/agenzia"><ArrowLeft/> Tutti i viaggi</Link>
      <nav aria-label="Gestione del viaggio"><span aria-current="page"><BookOpen/> Programma</span><Link href={`/agenzia/viaggi/${departure.id}`}><UsersRound/> Gruppi</Link><Link href={`/agenzia/viaggi/${departure.id}/documenti`}><FileText/> Documenti</Link><Link href={`/agenzia/viaggi/${departure.id}/chat`}><MessageCircle/> Chat</Link>{departure.quoteImportId && <details className="programmeQuotes"><summary><Download/> Preventivi</summary><div><a href={`/api/admin/platform/imports/${departure.quoteImportId}/original`}><FileText/> Originale</a><a href={`/api/admin/platform/imports/${departure.quoteImportId}/normalized`}><Download/> Revisionato DOCX</a></div></details>}</nav>
      <span className="programmeHeaderBalance" aria-hidden="true"/>
    </header>
    <section className="journeyManageHero programmeHero"><small>{departure.destinationCountry}</small><h1>{departure.programmeTitle}</h1><p><CalendarDays/> {dateFor(departure.startsOn, 0)} – {dateFor(departure.startsOn, Math.max(0, days.length - 1))}</p></section>
    <section className="programmeNotice">
      <CalendarDays/><div><b>Partenza visualizzata: {departure.title}</b><span>{dateFor(departure.startsOn, 0)} – {dateFor(departure.startsOn, Math.max(0, days.length - 1))}</span></div>
      {dirtyDayIds.size > 0 && <strong className="programmeUnsaved" role="status">{dirtyDayIds.size} {dirtyDayIds.size === 1 ? "giornata da salvare" : "giornate da salvare"}</strong>}
    </section>
    {message && <div className={`programmeMessage ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.kind === "error" ? <CircleAlert/> : <CheckCircle2/>}{message.text}</div>}
    <div className="programmeLayout">
      <nav className="programmeDays" aria-label="Giornate del programma">
        {days.map((day) => <button type="button" key={day.id} className={day.id === openDayId ? "active" : ""} aria-current={day.id === openDayId ? "page" : undefined} onClick={() => setOpenDayId(day.id)}>
          <small>GIORNO {day.number}{dirtyDayIds.has(day.id) ? " · DA SALVARE" : ""}</small><b>{dateFor(departure.startsOn, day.offset)}</b><span>{day.city || day.title || "Da completare"}</span>
        </button>)}
      </nav>
      {openDay && <section className="dayEditor">
        <div className="dayEditorHead"><div><small>GIORNO {openDay.number}{dirtyDayIds.has(openDay.id) ? " · MODIFICHE DA SALVARE" : " · SALVATO"}</small><h2>{dateFor(departure.startsOn, openDay.offset)}</h2><span>{openDay.items.length} {openDay.items.length === 1 ? "attività" : "attività"} · {openDay.hotels.length} {openDay.hotels.length === 1 ? "pernottamento" : "pernottamenti"}</span></div><div className="dayEditorActions"><div className="dayPager"><button type="button" aria-label="Giornata precedente" disabled={openDayIndex <= 0} onClick={() => setOpenDayId(days[openDayIndex - 1].id)}><ChevronLeft/></button><button type="button" aria-label="Giornata successiva" disabled={openDayIndex < 0 || openDayIndex >= days.length - 1} onClick={() => setOpenDayId(days[openDayIndex + 1].id)}><ChevronRight/></button></div><button className="saveDayButton" type="button" disabled={Boolean(busy) || !dirtyDayIds.has(openDay.id)} onClick={() => void saveDay(openDay)}>{busy === openDay.id ? <><LoaderCircle className="spin"/> Salvataggio…</> : <><Save/> Salva giornata</>}</button></div></div>
        <div className="dayFields">
          <label>Etichetta<input value={openDay.label} onChange={(event) => updateDay(openDay.id, { label: event.target.value })}/></label>
          <label>Titolo<input value={openDay.title} onChange={(event) => updateDay(openDay.id, { title: event.target.value })}/></label>
          <label><MapPin/> Località<input value={openDay.city} onChange={(event) => updateDay(openDay.id, { city: event.target.value })}/></label>
          <label className="wide">Descrizione<textarea rows={4} value={openDay.description} onChange={(event) => updateDay(openDay.id, { description: event.target.value })}/></label>
        </div>
        <div className="programmeBlock"><div className="programmeBlockHead"><h3>Programma della giornata</h3><button type="button" onClick={() => addItem(openDay)}><Plus/> Aggiungi attività</button></div>
          {openDay.items.map((item, index) => { const presentation = itemPresentation(item.type); const ItemIcon = presentation.Icon; return <article className="programmeItem" key={item.id}>
            <div className="orderButtons"><span>{String(index + 1).padStart(2, "0")}</span><button type="button" aria-label={`Sposta “${item.title}” in alto`} onClick={() => moveItem(openDay, index, -1)} disabled={index === 0}><ArrowUp/></button><button type="button" aria-label={`Sposta “${item.title}” in basso`} onClick={() => moveItem(openDay, index, 1)} disabled={index === openDay.items.length - 1}><ArrowDown/></button></div>
            <details className="itemEditorDetails" open={expandedItems.has(item.id)} onToggle={(event) => setItemExpanded(item.id, event.currentTarget.open)}><summary><span className="itemSummaryIcon"><ItemIcon/></span><span><small>{presentation.label}{item.startsAt ? ` · ${item.startsAt}${item.endsAt ? `–${item.endsAt}` : ""}` : ""}</small><strong>{item.title || `${presentation.label} da completare`}</strong><em>{item.description || "Nessuna nota inserita"}</em></span><ChevronRight/></summary>
            <div className="itemFields"><label>Tipo<div className="programmeSelect"><select value={item.type} onChange={(event) => { const type = event.target.value as Item["type"]; updateItem(openDay, item.id, { type, ...(!timedActivityTypes.has(type) ? { startsAt: "", endsAt: "" } : {}) }); }} aria-label={`Tipo attività ${index + 1}`}>{activityTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown/></div></label><label>Titolo<input value={item.title} onChange={(event) => updateItem(openDay, item.id, { title: event.target.value })}/></label>
              {timedActivityTypes.has(item.type) && <div className="timeFields"><Clock3/><label>Orario di inizio<input type="time" value={item.startsAt} onChange={(event) => updateItem(openDay, item.id, { startsAt: event.target.value })}/></label><label>Orario di fine<input type="time" value={item.endsAt} onChange={(event) => updateItem(openDay, item.id, { endsAt: event.target.value })}/></label></div>}
              <label className="wide">{item.type === "transport" ? "Note operative (autista, telefono, targa o punto d’incontro)" : "Note"}<textarea rows={2} value={item.description} onChange={(event) => updateItem(openDay, item.id, { description: event.target.value })}/></label>
              {(["flight", "train"].includes(item.type)) && <div className="ticketManager"><div className="ticketManagerHead"><FileText/><div><b>Biglietti</b><small>Salva prima una nuova attività, poi allega PDF o immagini fino a 25 MB.</small></div><label className={busy === `ticket-${item.id}` ? "busy" : ""}>{busy === `ticket-${item.id}` ? <LoaderCircle className="spin"/> : <Upload/>}<span>{busy === `ticket-${item.id}` ? "Caricamento…" : "Allega biglietto"}</span><input type="file" aria-label={`Allega biglietto per ${item.title}`} accept="application/pdf,image/jpeg,image/png,image/webp,.pdf" disabled={busy === `ticket-${item.id}` || dirtyDayIds.has(openDay.id)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadTicket(openDay.id, item.id, file); }}/></label></div>{item.tickets.length > 0 ? <div className="ticketList">{item.tickets.map((ticket) => <a href={ticket.downloadUrl} key={ticket.id}><FileText/><span>{ticket.title}</span><Download/></a>)}</div> : <p className="ticketEmpty">Nessun biglietto allegato.</p>}</div>}
              <div className="programmeItemRemoval">
                <button type="button" className="removeProgrammeItem" onClick={() => removeItem(openDay, item.id)}><Trash2/> Elimina dalla bozza</button>
                {!dirtyDayIds.has(openDay.id) && <div className="programmeDisruption"><label>Motivo dell’annullamento<input value={cancellationReasons[item.id] || ""} maxLength={1000} placeholder="Es. visita annullata per chiusura straordinaria" onChange={(event) => setCancellationReasons((current) => ({ ...current, [item.id]: event.target.value }))}/></label><button type="button" className="cancelProgrammeItem" disabled={Boolean(busy)} onClick={() => void cancelItem(openDay, item)}>{busy === `cancel-${item.id}` ? <LoaderCircle className="spin"/> : <CircleAlert/>} Annulla tappa</button></div>}
              </div>
            </div></details>
          </article>; })}
          {openDay.items.length === 0 && <div className="programmeEmpty"><CalendarDays/><b>Nessuna attività</b><p>Questa giornata non contiene ancora tappe modificabili.</p></div>}
        </div>
        <div className="programmeBlock"><div className="programmeBlockHead"><h3><BedDouble/> Pernottamenti</h3><button type="button" onClick={() => addHotel(openDay)}><Plus/> Nuovo pernottamento</button></div>{openDay.hotels.map((hotel, index) => <article className="hotelFields" key={hotel.id}><label>Hotel<input value={hotel.name} onChange={(event) => updateHotel(openDay, hotel.id, { name: event.target.value })}/></label><label>Note<textarea rows={2} value={hotel.notes} onChange={(event) => updateHotel(openDay, hotel.id, { notes: event.target.value })}/></label><button type="button" className="removeProgrammeItem" onClick={() => removeHotel(openDay, hotel.id)}><Trash2/> Elimina pernottamento {index + 1}</button></article>)}{openDay.hotels.length === 0 && <div className="programmeEmpty"><BedDouble/><b>Nessun pernottamento</b><p>Aggiungilo solo quando previsto dal programma.</p></div>}</div>
      </section>}
    </div>
  </main>;
}
