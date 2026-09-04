"use client";

import { FormEvent, useMemo, useState, type CSSProperties } from "react";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Download,
  FileText,
  FolderOpen,
  LoaderCircle,
  Trash2,
  Upload,
} from "lucide-react";
import { uploadPrivateFile } from "@/lib/private-upload-client";
import type { AgencyDayDocuments } from "@/lib/platform/day-documents-repository";
import { useAppConfirm } from "@/components/app-confirm-dialog";
import AgencyManagementNav from "@/components/agency-management-nav";

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
  const { confirm: confirmAction, dialog: confirmDialog } = useAppConfirm();
  const [documents, setDocuments] = useState(initialData.documents);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const departure = initialData.departure;
  const groups = useMemo(() => initialData.groups, [initialData.groups]);
  const [audienceScope, setAudienceScope] = useState<"trip" | "group" | "traveler">("trip");
  const [partyId, setPartyId] = useState(groups[0]?.id || "");
  const [travelerId, setTravelerId] = useState(groups[0]?.travelers[0]?.id || "");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const dayId = String(data.get("dayId") || "");
    const description = String(data.get("description") || "").trim();
    const file = data.get("document");
    if (
      !(file instanceof File) ||
      !file.size ||
      !dayId ||
      !description ||
      (audienceScope !== "trip" && !partyId) ||
      (audienceScope === "traveler" && !travelerId)
    ) {
      setMessage({
        kind: "error",
        text: "Seleziona giornata e destinatari, inserisci la descrizione e scegli un documento.",
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const uploaded = await uploadPrivateFile({
        endpoint: `/api/admin/platform/departures/${departure.id}/day-documents/upload`,
        file,
        payload: { dayId, partyId, travelerId, audienceScope },
      });
      const response = await fetch(`/api/admin/platform/departures/${departure.id}/day-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayId,
          partyId,
          travelerId,
          audienceScope,
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
      setMessage({ kind: "success", text: "Documento associato alla giornata e ai destinatari selezionati." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Caricamento non riuscito" });
    } finally {
      setBusy(false);
    }
  }
  async function removeDocument(documentId: string) {
    if (
      !(await confirmAction({
        title: "Elimina il documento",
        message: "Il documento non sarà più disponibile ai viaggiatori del gruppo.",
        confirmLabel: "Elimina documento",
        tone: "danger",
      }))
    )
      return;
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
    <>
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
        <AgencyManagementNav
          departureId={departure.id}
          activeTab="documenti"
          quoteImportId={departure.quoteImportId}
          journeyTitle={departure.programmeTitle}
        />
        <section className="journeyManageHero">
          <small>DOCUMENTI DEL VIAGGIO</small>
          <h1>{departure.title}</h1>
          <p>
            <CalendarDays /> Associa ogni documento alla giornata e ai destinatari corretti.
          </p>
        </section>
        <div className="journeyManageShell">
          <div className="journeyManageHead">
            <div>
              <h2>Documenti di Viaggio</h2>
              <p>Invia ogni documento all’intero viaggio, a un gruppo o a un singolo viaggiatore.</p>
            </div>
          </div>
          {message && (
            <div className={`agencyMessage ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
              {message.kind === "error" ? <CircleAlert /> : <CheckCircle2 />}
              {message.text}
            </div>
          )}
          <section className="documentAudience" aria-labelledby="document-audience-title">
            <h2 id="document-audience-title" className="srOnly">
              Destinatari del documento
            </h2>
            <div className="agencyChatScopes" role="tablist" aria-label="Destinatari del documento">
              {(
                [
                  ["trip", "Viaggio"],
                  ["group", "Gruppo"],
                  ["traveler", "Viaggiatore"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={audienceScope === value}
                  className={audienceScope === value ? "active" : ""}
                  onClick={() => setAudienceScope(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {audienceScope !== "trip" && (
              <label className="agencyChatGroup">
                Gruppo
                <select
                  value={partyId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setPartyId(next);
                    setTravelerId(groups.find((group) => group.id === next)?.travelers[0]?.id || "");
                  }}
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} · {group.code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {audienceScope === "traveler" && (
              <label className="agencyChatGroup">
                Viaggiatore
                <select value={travelerId} onChange={(event) => setTravelerId(event.target.value)}>
                  {groups
                    .find((group) => group.id === partyId)
                    ?.travelers.map((traveler) => (
                      <option key={traveler.id} value={traveler.id}>
                        {traveler.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <p>
              {audienceScope === "trip"
                ? "Il documento sarà disponibile a tutti i viaggiatori della partenza."
                : audienceScope === "group"
                  ? "Il documento sarà disponibile solo ai viaggiatori del gruppo selezionato."
                  : "Il documento sarà disponibile solo al viaggiatore selezionato."}
            </p>
          </section>
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
              Descrizione *
              <input
                name="description"
                required
                maxLength={500}
                placeholder="Es. Voucher escursione o biglietto museo"
              />
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
                      {document.travelerName || document.partyName} · GIORNO {day?.number ?? "–"} ·{" "}
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
                <p>I documenti caricati saranno visibili solo ai destinatari selezionati.</p>
              </div>
            )}
          </section>
        </div>
      </main>
      {confirmDialog}
    </>
  );
}
