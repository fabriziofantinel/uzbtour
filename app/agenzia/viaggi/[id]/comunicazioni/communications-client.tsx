"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, Mail, Send, UsersRound } from "lucide-react";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";
import AgencyManagementNav from "@/components/agency-management-nav";
import type { readDepartureCommunications } from "@/lib/platform/departure-operations";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";

type Communication = Awaited<ReturnType<typeof readDepartureCommunications>>[number];
type Recipient = {
  recipientId: string;
  travelerId: string | null;
  partyId: string | null;
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
  staff,
  actorUserId,
  showOperations = true,
  staffView = false,
  staffRole = null,
}: {
  journey: Awaited<ReturnType<typeof getJourneyManagement>>;
  initialCommunications: Communication[];
  staff: { userId: string; name: string; role: string }[];
  actorUserId: string;
  showOperations?: boolean;
  staffView?: boolean;
  staffRole?: "agent" | "accompagnatore" | "guida" | null;
}) {
  const [communications, setCommunications] = useState(initialCommunications);
  const [recipients, setRecipients] = useState<Record<string, Recipient[]>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [closingNoticeId, setClosingNoticeId] = useState<string | null>(null);
  const [closureNote, setClosureNote] = useState("");
  const groups = useMemo(
    () => journey.groups.map((group) => ({ id: group.id, name: group.name, travelers: group.travelers })),
    [journey.groups],
  );
  const [audienceScope, setAudienceScope] = useState<"trip" | "group" | "traveler" | "accompagnatore" | "guida">(
    "trip",
  );
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id || "");
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const isStaffScope = audienceScope === "accompagnatore" || audienceScope === "guida";
  const availableStaff = staff.filter(
    (person) =>
      person.userId !== actorUserId &&
      (person.role === audienceScope || (audienceScope === "accompagnatore" && person.role === "tour_leader")),
  );
  const [selectedTravelerId, setSelectedTravelerId] = useState(groups[0]?.travelers[0]?.id || "");
  const color = validBrandColor(journey.journey.agencyPrimaryColor);
  const style = {
    "--agency-ui": color,
    "--agency-ui-ink": "#111111",
    "--smf-brand": color,
    "--smf-brand-deep": color,
    "--smf-action": color,
    "--smf-focus": accessibleBrandColor(color),
  } as CSSProperties;

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isStaffScope && !selectedStaffIds.length) {
      setMessage({ kind: "error", text: "Seleziona almeno un destinatario associato al viaggio." });
      return;
    }
    if (["group", "traveler"].includes(audienceScope) && !selectedGroupId) {
      setMessage({ kind: "error", text: "Seleziona un gruppo destinatario." });
      return;
    }
    if (audienceScope === "traveler" && !selectedTravelerId) {
      setMessage({ kind: "error", text: "Seleziona un viaggiatore destinatario." });
      return;
    }
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
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
            audiencePartyIds: audienceScope === "group" || audienceScope === "traveler" ? [selectedGroupId] : [],
            audienceTravelerIds: audienceScope === "traveler" ? [selectedTravelerId] : [],
            audienceStaffRole: audienceScope === "accompagnatore" || audienceScope === "guida" ? audienceScope : null,
            audienceStaffUserIds: isStaffScope ? selectedStaffIds : [],
            clientOperationId: crypto.randomUUID(),
          }),
        }),
      );
      setCommunications(result.communications);
      formElement.reset();
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

  async function closeCase(noticeId: string, note: string) {
    setBusy(`close-${noticeId}`);
    try {
      const result = await json<{ communications: Communication[] }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/communications`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noticeId, closureNote: note }),
        }),
      );
      setCommunications(result.communications);
      setClosingNoticeId(null);
      setClosureNote("");
      setMessage({ kind: "success", text: "Caso chiuso con nota di audit." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Chiusura non riuscita" });
    } finally {
      setBusy("");
    }
  }

  const closeDialogRef = useRef<HTMLFormElement>(null);
  const closeDialogTitleId = "close-case-title";
  const closeDialogDescriptionId = "close-case-description";

  useEffect(() => {
    if (!closingNoticeId) return;
    const dialog = closeDialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const getFocusableElements = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => element.offsetParent !== null);

    const list = getFocusableElements();
    (list[0] ?? null)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setClosingNoticeId(null);
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusableElements();
      if (!items.length) return;
      const active = document.activeElement;
      const activeIndex = items.indexOf(active instanceof HTMLElement ? active : items[0]);
      if (event.shiftKey && (active === items[0] || activeIndex === -1)) {
        event.preventDefault();
        items[items.length - 1].focus();
        return;
      }
      if (!event.shiftKey && (active === items[items.length - 1] || activeIndex === -1)) {
        event.preventDefault();
        items[0].focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [closingNoticeId]);

  return (
    <>
      <main className="journeyManagePage" style={style}>
        <AgencyManagementNav
          departureId={journey.journey.id}
          activeTab="comunicazioni"
          journeyTitle={journey.journey.title}
          showOperations={showOperations}
          quoteImportId={journey.journey.quoteImportId}
          staffView={staffView}
          staffRole={staffRole}
        />
        <section className="journeyManageHero">
          <h1>{journey.journey.title}</h1>
          <p>Invia aggiornamenti al viaggio, a un gruppo o a un singolo viaggiatore e controlla le prese visione.</p>
        </section>
        <div className="journeyManageShell communicationsShell">
          <section className="communicationAudience" aria-labelledby="communication-audience-title">
            <h2 id="communication-audience-title" className="srOnly">
              Destinatari della comunicazione
            </h2>
            <div className="agencyChatScopes" role="tablist" aria-label="Destinatari della comunicazione">
              {(
                [
                  ["trip", "Viaggio"],
                  ["group", "Gruppo"],
                  ["traveler", "Viaggiatore"],
                  ["accompagnatore", "Accompagnatore"],
                  ["guida", "Guida"],
                ] as const
              )
                .filter(([value]) => staffRole !== "accompagnatore" || value !== "accompagnatore")
                .map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={audienceScope === value}
                    className={audienceScope === value ? "active" : ""}
                    onClick={() => {
                      setAudienceScope(value);
                      setSelectedStaffIds([]);
                    }}
                  >
                    {label}
                  </button>
                ))}
            </div>
            {["group", "traveler"].includes(audienceScope) && (
              <label className="agencyChatGroup">
                Gruppo
                <select
                  value={selectedGroupId}
                  onChange={(event) => {
                    const groupId = event.target.value;
                    setSelectedGroupId(groupId);
                    setSelectedTravelerId(groups.find((group) => group.id === groupId)?.travelers[0]?.id || "");
                  }}
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {audienceScope === "traveler" && (
              <label className="agencyChatGroup">
                Viaggiatore
                <select value={selectedTravelerId} onChange={(event) => setSelectedTravelerId(event.target.value)}>
                  {groups
                    .find((group) => group.id === selectedGroupId)
                    ?.travelers.map((traveler) => (
                      <option key={traveler.id} value={traveler.id}>
                        {traveler.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {isStaffScope && (
              <fieldset className="communicationStaffRecipients">
                <legend>
                  {audienceScope === "accompagnatore" ? "Seleziona gli accompagnatori" : "Seleziona le guide"}
                </legend>
                {availableStaff.map((person) => (
                  <label key={person.userId}>
                    <input
                      type="checkbox"
                      checked={selectedStaffIds.includes(person.userId)}
                      onChange={(event) =>
                        setSelectedStaffIds((ids) =>
                          event.target.checked ? [...ids, person.userId] : ids.filter((id) => id !== person.userId),
                        )
                      }
                    />
                    {person.name}
                  </label>
                ))}
                {!availableStaff.length && (
                  <p>
                    Nessun {audienceScope === "accompagnatore" ? "accompagnatore associato" : "guida associata"} al
                    viaggio. Aggiungi le assegnazioni nella pagina Operatività.
                  </p>
                )}
              </fieldset>
            )}
            <p className="communicationAudienceHint">
              {audienceScope === "trip"
                ? "La comunicazione verrà inviata a tutti i viaggiatori della partenza."
                : audienceScope === "group"
                  ? "La comunicazione verrà inviata soltanto ai viaggiatori del gruppo selezionato."
                  : audienceScope === "traveler"
                    ? "La comunicazione verrà inviata soltanto al viaggiatore selezionato."
                    : audienceScope === "accompagnatore"
                      ? "La comunicazione verrà inviata soltanto agli accompagnatori selezionati."
                      : "La comunicazione verrà inviata soltanto alle guide selezionate."}
            </p>
          </section>
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
            <button type="submit" disabled={Boolean(busy) || (isStaffScope && !selectedStaffIds.length)}>
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
                      {notice.audienceKind === "staff" ? (
                        <span>Destinatari: {notice.staffRole === "guida" ? "guide" : "accompagnatori"}</span>
                      ) : null}
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
                      {notice.overdue && notice.canClose && (
                        <button
                          type="button"
                          onClick={() => {
                            setClosureNote("");
                            setClosingNoticeId(notice.id);
                          }}
                        >
                          Chiudi caso
                        </button>
                      )}
                    </div>
                  )}
                  {recipients[notice.id] && (
                    <div className="recipientList">
                      {recipients[notice.id].map((recipient) => (
                        <div key={recipient.recipientId}>
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
                          {!recipient.readAt && notice.audienceKind === "traveler" && recipient.travelerId && (
                            <span>
                              <button
                                type="button"
                                disabled={Boolean(busy) || !recipient.reachableByPush}
                                onClick={() => void remind(notice.id, recipient.travelerId!, "push")}
                              >
                                Push
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(busy) || !recipient.email}
                                onClick={() => void remind(notice.id, recipient.travelerId!, "email")}
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
      {closingNoticeId &&
        createPortal(
          <div className="appDecisionOverlay" onMouseDown={() => setClosingNoticeId(null)}>
            <form
              ref={closeDialogRef}
              className="appDecisionDialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={closeDialogTitleId}
              aria-describedby={closeDialogDescriptionId}
              onMouseDown={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                const note = closureNote.trim();
                if (note.length < 3) return;
                void closeCase(closingNoticeId, note);
              }}
            >
              <h2 id={closeDialogTitleId}>Chiudi il mancato riscontro</h2>
              <p id={closeDialogDescriptionId}>
                Descrivi come è stato contattato o assistito il viaggiatore. La nota resterà nello storico di audit.
              </p>
              <label className="appDecisionField">
                Nota di chiusura
                <textarea
                  autoFocus
                  required
                  minLength={3}
                  rows={4}
                  value={closureNote}
                  onChange={(event) => setClosureNote(event.target.value)}
                />
              </label>
              <div className="appDecisionActions">
                <button type="button" className="secondary" onClick={() => setClosingNoticeId(null)}>
                  Annulla
                </button>
                <button type="submit" disabled={closureNote.trim().length < 3 || busy === `close-${closingNoticeId}`}>
                  {busy === `close-${closingNoticeId}` ? <LoaderCircle className="spin" /> : <CheckCircle2 />}
                  Registra chiusura
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
