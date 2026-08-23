"use client";

import Link from "next/link";
import {
  ArrowLeft, Building2, CalendarDays, CheckCircle2, ChevronDown, CircleAlert,
  Clock3, Eye, FileText, LoaderCircle, LogOut, MapPinned, Play, Plus, Sparkles, UploadCloud,
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

const agencyDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

const activeImportStatuses = new Set(["queued", "extracting", "generating"]);
const activeEnrichmentStatuses = new Set(["queued", "processing"]);

function importProgress(status: string) {
  if (status === "queued") return 15;
  if (status === "extracting") return 45;
  if (status === "generating") return 75;
  return 100;
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
  const [tripPeriod, setTripPeriod] = useState<"all" | "upcoming" | "past">("all");
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
  const filteredTrips = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const traveler = travelerFilter.trim().toLocaleLowerCase("it");
    return (agency?.trips ?? []).filter((trip) => {
      const endDate = trip.endsOn ?? trip.departures[0]?.endsOn ?? null;
      const periodMatches = tripPeriod === "all" || !endDate ||
        (tripPeriod === "past" ? endDate < today : endDate >= today);
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
        <Link href="/"><ArrowLeft size={16}/> Apri area viaggiatore</Link>
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
            <a href="#importazioni"><FileText size={18}/> Importazioni</a>
          </nav>
          <div className="providerCard">
            <small>CONFIGURAZIONE SISTEMA</small>
            <span>Database <b>Neon</b></span>
            <span>File <b>{overview.providers.objectStorage}</b></span>
            <span>Coda <b>{overview.providers.jobQueue}</b></span>
            <span>AI <b>{overview.providers.travelAi}</b></span>
          </div>
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
              <button className={tripPeriod === "upcoming" ? "active" : ""} onClick={() => setTripPeriod("upcoming")}>Da fare</button>
              <button className={tripPeriod === "past" ? "active" : ""} onClick={() => setTripPeriod("past")}>Già fatti</button>
              <button className={tripPeriod === "all" ? "active" : ""} onClick={() => setTripPeriod("all")}>Tutti</button>
              <label><Search/><input value={travelerFilter} onChange={(event) => setTravelerFilter(event.target.value)} placeholder="Cerca viaggiatore…"/></label>
            </div>

            <div className="tripAdminGrid">
              {filteredTrips.map((trip) => {
                const latestImport = overview.recentImports.find((item) => item.templateId === trip.id);
                const importIsActive = latestImport ? activeImportStatuses.has(latestImport.status) : false;
                const content = trip.contentGeneration;
                const contentIsActive = content ? activeEnrichmentStatuses.has(content.status) : false;
                const contentIsComplete = Boolean(
                  content && content.status !== "failed" && content.expectedSections > 0 &&
                  content.readySections === content.expectedSections
                );
                return (
                <article className={importIsActive || contentIsActive ? "tripAdminCard generating" : "tripAdminCard"} key={trip.id}>
                  <div className="tripCardTop"><span className={`status ${trip.status}`}>{statusLabels[trip.status] ?? trip.status}</span><MapPinned size={22}/></div>
                  <h3>{trip.title}</h3>
                  <p>{trip.destinationCountry || "Destinazione da revisionare"}</p>
                  <p>{trip.startsOn && trip.endsOn ? `${trip.startsOn} → ${trip.endsOn}` : "Date in attesa di estrazione"}</p>
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

          <section id="importazioni" className="agencySection">
            <div className="agencySectionHead"><div><small>ELABORAZIONE</small><h2>Importazioni recenti</h2></div></div>
            <div className="importsList">
              {overview.recentImports.filter((item) => item.agencyId === agency?.id).map((item) => (
                <article key={item.id}>
                  <FileText size={20}/>
                  <span><b>{item.fileName}</b><small>{item.tripTitle}</small></span>
                  <time><Clock3 size={13}/>{agencyDateTimeFormatter.format(new Date(item.createdAt))}</time>
                  <em className={`status ${item.status}`}>{statusLabels[item.status] ?? item.status}</em>
                  {item.status === "failed" && <p className="importError">Analisi non riuscita. Il documento è salvo: riprova dopo la correzione.</p>}
                  {(item.status === "failed" || (overview.providers.jobQueue === "database" && item.status === "queued")) && <button className="importAction" disabled={Boolean(busy)} onClick={() => void processImport(item.id)}>{busy === `process-${item.id}` ? <LoaderCircle className="spin"/> : <Play/>}<span>{item.status === "failed" ? "Riprova" : "Elabora"}</span></button>}
                  {item.status === "ready_for_review" && <a className="importAction review" href={`/agenzia/importazioni/${item.id}`}><Eye/><span>Revisiona</span></a>}
                </article>
              ))}
              {overview.recentImports.filter((item) => item.agencyId === agency?.id).length === 0 && <div className="agencyEmpty compact"><FileText/><p>Nessun programma importato.</p></div>}
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
