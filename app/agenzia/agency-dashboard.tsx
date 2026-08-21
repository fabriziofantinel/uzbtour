"use client";

import { upload } from "@vercel/blob/client";
import {
  ArrowLeft, Building2, CalendarDays, CheckCircle2, ChevronDown, CircleAlert,
  Clock3, Eye, FileText, LoaderCircle, LogOut, MapPinned, Play, Plus, Sparkles, UploadCloud,
  UsersRound,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { PlatformOverview } from "@/lib/platform/types";

type Props = { initialOverview: PlatformOverview };

const statusLabels: Record<string, string> = {
  draft: "Bozza",
  active: "Attivo",
  archived: "Archiviato",
  uploaded: "Caricato",
  queued: "In coda",
  extracting: "Lettura PDF",
  generating: "Generazione contenuti",
  ready_for_review: "Da revisionare",
  published: "Pubblicato",
  failed: "Errore",
};

async function responseJson<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
  return result;
}

export default function AgencyDashboard({ initialOverview }: Props) {
  const [overview, setOverview] = useState(initialOverview);
  const [selectedAgencyId, setSelectedAgencyId] = useState(initialOverview.agencies[0]?.id ?? "");
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
    try {
      await responseJson(await fetch("/api/admin/platform/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyId: agency.id,
          title: form.get("title"),
          destinationCountry: form.get("destinationCountry"),
          timezone: form.get("timezone"),
        }),
      }));
      await refresh();
      setShowNewTrip(false);
      setNotice("Viaggio creato. Ora puoi caricare il programma PDF.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creazione non riuscita");
    } finally {
      setBusy("");
    }
  }

  async function uploadProgramme(templateId: string, file: File) {
    if (!agency) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Seleziona un documento PDF.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setError("Il PDF supera il limite di 30 MB.");
      return;
    }

    setBusy(`upload-${templateId}`);
    setError("");
    setNotice("");
    try {
      const pathname = `agencies/${agency.id}/documents/${crypto.randomUUID()}.pdf`;
      const blob = await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/admin/platform/documents/upload",
        clientPayload: JSON.stringify({
          agencyId: agency.id,
          templateId,
          originalName: file.name,
        }),
      });
      await responseJson(await fetch("/api/admin/platform/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyId: agency.id,
          templateId,
          pathname: blob.pathname,
          originalName: file.name,
        }),
      }));
      await refresh();
      setNotice("PDF caricato e importazione accodata.");
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
      const result = await responseJson<{ import: { days: number } }>(await fetch(
        `/api/admin/platform/imports/${importId}/process`,
        { method: "POST" }
      ));
      await refresh();
      setNotice(`PDF elaborato: ${result.import.days} giornate pronte per la revisione.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Elaborazione non riuscita");
      await refresh().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="agencyPage">
      <header className="agencyTopbar">
        <a className="agencyBrand" href="/">
          <span>VT</span><div><strong>Voyage Toolkit</strong><small>PANNELLO AGENZIA</small></div>
        </a>
        <div className="agencyUser">
          <i>{overview.actor.name.slice(0, 2).toUpperCase()}</i>
          <span><small>Amministratore</small><b>{overview.actor.name}</b></span>
          <form action="/api/auth/logout" method="post"><button aria-label="Esci"><LogOut size={17}/></button></form>
        </div>
      </header>

      <section className="agencyHero">
        <div>
          <p><Sparkles size={15}/> PIATTAFORMA VIAGGI</p>
          <h1>Buongiorno, {overview.actor.name}.</h1>
          <span>Configura programmi, partenze e famiglie da un unico spazio.</span>
        </div>
        <a href="/"><ArrowLeft size={16}/> Apri la demo viaggiatore</a>
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
            <small>CONFIGURAZIONE DEMO</small>
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
                <div className="formIntro"><b>Crea un viaggio</b><span>Il programma potrà essere estratto subito dopo da un PDF.</span></div>
                <label>Titolo<input name="title" placeholder="Es. Giappone classico 2027" required minLength={3}/></label>
                <label>Paese<input name="destinationCountry" placeholder="Es. Giappone"/></label>
                <label>Fuso orario<input name="timezone" defaultValue="Europe/Rome" required/></label>
                <div><button type="button" className="secondary" onClick={() => setShowNewTrip(false)}>Annulla</button><button disabled={busy === "new-trip"}>{busy === "new-trip" && <LoaderCircle className="spin"/>} Crea</button></div>
              </form>
            )}

            <div className="tripAdminGrid">
              {agency?.trips.map((trip) => (
                <article className="tripAdminCard" key={trip.id}>
                  <div className="tripCardTop"><span className={`status ${trip.status}`}>{statusLabels[trip.status] ?? trip.status}</span><MapPinned size={22}/></div>
                  <h3>{trip.title}</h3>
                  <p>{trip.departures.length} partenze · {trip.departures.reduce((sum, item) => sum + item.partyCount, 0)} famiglie</p>
                  <label className={busy === `upload-${trip.id}` ? "uploadAction busy" : "uploadAction"}>
                    {busy === `upload-${trip.id}` ? <LoaderCircle className="spin"/> : <UploadCloud/>}
                    <span><b>{busy === `upload-${trip.id}` ? "Caricamento…" : "Carica programma PDF"}</b><small>PDF privato, massimo 30 MB</small></span>
                    <input type="file" accept="application/pdf,.pdf" disabled={Boolean(busy)} onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadProgramme(trip.id, file);
                    }}/>
                  </label>
                </article>
              ))}
              {agency?.trips.length === 0 && <div className="agencyEmpty"><MapPinned/><h3>Nessun viaggio</h3><p>Crea il primo viaggio e carica il programma dell’agenzia.</p></div>}
            </div>
          </section>

          <section id="importazioni" className="agencySection">
            <div className="agencySectionHead"><div><small>ELABORAZIONE</small><h2>Importazioni recenti</h2></div></div>
            <div className="importsList">
              {overview.recentImports.filter((item) => item.agencyId === agency?.id).map((item) => (
                <article key={item.id}>
                  <FileText size={20}/>
                  <span><b>{item.fileName}</b><small>{item.tripTitle}</small></span>
                  <time><Clock3 size={13}/>{new Date(item.createdAt).toLocaleString("it-IT")}</time>
                  <em className={`status ${item.status}`}>{statusLabels[item.status] ?? item.status}</em>
                  {(item.status === "queued" || item.status === "failed") && <button className="importAction" disabled={Boolean(busy)} onClick={() => void processImport(item.id)}>{busy === `process-${item.id}` ? <LoaderCircle className="spin"/> : <Play/>}<span>{item.status === "failed" ? "Riprova" : "Elabora"}</span></button>}
                  {item.status === "ready_for_review" && <a className="importAction review" href={`/agenzia/importazioni/${item.id}`}><Eye/><span>Revisiona</span></a>}
                </article>
              ))}
              {overview.recentImports.filter((item) => item.agencyId === agency?.id).length === 0 && <div className="agencyEmpty compact"><FileText/><p>Nessun programma importato.</p></div>}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
