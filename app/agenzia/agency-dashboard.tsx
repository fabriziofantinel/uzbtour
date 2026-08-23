"use client";

import Link from "next/link";
import {
  Building2, CalendarDays, CheckCircle2, ChevronDown, CircleAlert,
  Eye, LayoutGrid, List, LoaderCircle, LogOut, MapPinned, Play, Plus, Sparkles, UploadCloud,
  Search, SlidersHorizontal, Trash2, UsersRound, X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { PlatformOverview } from "@/lib/platform/types";
import {
  TRAVEL_DOCUMENT_MAX_BYTES,
  travelDocumentType,
} from "@/lib/platform/travel-document";

type Props = { initialOverview: PlatformOverview };

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
  const [tripPeriod, setTripPeriod] = useState<"all" | "upcoming" | "ongoing" | "past">("all");
  const [tripView, setTripView] = useState<"cards" | "list">("cards");
  const [travelerFilter, setTravelerFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tripToDelete, setTripToDelete] = useState<{ id: string; title: string } | null>(null);
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
  const filteredTrips = useMemo(() => {
    const today = todayInRome();
    const traveler = travelerFilter.trim().toLocaleLowerCase("it");
    return (agency?.trips ?? []).filter((trip) => {
      const startDate = trip.startsOn ?? trip.departures[0]?.startsOn ?? null;
      const endDate = trip.endsOn ?? trip.departures[0]?.endsOn ?? null;
      const periodMatches = tripPeriod === "all" || (
        tripPeriod === "past" ? Boolean(endDate && endDate < today) :
        tripPeriod === "ongoing" ? Boolean(startDate && endDate && startDate <= today && endDate >= today) :
        !startDate || startDate > today
      );
      const peopleMatches = !traveler || trip.departures.some((departure) =>
        departure.travelerNames.some((name) => name.toLocaleLowerCase("it").includes(traveler))
      );
      return periodMatches && peopleMatches;
    });
  }, [agency, travelerFilter, tripPeriod]);
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

  async function refresh() {
    const result = await responseJson<PlatformOverview>(await fetch("/api/admin/platform/overview", {
      cache: "no-store",
    }));
    setOverview(result);
  }

  async function createTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agency) return;
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

  return (
    <main className="agencyPage">
      <header className="agencyTopbar">
        <Link className="agencyBrand" href="/">
          <span>SMF</span><div><strong>SMF Travel</strong><small>PANNELLO AGENZIA</small></div>
        </Link>
        <div className="agencyUser">
          <i>{overview.actor.name.slice(0, 2).toUpperCase()}</i>
          <span><small>{agency?.role === "editor" ? "Agente" : "Amministratore"}</small><b>{overview.actor.name}</b></span>
          <form action="/api/auth/logout" method="post"><button aria-label="Esci"><LogOut size={17}/></button></form>
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
          <label>Agenzia attiva</label>
          <div className="agencySelect">
            <Building2 size={18}/>
            <select value={agency?.id ?? ""} onChange={(event) => setSelectedAgencyId(event.target.value)}>
              {overview.agencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown size={15}/>
          </div>
          <nav>
            <a className="active" href="#viaggi"><MapPinned size={18}/> Viaggi</a>
          </nav>
        </aside>

        <section className="agencyContent">
          {error && <div className="agencyMessage error"><CircleAlert size={18}/>{error}</div>}
          {notice && <div className="agencyMessage success"><CheckCircle2 size={18}/>{notice}</div>}

          <div className="agencyStats">
            <article><MapPinned/><span><small>VIAGGI</small><b>{stats.trips}</b></span></article>
            <article><CalendarDays/><span><small>PARTENZE</small><b>{stats.departures}</b></span></article>
            <article><UsersRound/><span><small>FAMIGLIE</small><b>{stats.parties}</b></span></article>
          </div>

          <section id="viaggi" className="agencySection">
            <div className="agencySectionHead">
              <div><small>CATALOGO</small><h2>I viaggi dell’agenzia</h2></div>
              <button onClick={() => setShowNewTrip(true)}><Plus size={17}/> Nuovo viaggio</button>
            </div>

            {showNewTrip && (
              <form className="newTripForm" onSubmit={createTrip}>
                <div className="formIntro"><b>Importa il preventivo accettato</b><span>Il documento creerà testata, itinerario e anagrafiche condivise.</span></div>
                <label>Nome pratica (facoltativo)<input name="title" placeholder="Se vuoto useremo il nome del file"/></label>
                <label className="pdfField">Preventivo PDF, DOC o DOCX *<input name="programme" type="file" accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" required/></label>
                <div><button type="button" className="secondary" onClick={() => setShowNewTrip(false)}>Annulla</button><button disabled={busy === "new-trip"}>{busy === "new-trip" && <LoaderCircle className="spin"/>} Crea</button></div>
              </form>
            )}

            <div className="tripFilters">
              <span><SlidersHorizontal/> Stato</span>
              <button aria-pressed={tripPeriod === "upcoming"} className={tripPeriod === "upcoming" ? "active" : ""} onClick={() => setTripPeriod("upcoming")}>Da fare</button>
              <button aria-pressed={tripPeriod === "ongoing"} className={tripPeriod === "ongoing" ? "active" : ""} onClick={() => setTripPeriod("ongoing")}>In corso</button>
              <button aria-pressed={tripPeriod === "past"} className={tripPeriod === "past" ? "active" : ""} onClick={() => setTripPeriod("past")}>Fatti</button>
              <button aria-pressed={tripPeriod === "all"} className={tripPeriod === "all" ? "active" : ""} onClick={() => setTripPeriod("all")}>Tutti</button>
              <label><Search/><input value={travelerFilter} onChange={(event) => setTravelerFilter(event.target.value)} placeholder="Cerca viaggiatore…"/></label>
              <div className="tripViewToggle" aria-label="Visualizzazione viaggi">
                <button aria-pressed={tripView === "cards"} className={tripView === "cards" ? "active" : ""} onClick={() => setTripView("cards")} aria-label="Visualizzazione a schede" title="Schede"><LayoutGrid/></button>
                <button aria-pressed={tripView === "list"} className={tripView === "list" ? "active" : ""} onClick={() => setTripView("list")} aria-label="Visualizzazione a lista" title="Lista"><List/></button>
              </div>
            </div>

            <div className={`tripAdminGrid ${tripView}`}>
              {filteredTrips.map((trip) => {
                const latestImport = latestImportByTrip.get(trip.id);
                const importIsActive = latestImport ? activeImportStatuses.has(latestImport.status) : false;
                const content = trip.contentGeneration;
                const contentIsActive = content ? activeEnrichmentStatuses.has(content.status) : false;
                const contentIsComplete = Boolean(
                  content && content.status !== "failed" && content.expectedSections > 0 &&
                  content.readySections === content.expectedSections
                );
                const startsOn = trip.startsOn ?? trip.departures[0]?.startsOn ?? null;
                const endsOn = trip.endsOn ?? trip.departures[0]?.endsOn ?? null;
                const validationStatus = trip.status === "active" ? "validated" : "draft";
                return (
                <article className={importIsActive || contentIsActive ? "tripAdminCard generating" : "tripAdminCard"} key={trip.id}>
                  <div className="tripCardTop"><span className={`status ${validationStatus}`}>{validationStatus === "validated" ? "Validato" : "Bozza"}</span><MapPinned size={22}/></div>
                  <h3>{trip.title}</h3>
                  <p>{trip.destinationCountry || "Destinazione da revisionare"}</p>
                  <div className="tripDates">
                    <span><small>INIZIO</small><b>{formatTravelDate(startsOn)}</b></span>
                    <span><small>FINE</small><b>{formatTravelDate(endsOn)}</b></span>
                  </div>
                  <p>{trip.departures.flatMap((item) => item.travelerNames).join(", ") || "Nessun viaggiatore configurato"}</p>
                  {latestImport && (
                    <div className={`tripGeneration ${latestImport.status}`}>
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
                      {importIsActive && <i><span style={{ width: `${importProgress(latestImport.status)}%` }}/></i>}
                      {latestImport.status === "failed" && <button disabled={Boolean(busy)} onClick={() => void processImport(latestImport.id)}>{busy === `process-${latestImport.id}` ? <LoaderCircle className="spin"/> : <Play/>} Riprova</button>}
                      {latestImport.status === "ready_for_review" && <a href={`/agenzia/importazioni/${latestImport.id}`}><Eye/> Revisiona programma</a>}
                    </div>
                  )}
                  {content && (
                    <div className={`tripGeneration ${contentIsComplete ? "published" : content.status}`}>
                      <div>
                        {contentIsActive ? <LoaderCircle className="spin"/> : contentIsComplete ? <CheckCircle2/> : <CircleAlert/>}
                        <span>
                          <b>{contentIsActive ? "Generazione contenuti del viaggio" : contentIsComplete ? "Viaggio completo" : "Contenuti da completare"}</b>
                          <small>{content.readySections}/{content.expectedSections} sezioni pronte: info utili, frasario, bingo, quiz, missioni, giochi e contest.</small>
                          {content.status === "failed" && <small>{content.errorMessage || "La generazione AI non è riuscita."}</small>}
                          {content.contestTitles.length > 0 && <small title={content.contestTitles.join(" · ")}>Contest: {content.contestTitles.slice(0, 2).join(" · ")}{content.contestTitles.length > 2 ? ` e altri ${content.contestTitles.length - 2}` : ""}</small>}
                        </span>
                      </div>
                      {contentIsActive && content.expectedSections > 0 && <i><span style={{ width: `${Math.max(8, Math.round(content.readySections / content.expectedSections * 100))}%` }}/></i>}
                      {content.status === "failed" && <button disabled={Boolean(busy)} onClick={() => void retryEnrichment(trip.id)}>{busy === `enrichment-${trip.id}` ? <LoaderCircle className="spin"/> : <Play/>} Riprova contenuti</button>}
                    </div>
                  )}
                  {trip.departures[0] && <Link className="configureTravelers" href={`/agenzia/viaggi/${trip.departures[0].id}`}><UsersRound/> Configura famiglie e viaggiatori</Link>}
                  <label className={busy === `upload-${trip.id}` ? "uploadAction busy" : "uploadAction"}>
                    {busy === `upload-${trip.id}` ? <LoaderCircle className="spin"/> : <UploadCloud/>}
                    <span><b>{busy === `upload-${trip.id}` ? "Caricamento…" : "Carica programma"}</b><small>PDF, DOC o DOCX privato, massimo 4,5 MB</small></span>
                    <input type="file" accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" disabled={Boolean(busy)} onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadProgramme(trip.id, file);
                    }}/>
                  </label>
                  <button className="deleteTripButton" disabled={Boolean(busy)} onClick={() => setTripToDelete({ id: trip.id, title: trip.title })}><Trash2/> Elimina viaggio</button>
                </article>
              )})}
              {filteredTrips.length === 0 && <div className="agencyEmpty"><MapPinned/><h3>Nessun viaggio</h3><p>Nessun risultato per i filtri selezionati.</p></div>}
            </div>
          </section>

        </section>
      </div>
      {tripToDelete && (
        <div className="deleteTripBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setTripToDelete(null);
        }}>
          <section className="deleteTripDialog" role="dialog" aria-modal="true" aria-labelledby="delete-trip-title">
            <button className="deleteTripClose" aria-label="Chiudi" disabled={Boolean(busy)} onClick={() => setTripToDelete(null)}><X/></button>
            <i><Trash2/></i>
            <small>OPERAZIONE DEFINITIVA</small>
            <h2 id="delete-trip-title">Eliminare “{tripToDelete.title}”?</h2>
            <p>Verranno eliminati programma, importazioni, partenze, famiglie e file collegati. Le anagrafiche condivise e gli utenti resteranno disponibili.</p>
            <div>
              <button className="secondary" disabled={Boolean(busy)} onClick={() => setTripToDelete(null)}>Annulla</button>
              <button className="danger" disabled={Boolean(busy)} onClick={() => void deleteTrip()}>{busy === `delete-${tripToDelete.id}` ? <LoaderCircle className="spin"/> : <Trash2/>} Elimina definitivamente</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
