"use client";

import Link from "next/link";
import { FormEvent, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Download,
  FileText,
  FolderOpen,
  LoaderCircle,
  MessageCircle,
  Send,
  Settings2,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import { uploadPrivateFile } from "@/lib/private-upload-client";
import type { AgencyDayDocuments } from "@/lib/platform/day-documents-repository";

function formatDay(startsOn: string, offset: number) {
  const date = new Date(`${startsOn.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
function sizeLabel(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function DayDocumentsClient({ initialData }: { initialData: AgencyDayDocuments }) {
  const [documents, setDocuments] = useState(initialData.documents);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const departure = initialData.departure;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const dayId = String(data.get("dayId") || "");
    const partyId = String(data.get("partyId") || "");
    const description = String(data.get("description") || "").trim();
    const file = data.get("document");
    if (!(file instanceof File) || !file.size || !dayId || !partyId || !description) {
      setMessage({
        kind: "error",
        text: "Seleziona giornata e gruppo, inserisci la descrizione e scegli un documento.",
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const uploaded = await uploadPrivateFile({
        endpoint: `/api/admin/platform/departures/${departure.id}/day-documents/upload`,
        file,
        payload: { dayId, partyId },
      });
      const response = await fetch(`/api/admin/platform/departures/${departure.id}/day-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayId,
          partyId,
          description,
          objectKey: uploaded.key,
          originalName: file.name,
          contentType: uploaded.contentType,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        document?: AgencyDayDocuments["documents"][number];
      };
      if (!response.ok || !result.document) throw new Error(result.error || "Caricamento non riuscito");
      setDocuments((current) => [result.document!, ...current]);
      form.reset();
      setMessage({ kind: "success", text: "Documento associato alla giornata e al gruppo." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Caricamento non riuscito" });
    } finally {
      setBusy(false);
    }
  }
  async function removeDocument(documentId: string) {
    if (!window.confirm("Eliminare questo documento dal viaggio?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/platform/departures/${departure.id}/day-documents`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencyId: departure.agencyId, documentId }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Eliminazione non riuscita");
      setDocuments((current) => current.filter((item) => item.id !== documentId));
      setMessage({ kind: "success", text: "Documento eliminato." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Eliminazione non riuscita" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className="journeyManagePage dayDocumentsPage"
      style={
        {
          "--smf-brand": departure.agencyPrimaryColor,
          "--smf-brand-deep": departure.agencyPrimaryColor,
          "--smf-action": departure.agencyPrimaryColor,
        } as CSSProperties
      }
    >
      <header>
        <Link href="/agenzia">
          <ArrowLeft /> Tutti i viaggi
        </Link>
        <nav aria-label="Gestione del viaggio">
          <Link href={`/agenzia/viaggi/${departure.id}/programma`}>
            <BookOpen /> Programma
          </Link>
          <Link href={`/agenzia/viaggi/${departure.id}`}>
            <UsersRound /> Gruppi
          </Link>
          <span aria-current="page">
            <FolderOpen /> Documenti
          </span>
          <Link href={`/agenzia/viaggi/${departure.id}/chat`}>
            <MessageCircle /> Chat
          </Link>
          <Link href={`/agenzia/viaggi/${departure.id}/comunicazioni`}>
            <Send /> Comunicazioni
          </Link>
          <Link href={`/agenzia/viaggi/${departure.id}/impostazioni`}>
            <Settings2 /> Configurazione
          </Link>
        </nav>
        <span className="journeyAgencyName">{departure.programmeTitle}</span>
      </header>
      <section className="journeyManageHero">
        <small>DOCUMENTI DEL VIAGGIO</small>
        <h1>{departure.title}</h1>
        <p>
          <CalendarDays /> Associa ogni documento alla giornata e al gruppo corretti.
        </p>
      </section>
      <div className="journeyManageShell">
        <div className="journeyManageHead">
          <div>
            <small>ARCHIVIO PRIVATO</small>
            <h2>Documenti per giornata e gruppo</h2>
          </div>
        </div>
        {message && (
          <div className={`agencyMessage ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.kind === "error" ? <CircleAlert /> : <CheckCircle2 />}
            {message.text}
          </div>
        )}
        <form className="dayDocumentForm" onSubmit={submit} aria-busy={busy}>
          <label>
            Giornata *
            <select name="dayId" required defaultValue="">
              <option value="" disabled>
                Seleziona la giornata
              </option>
              {initialData.days.map((day) => (
                <option key={day.id} value={day.id}>
                  Giorno {day.number} · {formatDay(departure.startsOn, day.offset)} · {day.city || day.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Gruppo *
            <select name="partyId" required defaultValue="">
              <option value="" disabled>
                Seleziona il gruppo
              </option>
              {initialData.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} · {group.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Descrizione *
            <input name="description" required maxLength={500} placeholder="Es. Voucher escursione o biglietto museo" />
          </label>
          <label>
            Documento *
            <input
              name="document"
              type="file"
              required
              accept="application/pdf,.pdf,.doc,.docx,image/jpeg,image/png,image/webp"
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" /> Caricamento…
              </>
            ) : (
              <>
                <Upload /> Carica documento
              </>
            )}
          </button>
        </form>
        <section className="dayDocumentList" aria-label="Documenti caricati">
          {documents.map((document) => {
            const day = initialData.days.find((entry) => entry.id === document.dayId);
            return (
              <article key={document.id}>
                <FileText />
                <span>
                  <small>
                    {document.partyName} · GIORNO {day?.number ?? "–"} ·{" "}
                    {day ? formatDay(departure.startsOn, day.offset) : "Giornata"}
                  </small>
                  <b>{document.description}</b>
                  <em>
                    {document.title} · {sizeLabel(document.sizeBytes)}
                  </em>
                </span>
                <a href={document.downloadUrl}>
                  <Download /> Scarica
                </a>
                <button
                  type="button"
                  className="documentDelete"
                  disabled={busy}
                  onClick={() => void removeDocument(document.id)}
                >
                  <Trash2 /> Elimina
                </button>
              </article>
            );
          })}
          {documents.length === 0 && (
            <div className="agencyEmpty">
              <FolderOpen />
              <h3>Nessun documento</h3>
              <p>I documenti caricati saranno visibili solo al gruppo selezionato.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
