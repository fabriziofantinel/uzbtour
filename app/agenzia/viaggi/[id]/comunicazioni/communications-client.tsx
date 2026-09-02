"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FolderOpen,
  LoaderCircle,
  Mail,
  MessageCircle,
  Send,
  Settings2,
  UsersRound,
} from "lucide-react";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";
import type { readDepartureCommunications } from "@/lib/platform/departure-operations";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";

type Communication = Awaited<ReturnType<typeof readDepartureCommunications>>[number];
type Recipient = {
  travelerId: string;
  partyId: string;
  name: string;
  email: string;
  readAt: string | null;
  reachableByPush: boolean;
};

async function json<T>(response: Response) {
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
  return result;
}

export default function CommunicationsClient({
  journey,
  initialCommunications,
}: {
  journey: Awaited<ReturnType<typeof getJourneyManagement>>;
  initialCommunications: Communication[];
}) {
  const [communications, setCommunications] = useState(initialCommunications);
  const [recipients, setRecipients] = useState<Record<string, Recipient[]>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const color = validBrandColor(journey.journey.agencyPrimaryColor);
  const style = {
    "--agency-ui": color,
    "--agency-ui-ink": "#111111",
    "--smf-brand": color,
    "--smf-focus": accessibleBrandColor(color),
  } as CSSProperties;

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("publish");
    setMessage(null);
    try {
      const requiresAcknowledgement = form.get("requiresAcknowledgement") === "on";
      const localDeadline = String(form.get("acknowledgeBy") || "");
      const result = await json<{ communications: Communication[] }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/communications`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.get("title"),
            summary: form.get("summary"),
            severity: form.get("severity"),
            requiresAcknowledgement,
            acknowledgeBy: requiresAcknowledgement && localDeadline ? new Date(localDeadline).toISOString() : null,
            audiencePartyIds: form.getAll("partyId"),
            clientOperationId: crypto.randomUUID(),
          }),
        }),
      );
      setCommunications(result.communications);
      event.currentTarget.reset();
      setMessage({ kind: "success", text: "Comunicazione pubblicata e notifiche accodate." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Pubblicazione non riuscita" });
    } finally {
      setBusy("");
    }
  }

  async function loadRecipients(noticeId: string) {
    if (recipients[noticeId]) return;
    setBusy(`readers-${noticeId}`);
    try {
      const result = await json<{ recipients: Recipient[] }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/communications?noticeId=${noticeId}`),
      );
      setRecipients((current) => ({ ...current, [noticeId]: result.recipients }));
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Destinatari non disponibili" });
    } finally {
      setBusy("");
    }
  }

  async function remind(noticeId: string, travelerId: string, channel: "push" | "email") {
    setBusy(`${channel}-${travelerId}`);
    setMessage(null);
    try {
      const result = await json<{ ok: boolean }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/communications/${noticeId}/reminders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ travelerId, channel }),
        }),
      );
      setMessage({
        kind: result.ok ? "success" : "error",
        text: result.ok ? "Sollecito inviato." : "Il destinatario non è raggiungibile con questo canale.",
      });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Sollecito non riuscito" });
    } finally {
      setBusy("");
    }
  }

  async function close(noticeId: string) {
    const closureNote = window.prompt("Indica come è stato gestito il mancato riscontro:");
    if (!closureNote) return;
    setBusy(`close-${noticeId}`);
    try {
      const result = await json<{ communications: Communication[] }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/communications`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noticeId, closureNote }),
        }),
      );
      setCommunications(result.communications);
      setMessage({ kind: "success", text: "Caso chiuso con nota di audit." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Chiusura non riuscita" });
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="communicationsPage" style={style}>
      <header className="journeyOpsHeader">
        <Link href="/agenzia">
          <ArrowLeft /> Tutti i viaggi
        </Link>
        <nav aria-label="Gestione del viaggio">
          <Link href={`/agenzia/viaggi/${journey.journey.id}/programma`}>
            <BookOpen /> Programma
          </Link>
          <Link href={`/agenzia/viaggi/${journey.journey.id}`}>
            <UsersRound /> Gruppi
          </Link>
          <Link href={`/agenzia/viaggi/${journey.journey.id}/documenti`}>
            <FolderOpen /> Documenti
          </Link>
          <Link href={`/agenzia/viaggi/${journey.journey.id}/chat`}>
            <MessageCircle /> Chat
          </Link>
          <span aria-current="page">
            <Send /> Comunicazioni
          </span>
          <Link href={`/agenzia/viaggi/${journey.journey.id}/impostazioni`}>
            <Settings2 /> Configurazione
          </Link>
        </nav>
      </header>
      <section className="communicationsHero">
        <small>COMUNICAZIONI UFFICIALI</small>
        <h1>{journey.journey.title}</h1>
        <p>Invia aggiornamenti all’intera partenza o soltanto ai gruppi selezionati e controlla le prese visione.</p>
      </section>
      <div className="communicationsShell">
        {message && (
          <div className={`agencyMessage ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.kind === "error" ? <CircleAlert /> : <CheckCircle2 />}
            {message.text}
          </div>
        )}
        <form className="communicationComposer" onSubmit={publish}>
          <h2>Nuova comunicazione</h2>
          <label>
            Titolo
            <input name="title" required minLength={2} maxLength={180} />
          </label>
          <label className="wide">
            Testo
            <textarea name="summary" rows={4} required minLength={2} maxLength={5000} />
          </label>
          <label>
            Priorità
            <select name="severity" defaultValue="information">
              <option value="information">Informativa</option>
              <option value="important">Importante</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>
          <label className="acknowledgement">
            <input type="checkbox" name="requiresAcknowledgement" defaultChecked /> Richiedi “Ho letto”
          </label>
          <label>
            Scadenza presa visione
            <input name="acknowledgeBy" type="datetime-local" />
          </label>
          <fieldset className="wide">
            <legend>Destinatari</legend>
            <p>Nessuna selezione significa tutta la partenza.</p>
            <div>
              {journey.families.map((party) => (
                <label key={party.id}>
                  <input type="checkbox" name="partyId" value={party.id} /> {party.name}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={Boolean(busy)}>
            {busy === "publish" ? <LoaderCircle className="spin" /> : <Send />} Pubblica
          </button>
        </form>
        <section className="communicationList">
          <h2>Registro comunicazioni</h2>
          {communications.map((notice) => {
            const unread = notice.recipientCount - notice.readCount;
            return (
              <article key={notice.id} className={`${notice.severity} ${notice.overdue ? "overdue" : ""}`}>
                <header>
                  <div>
                    <small>
                      {notice.severity === "urgent"
                        ? "URGENTE"
                        : notice.severity === "important"
                          ? "IMPORTANTE"
                          : "INFORMATIVA"}
                    </small>
                    <h3>{notice.title}</h3>
                  </div>
                  <time>{new Date(notice.publishedAt).toLocaleString("it-IT")}</time>
                </header>
                <p>{notice.summary}</p>
                <div className="communicationStats">
                  <span>
                    <UsersRound /> {notice.recipientCount} destinatari
                  </span>
                  <span>
                    <CheckCircle2 /> {notice.readCount} letti
                  </span>
                  <span className={unread ? "unread" : ""}>
                    <Clock3 /> {unread} non letti
                  </span>
                  <span>
                    <Mail /> {notice.unreachableCount} senza push
                  </span>
                </div>
                {notice.acknowledgeBy && (
                  <small>Scadenza: {new Date(notice.acknowledgeBy).toLocaleString("it-IT")}</small>
                )}
                {notice.closedAt ? (
                  <p className="closedCase">Chiuso: {notice.closureNote}</p>
                ) : (
                  <div className="communicationActions">
                    <button type="button" onClick={() => void loadRecipients(notice.id)}>
                      Vedi destinatari
                    </button>
                    {notice.overdue && (
                      <button type="button" onClick={() => void close(notice.id)}>
                        Chiudi caso
                      </button>
                    )}
                  </div>
                )}
                {recipients[notice.id] && (
                  <div className="recipientList">
                    {recipients[notice.id].map((recipient) => (
                      <div key={recipient.travelerId}>
                        <span>
                          <b>{recipient.name}</b>
                          <small>
                            {recipient.readAt
                              ? `Letto ${new Date(recipient.readAt).toLocaleString("it-IT")}`
                              : recipient.reachableByPush
                                ? "Non letto"
                                : "Non raggiungibile via push"}
                          </small>
                        </span>
                        {!recipient.readAt && (
                          <span>
                            <button
                              type="button"
                              disabled={Boolean(busy) || !recipient.reachableByPush}
                              onClick={() => void remind(notice.id, recipient.travelerId, "push")}
                            >
                              Push
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(busy) || !recipient.email}
                              onClick={() => void remind(notice.id, recipient.travelerId, "email")}
                            >
                              Email
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
          {!communications.length && <p className="emptyCommunications">Nessuna comunicazione pubblicata.</p>}
        </section>
      </div>
    </main>
  );
}
