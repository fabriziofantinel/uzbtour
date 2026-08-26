"use client";

import {
  ArrowDown, ArrowLeft, ArrowUp, BedDouble, CalendarDays, Check, ChevronDown, CircleAlert, FileText,
  ExternalLink, Hotel, LoaderCircle, MapPin, Plus, Save, Send,
  ShieldCheck, Sparkles, Trash2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TravelProgrammeDraft } from "@/lib/platform/import-schema";
import type { PlatformImportReview } from "@/lib/platform/types";

const activityTypes = [
  ["visit", "Visita"], ["transport", "Trasferimento"], ["flight", "Volo"],
  ["train", "Treno"], ["hotel", "Hotel"], ["meal", "Pasto"],
  ["free_time", "Tempo libero"], ["meeting", "Incontro"], ["other", "Altro"],
] as const;

const timedActivityTypes = new Set<TravelProgrammeDraft["days"][number]["activities"][number]["type"]>([
  "transport", "flight", "train",
]);

async function jsonResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
  return result;
}

function emptyActivity(): TravelProgrammeDraft["days"][number]["activities"][number] {
  return {
    type: "visit", title: "", description: "", startsAt: "", endsAt: "", includedInQuote: null,
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
      <a
        aria-label={`Controlla ${searchParts.filter(Boolean).join(", ") || "l’anagrafica"} su Google`}
        href={googleSearchUrl(searchParts)}
        target="_blank"
        rel="noreferrer"
        title="Controlla su Google"
      ><ExternalLink/></a>
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
  const [pendingAction, setPendingAction] = useState<"publish" | "delete" | null>(null);
  const savedSignatureRef = useRef(JSON.stringify(initialImport.draft));
  const navigatingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const draftSignature = useMemo(() => JSON.stringify(draft), [draft]);
  const isDirty = draftSignature !== savedSignatureRef.current;
  const validationsPending = useMemo(() => draft ? pendingValidationCount(draft) : 0, [draft]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { if (!navigatingRef.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isDirty]);

  useEffect(() => {
    if (!pendingAction) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setPendingAction(null);
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); previousFocus?.focus(); };
  }, [pendingAction, busy]);

  function validateDraftForSave() {
    if (!draft) return "La bozza non è disponibile.";
    if (!draft.title.trim()) return "Inserisci il titolo del viaggio prima di salvare.";
    if (!draft.days.length) return "Il programma deve contenere almeno una giornata.";
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      return "La data di fine non può precedere la data di inizio.";
    }
    return "";
  }

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

  function moveActivity(dayIndex: number, activityIndex: number, direction: -1 | 1) {
    if (!draft) return;
    const destination = activityIndex + direction;
    const activities = [...draft.days[dayIndex].activities];
    if (destination < 0 || destination >= activities.length) return;
    [activities[activityIndex], activities[destination]] = [activities[destination], activities[activityIndex]];
    updateDay(dayIndex, { activities });
  }

  async function save() {
    if (!draft) return;
    const validationError = validateDraftForSave();
    if (validationError) { setError(validationError); setNotice(""); return; }
    setBusy("save"); setError(""); setNotice("");
    try {
      await jsonResponse(await fetch(`/api/admin/platform/imports/${initialImport.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      }));
      savedSignatureRef.current = JSON.stringify(draft);
      setNotice("Revisione salvata.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Salvataggio non riuscito");
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!draft) return;
    const validationError = validateDraftForSave();
    if (validationError) { setError(validationError); setNotice(""); return; }
    const pending = validationsPending;
    if (pending > 0) {
      setError(`Restano ${pending} anagrafiche da validare. Controllale su Google e confermale prima di pubblicare.`);
      return;
    }
    setError("");
    setPendingAction("publish");
  }

  async function publishConfirmed() {
    if (!draft) return;
    setBusy("publish"); setError(""); setNotice("");
    try {
      await jsonResponse(await fetch(`/api/admin/platform/imports/${initialImport.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      }));
      await jsonResponse(await fetch(`/api/admin/platform/imports/${initialImport.id}/publish`, { method: "POST" }));
      navigatingRef.current = true;
      window.location.href = "/agenzia";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pubblicazione non riuscita");
      setBusy("");
    }
  }

  async function removeDraft() {
    setError("");
    setPendingAction("delete");
  }

  async function removeDraftConfirmed() {
    setBusy("delete"); setError(""); setNotice("");
    try {
      await jsonResponse(await fetch(`/api/admin/platform/imports/${initialImport.id}`, {
        method: "DELETE",
      }));
      navigatingRef.current = true;
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
        <div><FileText size={18}/><span><small>REVISIONE PROGRAMMA</small><b>{initialImport.normalizedFileName ?? initialImport.sourceFileName}</b></span></div>
        <span className={isDirty ? "reviewSaveState dirty" : "reviewSaveState"} role="status">{isDirty ? "Modifiche da salvare" : "Tutto salvato"}</span>
        <button type="button" aria-label="Salva la revisione" onClick={save} disabled={Boolean(busy) || !isDirty}>{busy === "save" ? <LoaderCircle className="spin"/> : <Save/>}<span>{busy === "save" ? "Salvataggio…" : "Salva"}</span></button>
      </header>

      <section className="reviewHero">
        <p><Sparkles size={14}/> BOZZA GENERATA CON {initialImport.model ?? "GEMINI"}</p>
        <h1>Controlla prima di pubblicare.</h1>
        <span>Correggi interpretazioni e nomi. Paesi, città, siti e hotel devono risultare validati prima della pubblicazione.</span>
      </section>

      <div className="reviewShell">
        {error && <div className="agencyMessage error" role="alert"><CircleAlert size={18}/>{error}</div>}
        {notice && <div className="agencyMessage success" role="status" aria-live="polite"><Check size={18}/>{notice}</div>}

        <section className="normalizedSource" aria-label="Documenti dell’importazione">
          <FileText/>
          <div><small>PREVENTIVO ORIGINALE</small><b>{initialImport.sourceFileName}</b></div>
          <span>interpretato in</span>
          <div><small>FONTE EFFETTIVAMENTE IMPORTATA</small><b>{initialImport.normalizedFileName ?? "In preparazione"}</b></div>
          {initialImport.normalizedFileName && <a href={`/api/admin/platform/imports/${initialImport.id}/normalized`}><ExternalLink/> Scarica DOCX SMF</a>}
        </section>

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
              <header><span>{String(dayIndex + 1).padStart(2, "0")}</span><div><small>GIORNO {dayIndex + 1}</small><b>{day.title || "Senza titolo"}</b></div><button type="button" aria-label={`Rimuovi giornata ${dayIndex + 1}`} onClick={() => setDraft({ ...draft, days: draft.days.filter((_, position) => position !== dayIndex) })}><Trash2/></button></header>
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
                <div className="subheading"><b>Visite e trasferimenti</b><button type="button" onClick={() => updateDay(dayIndex, { activities: [...day.activities, emptyActivity()] })}><Plus/> Aggiungi attività</button></div>
                {day.activities.map((activity, activityIndex) => (
                  <div className="activityEditor" key={activityIndex}>
                    <div className="activityOrder" aria-label={`Ordine attività ${activityIndex + 1}`}><button type="button" aria-label="Sposta attività in alto" title="Sposta in alto" disabled={activityIndex === 0} onClick={() => moveActivity(dayIndex, activityIndex, -1)}><ArrowUp/></button><span>{activityIndex + 1}</span><button type="button" aria-label="Sposta attività in basso" title="Sposta in basso" disabled={activityIndex === day.activities.length - 1} onClick={() => moveActivity(dayIndex, activityIndex, 1)}><ArrowDown/></button></div>
                    <label>Tipo<div className="selectWrap"><select value={activity.type} onChange={(event) => {
                      const type = event.target.value as typeof activity.type;
                      updateActivity(dayIndex, activityIndex, {
                        type,
                        ...(type === "meal" ? { includedInQuote: true } : {}),
                        ...(!timedActivityTypes.has(type) ? { startsAt: "", endsAt: "" } : {}),
                      });
                    }}>{activityTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown/></div></label>
                    {activity.type !== "visit" && <label className="activityTitle">Attività<input value={activity.title} onChange={(event) => updateActivity(dayIndex, activityIndex, { title: event.target.value })}/></label>}
                    {activity.type === "visit" && <>
                      <label className="activityTitle">Sito / luogo<input value={activity.placeName} onChange={(event) => updateActivity(dayIndex, activityIndex, { title: event.target.value, placeName: event.target.value, placeValidation: changedValidation("Sito") })}/></label>
                      <label>Paese del sito<input value={activity.placeCountry} onChange={(event) => updateActivity(dayIndex, activityIndex, { placeCountry: event.target.value, placeValidation: changedValidation("Località del sito") })}/></label>
                      <label>Città del sito<input value={activity.placeCity} onChange={(event) => updateActivity(dayIndex, activityIndex, { placeCity: event.target.value, placeValidation: changedValidation("Località del sito") })}/></label>
                    </>}
                    {timedActivityTypes.has(activity.type) && <><label className="activityTime">Ora inizio<input type="time" value={activity.startsAt} onChange={(event) => updateActivity(dayIndex, activityIndex, { startsAt: event.target.value })}/></label><label className="activityTime">Ora fine<input type="time" value={activity.endsAt} onChange={(event) => updateActivity(dayIndex, activityIndex, { endsAt: event.target.value })}/></label></>}
                    <button type="button" className="removeActivity" aria-label={`Rimuovi attività ${activityIndex + 1}`} onClick={() => updateDay(dayIndex, { activities: day.activities.filter((_, position) => position !== activityIndex) })}><Trash2/></button>
                    <label className="activityNotes">Note<textarea placeholder="Informazioni operative, riferimenti o indicazioni per l’agente" value={activity.description} onChange={(event) => updateActivity(dayIndex, activityIndex, { description: event.target.value })}/></label>
                    {activity.type === "visit" && <div className="siteValidation"><ValidationControl validation={activity.placeValidation} searchParts={[activity.placeName, activity.placeCity, activity.placeCountry]} onChange={(placeValidation) => updateActivity(dayIndex, activityIndex, { placeValidation })}/></div>}
                  </div>
                ))}
              </div>

              <div className="hotelEditor"><Hotel/><div><b>Pernottamento</b><span>Lascia vuoto se non previsto</span></div><label>Hotel<input value={day.accommodation.name} onChange={(event) => updateDay(dayIndex, { accommodation: { ...day.accommodation, name: event.target.value, validation: changedValidation("Hotel") } })}/></label><label>Città<input value={day.accommodation.city} onChange={(event) => updateDay(dayIndex, { accommodation: { ...day.accommodation, city: event.target.value, validation: changedValidation("Località dell’hotel") } })}/></label><label>Paese<input value={day.accommodation.country} onChange={(event) => updateDay(dayIndex, { accommodation: { ...day.accommodation, country: event.target.value, validation: changedValidation("Località dell’hotel") } })}/></label>{day.accommodation.name.trim() && <div className="hotelValidation"><ValidationControl validation={day.accommodation.validation} searchParts={[day.accommodation.name, day.accommodation.city, day.accommodation.country]} onChange={(validation) => updateDay(dayIndex, { accommodation: { ...day.accommodation, validation } })}/></div>}</div>
            </article>
          ))}
        </section>

        <button type="button" className="addDay" onClick={() => setDraft({ ...draft, days: [...draft.days, { dayNumber: draft.days.length + 1, date: "", label: "", title: "Nuova giornata", country: "", countryValidation: changedValidation("Paese"), city: "", cityValidation: changedValidation("Città"), description: "", activities: [], accommodation: { name: "", city: "", country: "", notes: "", validation: changedValidation("Hotel") } }] })}><Plus/> Aggiungi giornata</button>

        <section className="reviewUseful">
          <div className="reviewHeading"><div><small>DAL DOCUMENTO</small><h2>Informazioni utili</h2></div><button type="button" className="addUsefulInfo" onClick={() => setDraft({ ...draft, usefulInformation: [...draft.usefulInformation, { category: "Generale", title: "Nuova informazione", body: "Inserisci il contenuto", phone: "", url: "" }] })}><Plus/> Aggiungi informazione</button></div>
          {draft.usefulInformation.map((info, index) => <article key={index}>
            <label>Categoria<input aria-label={`Categoria informazione ${index + 1}`} maxLength={80} value={info.category} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, category: event.target.value } : item) })}/></label>
            <label>Titolo<input aria-label={`Titolo informazione ${index + 1}`} maxLength={240} value={info.title} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, title: event.target.value } : item) })}/></label>
            <label className="usefulBody">Contenuto<textarea aria-label={`Contenuto informazione ${index + 1}`} maxLength={6000} value={info.body} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, body: event.target.value } : item) })}/></label>
            <label>Telefono<input type="tel" maxLength={100} value={info.phone} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, phone: event.target.value } : item) })}/></label>
            <label>Link<input type="url" maxLength={500} placeholder="https://" value={info.url} onChange={(event) => setDraft({ ...draft, usefulInformation: draft.usefulInformation.map((item, position) => position === index ? { ...item, url: event.target.value } : item) })}/></label>
            <button type="button" aria-label={`Rimuovi informazione ${index + 1}`} onClick={() => setDraft({ ...draft, usefulInformation: draft.usefulInformation.filter((_, position) => position !== index) })}><Trash2/></button>
          </article>)}
          {draft.usefulInformation.length === 0 && <div className="reviewUsefulEmpty"><FileText/><p>Nessuna informazione utile estratta. Puoi aggiungerla manualmente prima di pubblicare.</p><button type="button" onClick={() => setDraft({ ...draft, usefulInformation: [{ category: "Generale", title: "Nuova informazione", body: "Inserisci il contenuto", phone: "", url: "" }] })}><Plus/> Aggiungi la prima</button></div>}
        </section>

        <footer className="reviewActions"><div><BedDouble/><span><b>{validationsPending > 0 ? `${validationsPending} anagrafiche da validare` : "Pronto per la pubblicazione"}</b><small>{validationsPending > 0 ? "Apri Google, correggi se necessario e conferma ogni elemento." : isDirty ? "Salva le modifiche o pubblica direttamente la versione aggiornata." : `Verranno create ${draft.days.length} giornate.`}</small></span></div><button type="button" className="secondary dangerText" aria-label="Elimina bozza" onClick={removeDraft} disabled={Boolean(busy)}><Trash2/><span>Elimina bozza</span></button><button type="button" className="secondary" onClick={save} disabled={Boolean(busy) || !isDirty}>{busy === "save" ? <LoaderCircle className="spin"/> : <Save/>}<span>{busy === "save" ? "Salvataggio…" : "Salva bozza"}</span></button><button type="button" onClick={publish} disabled={Boolean(busy) || validationsPending > 0}><Send/><span>Pubblica programma</span></button></footer>
      </div>
      {pendingAction && (
        <div className="reviewDialogBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingAction(null); }}>
          <section ref={dialogRef} className={`reviewConfirmDialog ${pendingAction}`} role="dialog" aria-modal="true" aria-labelledby="review-confirm-title">
            <button type="button" className="reviewDialogClose" aria-label="Chiudi" disabled={Boolean(busy)} onClick={() => setPendingAction(null)}><X/></button>
            <i>{pendingAction === "publish" ? <Send/> : <Trash2/>}</i>
            <h2 id="review-confirm-title">{pendingAction === "publish" ? "Pubblicare il programma?" : "Eliminare definitivamente la bozza?"}</h2>
            <p>{pendingAction === "publish" ? `Verranno pubblicate ${draft.days.length} giornate. L’attuale versione del programma sarà sostituita.` : `Saranno eliminati la bozza e il documento privato “${initialImport.sourceFileName}”. L’operazione non è reversibile.`}</p>
            {error && <div className="agencyMessage error dialogMessage" role="alert"><CircleAlert size={18}/>{error}</div>}
            <div>
              <button ref={cancelRef} type="button" className="secondary" disabled={Boolean(busy)} onClick={() => setPendingAction(null)}>Annulla</button>
              <button type="button" className={pendingAction === "delete" ? "danger" : "primary"} disabled={Boolean(busy)} onClick={() => void (pendingAction === "publish" ? publishConfirmed() : removeDraftConfirmed())}>{busy ? <LoaderCircle className="spin"/> : pendingAction === "publish" ? <Send/> : <Trash2/>}{busy ? (pendingAction === "publish" ? "Pubblicazione…" : "Eliminazione…") : (pendingAction === "publish" ? "Pubblica ora" : "Elimina definitivamente")}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
