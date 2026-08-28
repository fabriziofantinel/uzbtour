"use client";

import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BedDouble, CalendarDays, Check, ChevronDown, CircleAlert, FileText,
  ExternalLink, Hotel, LoaderCircle, MapPin, Plus, Save, Send,
  ShieldCheck, Sparkles, Trash2, X,
} from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { TravelProgrammeDraft } from "@/lib/platform/import-schema";
import type { PlatformImportReview } from "@/lib/platform/types";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";

const activityTypes = [
  ["visit", "Visita"], ["transport", "Trasferimento"], ["flight", "Volo"],
  ["train", "Treno"], ["hotel", "Hotel"], ["meal", "Pasto"],
  ["free_time", "Tempo libero"], ["meeting", "Incontro"], ["other", "Altro"],
] as const;

const timedActivityTypes = new Set<TravelProgrammeDraft["days"][number]["activities"][number]["type"]>([
  "transport", "flight", "train", "meal", "meeting",
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
  return draft.days.reduce((total, day) => total + dayValidationCount(day), 0);
}

function dayValidationCount(day: TravelProgrammeDraft["days"][number]) {
  return Number(!day.country.trim() || day.countryValidation.needsValidation)
    + Number(!day.city.trim() || day.cityValidation.needsValidation)
    + day.activities.filter((activity) => activity.type === "visit").reduce((subtotal, activity) => subtotal + Number(
      !activity.placeName.trim() || !activity.placeCity.trim() || !activity.placeCountry.trim() || activity.placeValidation.needsValidation
    ), 0)
    + [day.accommodation, ...day.additionalAccommodations].reduce((subtotal, accommodation) => subtotal + Number(
      Boolean(accommodation.name.trim()) && (
        !accommodation.city.trim() || !accommodation.country.trim() || accommodation.validation.needsValidation
      )
    ), 0);
}

type Accommodation = TravelProgrammeDraft["days"][number]["accommodation"];

function emptyAccommodation(): Accommodation {
  return { name: "", city: "", country: "", notes: "", validation: changedValidation("Hotel") };
}

export default function ImportReview({ initialImport, agencyPrimaryColor }: { initialImport: PlatformImportReview; agencyPrimaryColor: string }) {
  const [draft, setDraft] = useState(initialImport.draft);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(initialImport.errorMessage ?? "");
  const [notice, setNotice] = useState("");
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<"publish" | "delete" | null>(null);
  const savedSignatureRef = useRef(JSON.stringify(initialImport.draft));
  const navigatingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const draftSignature = useMemo(() => JSON.stringify(draft), [draft]);
  const isDirty = draftSignature !== savedSignatureRef.current;
  const validationsPending = useMemo(() => draft ? pendingValidationCount(draft) : 0, [draft]);
  const brand = validBrandColor(agencyPrimaryColor);
  const brandStyle = {
    "--agency-ui": brand, "--agency-ui-ink": "#111111", "--smf-brand": brand,
    "--smf-brand-deep": accessibleBrandColor(agencyPrimaryColor), "--smf-action": brand,
    "--teal": brand, "--on-brand": "#111111",
  } as CSSProperties;

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

  function updateCommercial(changes: Partial<TravelProgrammeDraft["commercialDetails"]>) {
    if (!draft) return;
    setDraft({ ...draft, commercialDetails: { ...draft.commercialDetails, ...changes } });
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

  function removeDay(dayIndex: number) {
    if (!draft) return;
    const days = draft.days.filter((_, position) => position !== dayIndex);
    setDraft({ ...draft, days });
    setActiveDayIndex((current) => Math.max(0, Math.min(current, days.length - 1)));
  }

  function updateAccommodation(dayIndex: number, accommodationIndex: number, changes: Partial<Accommodation>) {
    if (!draft) return;
    const day = draft.days[dayIndex];
    if (accommodationIndex === 0) {
      updateDay(dayIndex, { accommodation: { ...day.accommodation, ...changes } });
      return;
    }
    updateDay(dayIndex, {
      additionalAccommodations: day.additionalAccommodations.map((item, index) =>
        index === accommodationIndex - 1 ? { ...item, ...changes } : item
      ),
    });
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
    return <main className="reviewPage" style={brandStyle}><section className="reviewUnavailable"><CircleAlert/><h1>Bozza non disponibile</h1><p>Stato: {initialImport.status}. Avvia o riprova l’elaborazione dal pannello.</p><a href="/agenzia"><ArrowLeft/> Torna al pannello</a></section></main>;
  }

  return (
    <main className="reviewPage" style={brandStyle}>
      <header className="reviewTopbar">
        <a href="/agenzia"><ArrowLeft size={17}/> Pannello</a>
        <div><FileText size={18}/><span><small>REVISIONE PROGRAMMA</small><b>{initialImport.normalizedFileName ?? initialImport.sourceFileName}</b></span></div>
        <span className={isDirty ? "reviewSaveState dirty" : "reviewSaveState"} role="status">{isDirty ? "Modifiche da salvare" : "Tutto salvato"}</span>
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

        <details className="commercialReview" open>
          <summary><div><small>DATI DEL PREVENTIVO</small><b>Quotazione, servizi e condizioni</b></div><ChevronDown/></summary>
          <div className="commercialFields">
            <label>Nome agenzia<input value={draft.commercialDetails.agencyName} onChange={(event) => updateCommercial({ agencyName: event.target.value })}/></label>
            <label>Contatti agenzia<input value={draft.commercialDetails.agencyContact} onChange={(event) => updateCommercial({ agencyContact: event.target.value })}/></label>
            <label>Codice preventivo<input value={draft.commercialDetails.quoteCode} onChange={(event) => updateCommercial({ quoteCode: event.target.value })}/></label>
            <label>Versione<input value={draft.commercialDetails.quoteVersion} onChange={(event) => updateCommercial({ quoteVersion: event.target.value })}/></label>
            <label>Data preventivo<input type="date" value={draft.commercialDetails.quoteDate} onChange={(event) => updateCommercial({ quoteDate: event.target.value })}/></label>
            <label>Cliente / gruppo<input value={draft.commercialDetails.clientName} onChange={(event) => updateCommercial({ clientName: event.target.value })}/></label>
            <label>Numero viaggiatori<input type="number" min="0" value={draft.commercialDetails.travelerCount ?? ""} onChange={(event) => updateCommercial({ travelerCount: event.target.value ? Number(event.target.value) : null })}/></label>
            <label>Lingua guida<input value={draft.commercialDetails.guideLanguage} onChange={(event) => updateCommercial({ guideLanguage: event.target.value })}/></label>
            <label>Valuta<input value={draft.commercialDetails.currency} onChange={(event) => updateCommercial({ currency: event.target.value })}/></label>
          </div>
          <div className="commercialRows">
            <div className="subheading"><b>Quotazione</b><button type="button" onClick={() => updateCommercial({ pricingRows: [...draft.commercialDetails.pricingRows, { item: "", amount: "", currency: draft.commercialDetails.currency, notes: "" }] })}><Plus/> Aggiungi voce</button></div>
            {draft.commercialDetails.pricingRows.map((row, index) => <div className="commercialRow price" key={index}><input aria-label="Voce" placeholder="Voce" value={row.item} onChange={(event) => updateCommercial({ pricingRows: draft.commercialDetails.pricingRows.map((item, position) => position === index ? { ...item, item: event.target.value } : item) })}/><input aria-label="Importo" placeholder="Importo" value={row.amount} onChange={(event) => updateCommercial({ pricingRows: draft.commercialDetails.pricingRows.map((item, position) => position === index ? { ...item, amount: event.target.value } : item) })}/><input aria-label="Valuta" placeholder="Valuta" value={row.currency} onChange={(event) => updateCommercial({ pricingRows: draft.commercialDetails.pricingRows.map((item, position) => position === index ? { ...item, currency: event.target.value } : item) })}/><input aria-label="Note" placeholder="Note" value={row.notes} onChange={(event) => updateCommercial({ pricingRows: draft.commercialDetails.pricingRows.map((item, position) => position === index ? { ...item, notes: event.target.value } : item) })}/><button type="button" aria-label="Rimuovi voce" onClick={() => updateCommercial({ pricingRows: draft.commercialDetails.pricingRows.filter((_, position) => position !== index) })}><Trash2/></button></div>)}
            <div className="subheading"><b>Servizi inclusi e non inclusi</b><button type="button" onClick={() => updateCommercial({ includedServices: [...draft.commercialDetails.includedServices, { service: "", included: true, details: "" }] })}><Plus/> Aggiungi servizio</button></div>
            {draft.commercialDetails.includedServices.map((row, index) => <div className="commercialRow service" key={index}><input aria-label="Servizio" placeholder="Servizio" value={row.service} onChange={(event) => updateCommercial({ includedServices: draft.commercialDetails.includedServices.map((item, position) => position === index ? { ...item, service: event.target.value } : item) })}/><select aria-label="Inclusione" value={row.included ? "yes" : "no"} onChange={(event) => updateCommercial({ includedServices: draft.commercialDetails.includedServices.map((item, position) => position === index ? { ...item, included: event.target.value === "yes" } : item) })}><option value="yes">Incluso</option><option value="no">Non incluso</option></select><input aria-label="Dettagli servizio" placeholder="Dettagli" value={row.details} onChange={(event) => updateCommercial({ includedServices: draft.commercialDetails.includedServices.map((item, position) => position === index ? { ...item, details: event.target.value } : item) })}/><button type="button" aria-label="Rimuovi servizio" onClick={() => updateCommercial({ includedServices: draft.commercialDetails.includedServices.filter((_, position) => position !== index) })}><Trash2/></button></div>)}
            <div className="subheading"><b>Condizioni e note</b><button type="button" onClick={() => updateCommercial({ conditions: [...draft.commercialDetails.conditions, { field: "", value: "" }] })}><Plus/> Aggiungi condizione</button></div>
            {draft.commercialDetails.conditions.map((row, index) => <div className="commercialRow condition" key={index}><input aria-label="Campo condizione" placeholder="Campo" value={row.field} onChange={(event) => updateCommercial({ conditions: draft.commercialDetails.conditions.map((item, position) => position === index ? { ...item, field: event.target.value } : item) })}/><textarea aria-label="Valore condizione" placeholder="Testo" value={row.value} onChange={(event) => updateCommercial({ conditions: draft.commercialDetails.conditions.map((item, position) => position === index ? { ...item, value: event.target.value } : item) })}/><button type="button" aria-label="Rimuovi condizione" onClick={() => updateCommercial({ conditions: draft.commercialDetails.conditions.filter((_, position) => position !== index) })}><Trash2/></button></div>)}
          </div>
        </details>

        <div className="reviewHeading"><div><small>ITINERARIO ESTRATTO</small><h2>{draft.days.length} giornate</h2></div><span><CalendarDays/> Controlla una giornata alla volta</span></div>

        <div className="reviewItineraryWorkspace">
          <aside className="reviewDayNavigator" aria-label="Giornate del programma">
            <div className="reviewDayNavigatorHeading"><b>Giornate</b><span>{validationsPending ? `${validationsPending} verifiche` : "Tutto validato"}</span></div>
            <div className="reviewDayNavigatorList">
              {draft.days.map((day, dayIndex) => {
                const pending = dayValidationCount(day);
                return <button
                  key={`${day.dayNumber}-${dayIndex}`}
                  type="button"
                  className={activeDayIndex === dayIndex ? "active" : ""}
                  aria-current={activeDayIndex === dayIndex ? "step" : undefined}
                  onClick={() => setActiveDayIndex(dayIndex)}
                >
                  <span>{String(dayIndex + 1).padStart(2, "0")}</span>
                  <span><b>{day.title || "Senza titolo"}</b><small>{day.date || day.city || "Dati da completare"}</small></span>
                  <i className={pending ? "pending" : "valid"} aria-label={pending ? `${pending} verifiche da completare` : "Giornata validata"}>{pending || <Check/>}</i>
                </button>;
              })}
            </div>
          </aside>

          <section className="reviewDays">
          {draft.days.map((day, dayIndex) => activeDayIndex === dayIndex && (
            <article className="reviewDay" key={`${day.dayNumber}-${dayIndex}`}>
              <header><span>{String(dayIndex + 1).padStart(2, "0")}</span><div><small>GIORNO {dayIndex + 1} DI {draft.days.length}</small><b>{day.title || "Senza titolo"}</b></div>{draft.days.length > 1 && <button type="button" aria-label={`Rimuovi giornata ${dayIndex + 1}`} onClick={() => removeDay(dayIndex)}><Trash2/></button>}</header>
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

              <div className="accommodationEditors"><div className="subheading"><b>Pernottamenti</b><button type="button" onClick={() => updateDay(dayIndex, { additionalAccommodations: [...day.additionalAccommodations, emptyAccommodation()] })}><Plus/> Nuovo pernottamento</button></div>{[day.accommodation, ...day.additionalAccommodations].map((accommodation, accommodationIndex) => <div className="hotelEditor" key={accommodationIndex}><Hotel/><div><b>Pernottamento {accommodationIndex + 1}</b><span>{accommodationIndex === 0 ? "Lascia vuoto se non previsto" : "Sistemazione aggiuntiva nella giornata"}</span></div><label>Hotel<input value={accommodation.name} onChange={(event) => updateAccommodation(dayIndex, accommodationIndex, { name: event.target.value, validation: changedValidation("Hotel") })}/></label><label>Città<input value={accommodation.city} onChange={(event) => updateAccommodation(dayIndex, accommodationIndex, { city: event.target.value, validation: changedValidation("Località dell’hotel") })}/></label><label>Paese<input value={accommodation.country} onChange={(event) => updateAccommodation(dayIndex, accommodationIndex, { country: event.target.value, validation: changedValidation("Località dell’hotel") })}/></label>{accommodationIndex > 0 && <button type="button" className="removeAccommodation" aria-label={`Rimuovi pernottamento ${accommodationIndex + 1}`} onClick={() => updateDay(dayIndex, { additionalAccommodations: day.additionalAccommodations.filter((_, index) => index !== accommodationIndex - 1) })}><Trash2/></button>}{accommodation.name.trim() && <div className="hotelValidation"><ValidationControl validation={accommodation.validation} searchParts={[accommodation.name, accommodation.city, accommodation.country]} onChange={(validation) => updateAccommodation(dayIndex, accommodationIndex, { validation })}/></div>}</div>)}</div>
            </article>
          ))}
          {draft.days.length === 0 && <div className="reviewNoDays"><CalendarDays/><h3>Il programma non contiene giornate</h3><p>Elimina il viaggio e ricarica il preventivo per ricostruire correttamente l’itinerario.</p></div>}
          {draft.days.length > 1 && <nav className="reviewDayPager" aria-label="Navigazione tra giornate"><button type="button" disabled={activeDayIndex === 0} onClick={() => setActiveDayIndex((index) => Math.max(0, index - 1))}><ArrowLeft/> Giorno precedente</button><span>{activeDayIndex + 1} di {draft.days.length}</span><button type="button" disabled={activeDayIndex === draft.days.length - 1} onClick={() => setActiveDayIndex((index) => Math.min(draft.days.length - 1, index + 1))}>Giorno successivo <ArrowRight/></button></nav>}
          </section>
        </div>

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
