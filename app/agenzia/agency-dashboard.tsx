"use client";

import Link from "next/link";
import {
  Accessibility, Building2, CalendarDays, CheckCircle2, ChevronDown, CircleAlert,
  BookOpen, Download, Eye, FileCheck2, LayoutGrid, List, LoaderCircle, LogOut, MapPinned, Play, Plus, Sparkles,
  Search, SlidersHorizontal, Trash2, UsersRound, X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PlatformOverview } from "@/lib/platform/types";
import {
  TRAVEL_DOCUMENT_MAX_BYTES,
  travelDocumentType,
} from "@/lib/platform/travel-document";

type Props = { initialOverview: PlatformOverview };
type AgencyTrip = PlatformOverview["agencies"][number]["trips"][number];
type AgencyDeparture = AgencyTrip["departures"][number];
type TripRow = { trip: AgencyTrip; departure: AgencyDeparture | null };

type UploadAuthorization = {
  key: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

const statusLabels: Record<string, string> = {
  draft: "Bozza",
  active: "Attivo",
  archived: "Archiviato",
  uploaded: "Caricato",
  queued: "In coda",
  extracting: "Lettura documento",
  generating: "Generazione contenuti",
  ready_for_review: "Da revisionare",
  published: "Pubblicato",
  failed: "Errore",
  open: "Aperto",
  confirmed: "Confermato",
  in_progress: "In corso",
  completed: "Concluso",
  cancelled: "Annullato",
};

const activeImportStatuses = new Set(["queued", "extracting", "generating"]);
const activeEnrichmentStatuses = new Set(["queued", "processing"]);

function importProgress(status: string) {
  if (status === "queued") return 15;
  if (status === "extracting") return 45;
  if (status === "generating") return 75;
  return 100;
}

function todayInRome() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function formatTravelDate(value: string | null) {
  if (!value) return "Da definire";
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

async function responseJson<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
  return result;
}

export default function AgencyDashboard({ initialOverview }: Props) {
  const [overview, setOverview] = useState(initialOverview);
  const [selectedAgencyId, setSelectedAgencyId] = useState(initialOverview.agencies[0]?.id ?? "");
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [selectedProgrammeName, setSelectedProgrammeName] = useState("");
  const [tripPeriod, setTripPeriod] = useState<"all" | "upcoming" | "ongoing" | "past">("all");
  const [tripView, setTripView] = useState<"list" | "cards">("list");
  const [tripSort, setTripSort] = useState<"date-asc" | "date-desc" | "name">("date-asc");
  const [travelerFilter, setTravelerFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [departureError, setDepartureError] = useState("");
  const [tripToDelete, setTripToDelete] = useState<{ id: string; title: string } | null>(null);
  const [departureForTrip, setDepartureForTrip] = useState<{ id: string; title: string } | null>(null);
  const deleteCloseRef = useRef<HTMLButtonElement>(null);
  const departureCloseRef = useRef<HTMLButtonElement>(null);
  const agency = overview.agencies.find((candidate) => candidate.id === selectedAgencyId)
    ?? overview.agencies[0];

  const stats = useMemo(() => ({
    trips: agency?.trips.length ?? 0,
    departures: agency?.trips.reduce((sum, trip) => sum + trip.departures.length, 0) ?? 0,
    parties: agency?.trips.reduce(
      (sum, trip) => sum + trip.departures.reduce((subtotal, departure) => subtotal + departure.partyCount, 0),
      0
    ) ?? 0,
  }), [agency]);
  const latestImportByTrip = useMemo(() => {
    const imports = new Map<string, PlatformOverview["recentImports"][number]>();
    for (const item of overview.recentImports) {
      if (item.agencyId === agency?.id && !imports.has(item.templateId)) imports.set(item.templateId, item);
    }
    return imports;
  }, [agency?.id, overview.recentImports]);
  const allDepartures = useMemo(() => {
    const rows: TripRow[] = [];
    for (const trip of agency?.trips ?? []) {
      if (trip.departures.length === 0) rows.push({ trip, departure: null });
      else for (const departure of trip.departures) rows.push({ trip, departure });
    }
    return rows;
  }, [agency]);
  const tripPeriodCounts = useMemo(() => {
    const today = todayInRome();
    return allDepartures.reduce((counts, { trip, departure }) => {
      const startDate = departure?.startsOn ?? trip.startsOn;
      const endDate = departure?.endsOn ?? trip.endsOn;
      counts.all += 1;
      if (endDate && endDate < today) counts.past += 1;
      else if (startDate && endDate && startDate <= today && endDate >= today) counts.ongoing += 1;
      else counts.upcoming += 1;
      return counts;
    }, { all: 0, upcoming: 0, ongoing: 0, past: 0 });
  }, [allDepartures]);
  const filteredDepartures = useMemo(() => {
    const today = todayInRome();
    const query = travelerFilter.trim().toLocaleLowerCase("it");
    const rows = allDepartures.filter(({ trip, departure }) => {
      const startDate = departure?.startsOn ?? trip.startsOn;
      const endDate = departure?.endsOn ?? trip.endsOn;
      const periodMatches = tripPeriod === "all" || (
        tripPeriod === "past" ? Boolean(endDate && endDate < today) :
        tripPeriod === "ongoing" ? Boolean(startDate && endDate && startDate <= today && endDate >= today) :
        !endDate || endDate >= today && !(startDate && startDate <= today && endDate && endDate >= today)
      );
      const searchable = [trip.title, trip.destinationCountry, departure?.title, ...(departure?.travelerNames ?? [])]
        .filter(Boolean).join(" ").toLocaleLowerCase("it");
      return periodMatches && (!query || searchable.includes(query));
    });
    return rows.sort((left, right) => {
      if (tripSort === "name") return (left.departure?.title || left.trip.title).localeCompare(
        right.departure?.title || right.trip.title, "it", { sensitivity: "base" }
      );
      const leftDate = left.departure?.startsOn ?? left.trip.startsOn ?? "9999-12-31";
      const rightDate = right.departure?.startsOn ?? right.trip.startsOn ?? "9999-12-31";
      return tripSort === "date-desc" ? rightDate.localeCompare(leftDate) : leftDate.localeCompare(rightDate);
    });
  }, [allDepartures, travelerFilter, tripPeriod, tripSort]);
  const activeImportKey = overview.recentImports
    .filter((item) => activeImportStatuses.has(item.status))
    .map((item) => `${item.id}:${item.status}`)
    .join("|");
  const activeEnrichmentKey = overview.agencies
    .flatMap((item) => item.trips)
    .filter((trip) => trip.contentGeneration && activeEnrichmentStatuses.has(trip.contentGeneration.status))
    .map((trip) => `${trip.id}:${trip.contentGeneration?.status}:${trip.contentGeneration?.readySections}`)
    .join("|");
  const activeGenerationKey = `${activeImportKey}|${activeEnrichmentKey}`;

  useEffect(() => {
    const savedView = window.localStorage.getItem("smf-agency-trip-view");
    if (savedView === "list" || savedView === "cards") setTripView(savedView);
  }, []);

  useEffect(() => {
    if (!activeGenerationKey) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/admin/platform/overview", { cache: "no-store" });
        const result = await responseJson<PlatformOverview>(response);
        if (!cancelled) setOverview(result);
      } catch {
        // Il prossimo polling riproverà senza interrompere l'elaborazione in corso.
      }
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeGenerationKey]);

  useEffect(() => {
    if (tripToDelete) deleteCloseRef.current?.focus();
    if (departureForTrip) departureCloseRef.current?.focus();
  }, [departureForTrip, tripToDelete]);

  useEffect(() => {
    if (!tripToDelete && !departureForTrip) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      setTripToDelete(null);
      setDepartureForTrip(null);
      setDepartureError("");
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, departureForTrip, tripToDelete]);

  async function refresh() {
    const result = await responseJson<PlatformOverview>(await fetch("/api/admin/platform/overview", {
      cache: "no-store",
    }));
    setOverview(result);
  }

  async function createTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agency) return;
    const formElement = event.currentTarget;
    setBusy("new-trip");
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const file = form.get("programme");
    if (!(file instanceof File) || file.size === 0) {
      setError("Seleziona il preventivo accettato dal cliente in formato PDF, DOC o DOCX."); setBusy(""); return;
    }
    if (!travelDocumentType(file.name)) {
      setError("Il preventivo deve essere in formato PDF, DOC o DOCX."); setBusy(""); return;
    }
    if (file.size > TRAVEL_DOCUMENT_MAX_BYTES) {
      setError("Il documento supera il limite di 4,5 MB."); setBusy(""); return;
    }
    try {
      const title = String(form.get("title") || "").trim() || file.name.replace(/\.(pdf|docx?)$/i, "");
      const created = await responseJson<{ trip: { id: string } }>(await fetch("/api/admin/platform/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyId: agency.id,
          title,
          destinationCountry: "",
          timezone: "Europe/Rome",
        }),
      }));
      await uploadProgramme(created.trip.id, file);
      formElement.reset();
      setSelectedProgrammeName("");
      setShowNewTrip(false);
      setNotice("Viaggio creato e documento accodato per l’analisi.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creazione non riuscita");
    } finally {
      setBusy("");
    }
  }

  async function uploadProgramme(templateId: string, file: File) {
    if (!agency) return;
    const documentType = travelDocumentType(file.name);
    if (!documentType) {
      setError("Seleziona un documento PDF, DOC o DOCX.");
      return;
    }
    if (file.size > TRAVEL_DOCUMENT_MAX_BYTES) {
      setError("Il documento supera il limite di 4,5 MB.");
      return;
    }

    setBusy(`upload-${templateId}`);
    setError("");
    setNotice("");
    try {
      const authorization = await responseJson<UploadAuthorization>(await fetch(
        "/api/admin/platform/documents/upload",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agencyId: agency.id,
            templateId,
            originalName: file.name,
            contentType: documentType.contentType,
            sizeBytes: file.size,
          }),
        }
      ));
      const uploaded = await fetch(authorization.url, {
        method: authorization.method,
        headers: authorization.headers,
        body: file,
      });
      if (!uploaded.ok) {
        throw new Error(
          uploaded.status === 403
            ? "R2 ha rifiutato il caricamento. Controlla CORS o riprova con un nuovo URL."
            : "Caricamento del documento su R2 non riuscito."
        );
      }
      await responseJson(await fetch("/api/admin/platform/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyId: agency.id,
          templateId,
          originalName: file.name,
          objectKey: authorization.key,
        }),
      }));
      await refresh();
      setNotice(`${documentType.extension.toUpperCase()} caricato e importazione accodata.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Caricamento non riuscito");
    } finally {
      setBusy("");
    }
  }

  async function processImport(importId: string) {
    setBusy(`process-${importId}`);
    setError("");
    setNotice("");
    try {
      const result = await responseJson<{ import: { status: string; days?: number } }>(await fetch(
        `/api/admin/platform/imports/${importId}/process`,
        { method: "POST" }
      ));
      await refresh();
      setNotice(result.import.days
        ? `Documento elaborato: ${result.import.days} giornate pronte per la revisione.`
        : "Nuovo tentativo accodato. Lo stato si aggiornerà automaticamente.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Elaborazione non riuscita");
      await refresh().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  async function retryEnrichment(templateId: string) {
    setBusy(`enrichment-${templateId}`);
    setError("");
    setNotice("");
    try {
      await responseJson(await fetch(`/api/admin/platform/trips/${templateId}/enrichment`, {
        method: "POST",
      }));
      await refresh();
      setNotice("Nuovo tentativo di generazione dei contenuti accodato.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Generazione dei contenuti non riuscita");
    } finally {
      setBusy("");
    }
  }

  async function deleteTrip() {
    if (!tripToDelete) return;
    setBusy(`delete-${tripToDelete.id}`);
    setError("");
    setNotice("");
    try {
      await responseJson<{ ok: true; deletedFiles: number }>(await fetch(
        `/api/admin/platform/trips/${tripToDelete.id}`,
        { method: "DELETE" }
      ));
      const deletedTitle = tripToDelete.title;
      setTripToDelete(null);
      await refresh();
      setNotice(`Il viaggio “${deletedTitle}” è stato eliminato.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Eliminazione non riuscita");
    } finally {
      setBusy("");
    }
  }

  async function createDeparture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!departureForTrip) return;
    const form = new FormData(event.currentTarget);
    const startsOn = String(form.get("startsOn") || "");
    const endsOn = String(form.get("endsOn") || "");
    if (startsOn && endsOn && endsOn < startsOn) {
      setDepartureError("La data di rientro deve essere uguale o successiva alla data di partenza.");
      return;
    }
    setBusy(`departure-${departureForTrip.id}`); setError(""); setDepartureError(""); setNotice("");
    try {
      await responseJson(await fetch(`/api/admin/platform/trips/${departureForTrip.id}/departures`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") || ""), startsOn, endsOn,
        }),
      }));
      setDepartureForTrip(null); await refresh();
      setNotice("Nuova partenza creata sullo stesso programma e sugli stessi contenuti.");
    } catch (caught) {
      setDepartureError(caught instanceof Error ? caught.message : "Creazione della partenza non riuscita");
    } finally { setBusy(""); }
  }

  function selectTripView(view: "list" | "cards") {
    setTripView(view);
    window.localStorage.setItem("smf-agency-trip-view", view);
  }

  function openDeparture(id: string, title: string) {
    setDepartureError("");
    setDepartureForTrip({ id, title });
  }

  function clearTripFilters() {
    setTripPeriod("all");
    setTravelerFilter("");
  }

  return (
    <main className="agencyPage">
      <a className="agidSkipLink" href="#main-content">Salta all’elenco dei viaggi</a>
      <header className="agencyTopbar">
        <Link className="agencyBrand" href="/">
          <span>SMF</span><div><strong>SMF Travel</strong><small>PANNELLO AGENZIA</small></div>
        </Link>
        <div className="agencyUser">
          <i>{overview.actor.name.slice(0, 2).toUpperCase()}</i>
          <span><small>{agency?.role === "editor" ? "Agente" : "Amministratore"}</small><b>{overview.actor.name}</b></span>
          <form action="/api/auth/logout" method="post"><button type="submit" aria-label="Esci"><LogOut size={17}/></button></form>
        </div>
      </header>

      <section className="agencyHero">
        <div>
          <p><Sparkles size={15}/> PIATTAFORMA VIAGGI</p>
          <h1>Buongiorno, {overview.actor.name}.</h1>
          <span>Configura programmi, partenze e famiglie da un unico spazio.</span>
        </div>
      </section>

      <div className="agencyShell">
        <aside className="agencySidebar">
          <label htmlFor="active-agency">Agenzia attiva</label>
          <div className="agencySelect">
            <Building2 size={18}/>
            <select id="active-agency" value={agency?.id ?? ""} onChange={(event) => setSelectedAgencyId(event.target.value)}>
              {overview.agencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown size={15}/>
          </div>
          <nav>
            <a className="active" href="#viaggi"><MapPinned size={18}/> Viaggi</a>
            <Link href="/accessibilita"><Accessibility size={18}/> Accessibilità</Link>
          </nav>
        </aside>

        <section id="main-content" className="agencyContent" tabIndex={-1}>
          {error && <div className="agencyMessage error" role="alert"><CircleAlert size={18}/><span>{error}</span></div>}
          {notice && <div className="agencyMessage success" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}

          <div className="agencyStats">
            <article><MapPinned/><span><small>VIAGGI</small><b>{stats.trips}</b></span></article>
            <article><CalendarDays/><span><small>PARTENZE</small><b>{stats.departures}</b></span></article>
            <article><UsersRound/><span><small>FAMIGLIE</small><b>{stats.parties}</b></span></article>
          </div>

          <section id="viaggi" className="agencySection">
            <div className="agencySectionHead">
              <div><small>CATALOGO</small><h2>I viaggi dell’agenzia</h2></div>
              <div className="agencySectionActions">
                <div className="tripViewToggle" role="group" aria-label="Visualizzazione viaggi">
                  <button type="button" className={tripView === "list" ? "active" : ""} aria-label="Visualizza come lista" aria-pressed={tripView === "list"} onClick={() => selectTripView("list")}><List/></button>
                  <button type="button" className={tripView === "cards" ? "active" : ""} aria-label="Visualizza come schede" aria-pressed={tripView === "cards"} onClick={() => selectTripView("cards")}><LayoutGrid/></button>
                </div>
                <button type="button" className="newTripButton" aria-expanded={showNewTrip} aria-controls="new-trip-form" onClick={() => setShowNewTrip(true)}><Plus size={17}/> Nuovo viaggio</button>
              </div>
            </div>

            {showNewTrip && (
              <form id="new-trip-form" className="newTripForm" onSubmit={createTrip} aria-busy={busy === "new-trip"}>
                <div className="formIntro"><b>Crea il viaggio dal preventivo</b><span>Carica il documento accettato dal cliente. L’app preparerà testata, itinerario e anagrafiche per la tua revisione.</span></div>
                <ol className="newTripWorkflow" aria-label="Fasi di creazione del viaggio">
                  <li><b>1</b><span><strong>Carica</strong><small>PDF, DOC o DOCX</small></span></li>
                  <li><b>2</b><span><strong>Attendi</strong><small>Estrazione automatica</small></span></li>
                  <li><b>3</b><span><strong>Revisiona</strong><small>Controllo prima di pubblicare</small></span></li>
                </ol>
                <div className="quoteTemplate">
                  <Download/>
                  <span><b>Modello preventivo SMF Travel</b><small>Usalo per ridurre gli errori di interpretazione.</small></span>
                  <a href="/templates/modello-preventivo-smf-travel.docx" download>Scarica DOCX</a>
                </div>
                <div className="newTripFields">
                  <label htmlFor="trip-title">Nome pratica <span>(facoltativo)</span><input id="trip-title" name="title" maxLength={160} autoComplete="off" placeholder="Se vuoto useremo il nome del file"/></label>
                  <label className={`quoteUploadField ${selectedProgrammeName ? "selected" : ""}`} htmlFor="trip-programme">
                    <input id="trip-programme" name="programme" type="file" aria-describedby="trip-programme-help" accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" required onChange={(event) => setSelectedProgrammeName(event.target.files?.[0]?.name ?? "")}/>
                    <span className="quoteUploadIcon">{selectedProgrammeName ? <FileCheck2/> : <Plus/>}</span>
                    <span><b>{selectedProgrammeName || "Seleziona il preventivo"}</b><small id="trip-programme-help">PDF, DOC o DOCX · massimo 4,5 MB</small></span>
                    <strong>{selectedProgrammeName ? "Cambia file" : "Scegli file"}</strong>
                  </label>
                  <p>Il file originale sarà conservato nei documenti privati del viaggio.</p>
                </div>
                <div className="newTripActions"><button type="button" className="secondary" disabled={busy === "new-trip"} onClick={() => { setShowNewTrip(false); setSelectedProgrammeName(""); }}>Annulla</button><button type="submit" disabled={busy === "new-trip"}>{busy === "new-trip" ? <><LoaderCircle className="spin"/> Creazione…</> : <>Crea e avvia analisi</>}</button></div>
              </form>
            )}

            <div className="tripFilters" role="group" aria-label="Filtra i viaggi">
              <span><SlidersHorizontal/> Stato</span>
              <button type="button" aria-pressed={tripPeriod === "all"} className={tripPeriod === "all" ? "active" : ""} onClick={() => setTripPeriod("all")}>Tutti <b>{tripPeriodCounts.all}</b></button>
              <button type="button" aria-pressed={tripPeriod === "upcoming"} className={tripPeriod === "upcoming" ? "active" : ""} onClick={() => setTripPeriod("upcoming")}>Da fare <b>{tripPeriodCounts.upcoming}</b></button>
              <button type="button" aria-pressed={tripPeriod === "ongoing"} className={tripPeriod === "ongoing" ? "active" : ""} onClick={() => setTripPeriod("ongoing")}>In corso <b>{tripPeriodCounts.ongoing}</b></button>
              <button type="button" aria-pressed={tripPeriod === "past"} className={tripPeriod === "past" ? "active" : ""} onClick={() => setTripPeriod("past")}>Fatti <b>{tripPeriodCounts.past}</b></button>
              <div className="tripSearch"><Search/><label className="srOnly" htmlFor="traveler-filter">Cerca viaggio, destinazione o viaggiatore</label><input id="traveler-filter" type="search" value={travelerFilter} onChange={(event) => setTravelerFilter(event.target.value)} placeholder="Cerca viaggio o viaggiatore…"/>{travelerFilter && <button type="button" className="clearTripSearch" aria-label="Cancella ricerca" onClick={() => setTravelerFilter("")}><X/></button>}</div>
            </div>
            <div className="tripListTools">
              <p className="tripResultCount" aria-live="polite">{filteredDepartures.length} {filteredDepartures.length === 1 ? "viaggio visualizzato" : "viaggi visualizzati"}</p>
              {(tripPeriod !== "all" || travelerFilter) && <button type="button" className="clearAllTripFilters" onClick={clearTripFilters}><X/> Azzera filtri</button>}
              <label htmlFor="trip-sort">Ordina per<select id="trip-sort" value={tripSort} onChange={(event) => setTripSort(event.target.value as typeof tripSort)}><option value="date-asc">Partenza più vicina</option><option value="date-desc">Partenza più recente</option><option value="name">Nome viaggio</option></select><ChevronDown/></label>
            </div>

            {tripView === "list" && <div className="tripTableWrap">
              <table className="tripTable">
                <caption>Elenco viaggi e partenze dell’agenzia</caption>
                <thead><tr><th>Stato</th><th>Viaggio / preventivo</th><th>Partenza</th><th>Rientro</th><th>Famiglie</th><th>Viaggiatori</th><th>Contenuti</th><th>Azioni</th></tr></thead>
                <tbody>
              {filteredDepartures.map(({ trip, departure }) => {
                const latestImport = latestImportByTrip.get(trip.id);
                const importIsActive = latestImport ? activeImportStatuses.has(latestImport.status) : false;
                const content = trip.contentGeneration;
                const contentIsActive = content ? activeEnrichmentStatuses.has(content.status) : false;
                const contentIsComplete = Boolean(
                  content && content.status !== "failed" && content.expectedSections > 0 &&
                  content.readySections === content.expectedSections
                );
                const startsOn = departure?.startsOn ?? trip.startsOn;
                const endsOn = departure?.endsOn ?? trip.endsOn;
                const validationStatus = trip.status === "active" ? "validated" : "draft";
                return (
                <tr className={importIsActive || contentIsActive ? "generating" : ""} key={`${trip.id}-${departure?.id ?? "draft"}`}>
                  <td data-label="Stato"><span className={`status ${validationStatus}`}>{validationStatus === "validated" ? "Validato" : "Bozza"}</span><small className="departureStatus">{departure ? (statusLabels[departure.status] ?? departure.status) : "Senza partenza"}</small></td>
                  <td data-label="Viaggio" className="tripNameCell"><b>{departure?.title || trip.title}</b><span>{trip.destinationCountry || "Destinazione da revisionare"}</span><small>Programma: {trip.title}</small></td>
                  <td data-label="Partenza" className="dateCell">{formatTravelDate(startsOn)}</td>
                  <td data-label="Rientro" className="dateCell">{formatTravelDate(endsOn)}</td>
                  <td data-label="Famiglie" className="numberCell">{departure?.partyCount ?? 0}</td>
                  <td data-label="Viaggiatori" className="travelerCell">{departure?.travelerNames.join(", ") || "—"}</td>
                  <td data-label="Contenuti" className="contentCell">
                  {latestImport && (
                    <div className={`tripGeneration compact ${latestImport.status}`}>
                      <div>
                        {importIsActive ? <LoaderCircle className="spin"/> : latestImport.status === "failed" ? <CircleAlert/> : <CheckCircle2/>}
                        <span>
                          <b>{importIsActive ? "Viaggio in generazione" : statusLabels[latestImport.status] ?? latestImport.status}</b>
                          <small>{latestImport.status === "queued" && "Il preventivo è in attesa del worker."}</small>
                          <small>{latestImport.status === "extracting" && "Sto leggendo testo, date, tappe e alberghi."}</small>
                          <small>{latestImport.status === "generating" && "L’AI sta costruendo il programma da revisionare."}</small>
                          <small>{latestImport.status === "ready_for_review" && "Il programma estratto è pronto per il controllo."}</small>
                          <small>{latestImport.status === "failed" && "Analisi non riuscita. Il documento è salvo e puoi riprovare."}</small>
                          <small>{latestImport.status === "published" && "Programma revisionato e pubblicato."}</small>
                        </span>
                      </div>
                      {importIsActive && <i role="progressbar" aria-label="Avanzamento importazione" aria-valuemin={0} aria-valuemax={100} aria-valuenow={importProgress(latestImport.status)}><span style={{ width: `${importProgress(latestImport.status)}%` }}/></i>}
                      {latestImport.status === "failed" && <button type="button" disabled={Boolean(busy)} onClick={() => void processImport(latestImport.id)}>{busy === `process-${latestImport.id}` ? <LoaderCircle className="spin"/> : <Play/>} Riprova</button>}
                      {latestImport.status === "ready_for_review" && <a href={`/agenzia/importazioni/${latestImport.id}`}><Eye/> Revisiona</a>}
                    </div>
                  )}
                  {content && (
                    <div className={`tripGeneration compact ${contentIsComplete ? "published" : content.status}`}>
                      <div>
                        {contentIsActive ? <LoaderCircle className="spin"/> : contentIsComplete ? <CheckCircle2/> : <CircleAlert/>}
                        <span>
                          <b>{contentIsActive ? "Generazione contenuti del viaggio" : contentIsComplete ? "Viaggio completo" : "Contenuti da completare"}</b>
                          <small>{content.readySections}/{content.expectedSections} sezioni pronte: info utili, frasario, bingo, quiz, missioni, giochi e contest.</small>
                          {content.status === "failed" && <small>{content.errorMessage || "La generazione AI non è riuscita."}</small>}
                          {content.contestTitles.length > 0 && <small title={content.contestTitles.join(" · ")}>Contest: {content.contestTitles.slice(0, 2).join(" · ")}{content.contestTitles.length > 2 ? ` e altri ${content.contestTitles.length - 2}` : ""}</small>}
                        </span>
                      </div>
                      {contentIsActive && content.expectedSections > 0 && <i role="progressbar" aria-label="Avanzamento generazione contenuti" aria-valuemin={0} aria-valuemax={content.expectedSections} aria-valuenow={content.readySections}><span style={{ width: `${Math.max(8, Math.round(content.readySections / content.expectedSections * 100))}%` }}/></i>}
                      {content.status === "failed" && <button type="button" disabled={Boolean(busy)} onClick={() => void retryEnrichment(trip.id)}>{busy === `enrichment-${trip.id}` ? <LoaderCircle className="spin"/> : <Play/>} Riprova contenuti</button>}
                    </div>
                  )}
                  {!latestImport && !content && <span>—</span>}
                  </td>
                  <td data-label="Azioni"><div className="tableActions inline">
                    {departure && <Link className="primary" href={`/agenzia/viaggi/${departure.id}/programma`}><BookOpen/> Apri programma</Link>}
                    {departure && <Link href={`/agenzia/viaggi/${departure.id}`}><UsersRound/> Famiglie</Link>}
                    {trip.status === "active" && <button type="button" onClick={() => openDeparture(trip.id, trip.title)}><Plus/> Nuova partenza</button>}
                    <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => setTripToDelete({ id: trip.id, title: trip.title })}><Trash2/> Elimina</button>
                  </div></td>
                </tr>
              )})}
                </tbody>
              </table>
              {filteredDepartures.length === 0 && <div className="agencyEmpty"><MapPinned/><h3>{agency?.trips.length ? "Nessun risultato" : "Nessun viaggio ancora"}</h3><p>{agency?.trips.length ? "Modifica i filtri per visualizzare altri viaggi." : "Importa il primo preventivo accettato per creare il viaggio."}</p><button type="button" onClick={agency?.trips.length ? clearTripFilters : () => setShowNewTrip(true)}>{agency?.trips.length ? "Azzera filtri" : "Crea il primo viaggio"}</button></div>}
            </div>}

            {tripView === "cards" && <div className="tripAdminGrid cards">
              {filteredDepartures.map(({ trip, departure }) => {
                const latestImport = latestImportByTrip.get(trip.id);
                const importIsActive = latestImport ? activeImportStatuses.has(latestImport.status) : false;
                const content = trip.contentGeneration;
                const contentIsActive = content ? activeEnrichmentStatuses.has(content.status) : false;
                const contentIsComplete = Boolean(content && content.status !== "failed" && content.expectedSections > 0 && content.readySections === content.expectedSections);
                const startsOn = departure?.startsOn ?? trip.startsOn;
                const endsOn = departure?.endsOn ?? trip.endsOn;
                const validationStatus = trip.status === "active" ? "validated" : "draft";
                return (
                  <article className={`tripAdminCard journeyCard ${importIsActive || contentIsActive ? "generating" : ""}`} key={`${trip.id}-${departure?.id ?? "draft"}`}>
                    <div className="tripCardTop">
                      <span className={`status ${validationStatus}`}>{validationStatus === "validated" ? "Validato" : "Bozza"}</span>
                      <span className="journeyDepartureStatus">{departure ? (statusLabels[departure.status] ?? departure.status) : "Senza partenza"}</span>
                    </div>
                    <h3>{departure?.title || trip.title}</h3>
                    <p>{trip.destinationCountry || "Destinazione da revisionare"} · Programma: {trip.title}</p>
                    <div className="tripDates">
                      <span><small>PARTENZA</small><b>{formatTravelDate(startsOn)}</b></span>
                      <span><small>RIENTRO</small><b>{formatTravelDate(endsOn)}</b></span>
                    </div>
                    <div className="journeyCardFacts">
                      <span><UsersRound/><small>FAMIGLIE</small><b>{departure?.partyCount ?? 0}</b></span>
                      <span><UsersRound/><small>VIAGGIATORI</small><b>{departure?.travelerNames.length ?? 0}</b></span>
                    </div>
                    <div className="journeyTravelers"><small>PARTECIPANTI</small><p>{departure?.travelerNames.join(", ") || "Nessun viaggiatore configurato"}</p></div>
                    <div className="journeyCardGeneration">
                      {latestImport && <div className={`tripGeneration ${latestImport.status}`}>
                        <div>
                          {importIsActive ? <LoaderCircle className="spin"/> : latestImport.status === "failed" ? <CircleAlert/> : <CheckCircle2/>}
                          <span><b>{importIsActive ? "Viaggio in generazione" : statusLabels[latestImport.status] ?? latestImport.status}</b><small>{latestImport.status === "ready_for_review" ? "Il programma è pronto per il controllo." : latestImport.status === "failed" ? "Analisi non riuscita: puoi riprovare." : "Documento e itinerario acquisiti."}</small></span>
                        </div>
                        {importIsActive && <i role="progressbar" aria-label="Avanzamento importazione" aria-valuemin={0} aria-valuemax={100} aria-valuenow={importProgress(latestImport.status)}><span style={{ width: `${importProgress(latestImport.status)}%` }}/></i>}
                        {latestImport.status === "failed" && <button type="button" disabled={Boolean(busy)} onClick={() => void processImport(latestImport.id)}>{busy === `process-${latestImport.id}` ? <LoaderCircle className="spin"/> : <Play/>} Riprova</button>}
                        {latestImport.status === "ready_for_review" && <a href={`/agenzia/importazioni/${latestImport.id}`}><Eye/> Revisiona</a>}
                      </div>}
                      {content && <div className={`tripGeneration ${contentIsComplete ? "published" : content.status}`}>
                        <div>
                          {contentIsActive ? <LoaderCircle className="spin"/> : contentIsComplete ? <CheckCircle2/> : <CircleAlert/>}
                          <span><b>{contentIsActive ? "Generazione contenuti" : contentIsComplete ? "Contenuti completi" : "Contenuti da completare"}</b><small>{content.readySections}/{content.expectedSections} sezioni pronte tra info, frasi, quiz, missioni, giochi e contest.</small>{content.contestTitles.length > 0 && <small>Contest: {content.contestTitles.slice(0, 2).join(" · ")}</small>}</span>
                        </div>
                        {contentIsActive && content.expectedSections > 0 && <i role="progressbar" aria-label="Avanzamento generazione contenuti" aria-valuemin={0} aria-valuemax={content.expectedSections} aria-valuenow={content.readySections}><span style={{ width: `${Math.max(8, Math.round(content.readySections / content.expectedSections * 100))}%` }}/></i>}
                        {content.status === "failed" && <button type="button" disabled={Boolean(busy)} onClick={() => void retryEnrichment(trip.id)}>{busy === `enrichment-${trip.id}` ? <LoaderCircle className="spin"/> : <Play/>} Riprova contenuti</button>}
                      </div>}
                      {!latestImport && !content && <div className="journeyNoContent">Nessun contenuto generato</div>}
                    </div>
                    <div className="tableActions cardActions">
                      {departure && <Link className="primary" href={`/agenzia/viaggi/${departure.id}/programma`}><BookOpen/> Apri programma</Link>}
                      {departure && <Link href={`/agenzia/viaggi/${departure.id}`}><UsersRound/> Famiglie</Link>}
                      {trip.status === "active" && <button type="button" onClick={() => openDeparture(trip.id, trip.title)}><Plus/> Nuova partenza</button>}
                      <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => setTripToDelete({ id: trip.id, title: trip.title })}><Trash2/> Elimina</button>
                    </div>
                  </article>
                );
              })}
              {filteredDepartures.length === 0 && <div className="agencyEmpty"><MapPinned/><h3>{agency?.trips.length ? "Nessun risultato" : "Nessun viaggio ancora"}</h3><p>{agency?.trips.length ? "Modifica i filtri per visualizzare altri viaggi." : "Importa il primo preventivo accettato per creare il viaggio."}</p><button type="button" onClick={agency?.trips.length ? clearTripFilters : () => setShowNewTrip(true)}>{agency?.trips.length ? "Azzera filtri" : "Crea il primo viaggio"}</button></div>}
            </div>}
          </section>

        </section>
      </div>
      {tripToDelete && (
        <div className="deleteTripBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setTripToDelete(null);
        }}>
          <section className="deleteTripDialog" role="dialog" aria-modal="true" aria-labelledby="delete-trip-title">
            <button ref={deleteCloseRef} type="button" className="deleteTripClose" aria-label="Chiudi" disabled={Boolean(busy)} onClick={() => setTripToDelete(null)}><X/></button>
            <i><Trash2/></i>
            <small>OPERAZIONE DEFINITIVA</small>
            <h2 id="delete-trip-title">Eliminare “{tripToDelete.title}”?</h2>
            <p>Verranno eliminati programma, importazioni, partenze, famiglie e file collegati. Le anagrafiche condivise e gli utenti resteranno disponibili.</p>
            <div>
              <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => setTripToDelete(null)}>Annulla</button>
              <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void deleteTrip()}>{busy === `delete-${tripToDelete.id}` ? <><LoaderCircle className="spin"/> Eliminazione…</> : <><Trash2/> Elimina definitivamente</>}</button>
            </div>
          </section>
        </div>
      )}
      {departureForTrip && (
        <div className="deleteTripBackdrop" role="presentation">
          <form className="newDepartureDialog" role="dialog" aria-modal="true" aria-labelledby="new-departure-title" aria-describedby="new-departure-description" onSubmit={createDeparture}>
            <button ref={departureCloseRef} type="button" className="deleteTripClose" aria-label="Chiudi" disabled={Boolean(busy)} onClick={() => setDepartureForTrip(null)}><X/></button>
            <small>STESSO PROGRAMMA, NUOVE DATE</small><h2 id="new-departure-title">Nuova partenza</h2>
            <p id="new-departure-description">Itinerario, quiz, missioni, giochi e contest saranno gli stessi di “{departureForTrip.title}”. Famiglie e dati dei viaggiatori partiranno vuoti.</p>
            {departureError && <p className="dialogInlineError" role="alert"><CircleAlert/>{departureError}</p>}
            <label htmlFor="departure-title">Nome partenza<input id="departure-title" name="title" maxLength={160} autoComplete="off" placeholder={departureForTrip.title}/></label>
            <div><label htmlFor="departure-start">Data inizio<input id="departure-start" name="startsOn" type="date" required/></label><label htmlFor="departure-end">Data fine<input id="departure-end" name="endsOn" type="date" required/></label></div>
            <footer><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => setDepartureForTrip(null)}>Annulla</button><button type="submit" disabled={Boolean(busy)}>{busy === `departure-${departureForTrip.id}` ? <><LoaderCircle className="spin"/> Creazione…</> : <><Plus/> Crea partenza</>}</button></footer>
          </form>
        </div>
      )}
    </main>
  );
}
