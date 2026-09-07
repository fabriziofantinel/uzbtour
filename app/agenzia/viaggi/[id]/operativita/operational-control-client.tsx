"use client";
import Link from "next/link";
import { useState } from "react";
import "../../../../smf-2026.css";
import "./operations.css";
import type { CSSProperties } from "react";
import { ArrowLeft, CheckCircle2, ClipboardCheck, HeartHandshake, UserRoundCog, UserPlus } from "lucide-react";
import AgencyManagementNav from "@/components/agency-management-nav";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";
import type { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";
type Data = Awaited<ReturnType<typeof readDepartureOperationalControl>>;
type Journey = Awaited<ReturnType<typeof getJourneyManagement>>;
export default function OperationalControlClient({
  departureId,
  initialData,
  journey,
  backHref,
  backLabel,
  staffRole,
  departureTitle,
  primaryColor,
}: {
  departureId: string;
  initialData: Data;
  journey?: Journey;
  backHref?: string;
  backLabel?: string;
  staffRole?: "agent" | "accompagnatore" | "guida";
  departureTitle?: string;
  primaryColor?: string;
}) {
  const [data, setData] = useState(initialData),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [staffUserId, setStaffUserId] = useState(""),
    [staffDayIds, setStaffDayIds] = useState<string[]>(initialData.days.map((item) => item.id));
  const [activeTab, setActiveTab] = useState<"assignment" | "presence" | "alerts">(
    staffRole ? "presence" : "assignment",
  );
  const tabs = [
    { id: "assignment" as const, label: "Assegna personale" },
    { id: "presence" as const, label: "Presenza" },
    { id: "alerts" as const, label: "Segnalazioni" },
  ];
  const agencyColor = validBrandColor(journey?.journey.agencyPrimaryColor || primaryColor);
  const agencyStyle = {
    "--agency-ui": agencyColor,
    "--agency-ui-ink": "#111111",
    "--smf-brand": agencyColor,
    "--smf-brand-deep": agencyColor,
    "--smf-action": agencyColor,
    "--smf-focus": accessibleBrandColor(agencyColor),
  } as CSSProperties;
  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/departures/${departureId}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
      const refresh = await fetch(`/api/departures/${departureId}/operations`, { cache: "no-store" });
      const refreshed = await refresh.json();
      if (!refresh.ok) throw new Error(refreshed.error || "Impossibile aggiornare i dati. Ricarica la pagina.");
      setData(refreshed);
      setNotice("Aggiornamento registrato.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operazione non riuscita");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="journeyManagePage operationsPage" style={agencyStyle}>
      {staffRole ? (
        <AgencyManagementNav
          departureId={departureId}
          activeTab="operativita"
          staffView
          staffRole={staffRole}
          journeyTitle={departureTitle}
        />
      ) : journey ? (
        <AgencyManagementNav
          departureId={departureId}
          activeTab="operativita"
          journeyTitle={journey.journey.title}
          quoteImportId={journey.journey.quoteImportId}
        />
      ) : (
        <header>
          <Link href={backHref ?? `/agenzia/viaggi/${departureId}`}>
            <ArrowLeft /> {backLabel ?? "Gruppi e viaggiatori"}
          </Link>
        </header>
      )}
      <section className="journeyManageHero">
        <h1>{journey?.journey.title ?? departureTitle ?? "Operatività della partenza"}</h1>
        <p>
          {staffRole ? "Segnalazioni e presenze del viaggio." : "Assegnazioni, presenze e segnalazioni del viaggio."}
        </p>
      </section>
      <div className="journeyManageShell operationsShell">
        {!staffRole && (
          <div className="agencyChatScopes" role="tablist" aria-label="Operatività del viaggio">
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                id={`operations-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`operations-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => {
                  const nextIndex =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : -1;
                  if (nextIndex < 0) return;
                  event.preventDefault();
                  setActiveTab(tabs[nextIndex].id);
                  document.getElementById(`operations-tab-${tabs[nextIndex].id}`)?.focus();
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {notice && (
          <p className="agencyMessage success" role="status">
            <CheckCircle2 />
            {notice}
          </p>
        )}
        {error && (
          <p className="agencyMessage error" role="alert">
            {error}
          </p>
        )}
        {!staffRole && activeTab === "assignment" && (
          <section
            className="operationsPanel"
            role="tabpanel"
            id="operations-panel-assignment"
            aria-labelledby="operations-tab-assignment"
          >
            <h2>
              <UserRoundCog /> Personale assegnato alle giornate
            </h2>
            <p>Associa agenti, accompagnatori e guide alle giornate in cui operano.</p>
            <select
              aria-label="Persona da assegnare"
              value={staffUserId}
              onChange={(event) => {
                const userId = event.target.value;
                setStaffUserId(userId);
                const assignment = data.staff.find((person) => person.userId === userId && person.status === "active");
                setStaffDayIds(
                  assignment
                    ? data.staffDayAssignments
                        .filter((day) => day.assignmentId === assignment.id)
                        .map((day) => day.dayId)
                    : data.days.map((day) => day.id),
                );
              }}
              disabled={busy}
            >
              <option value="" disabled>
                Seleziona persona
              </option>
              {data.eligibleStaff.map((person) => (
                <option value={person.id} key={person.id}>
                  {person.name} ·{" "}
                  {person.role === "accompagnatore" ? "Accompagnatore" : person.role === "guida" ? "Guida" : "Agente"}
                </option>
              ))}
            </select>
            {!data.eligibleStaff.length && (
              <p className="operationsEmpty">
                Nessun personale disponibile. Aggiungi agenti, accompagnatori o guide nella pagina Personale.
              </p>
            )}
            <div className="attendanceGrid">
              {data.days.map((item) => (
                <label key={item.id}>
                  <span>{item.label}</span>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={staffDayIds.includes(item.id)}
                    onChange={(event) =>
                      setStaffDayIds((current) =>
                        event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || !staffUserId || staffDayIds.length === 0}
              onClick={() => {
                const person = data.eligibleStaff.find((item) => item.id === staffUserId);
                if (person)
                  void post({ action: "assignStaffDays", userId: person.id, role: person.role, dayIds: staffDayIds });
              }}
            >
              <UserPlus /> Assegna alle giornate selezionate
            </button>
            <ul className="agencyStackList">
              {data.staff
                .filter((person) => person.status === "active")
                .map((person) => (
                  <li key={person.id}>
                    <span>
                      <strong>{person.name}</strong> ·{" "}
                      {person.role === "accompagnatore"
                        ? "Accompagnatore"
                        : person.role === "guida"
                          ? "Guida"
                          : "Agente"}
                      <small>
                        {data.staffDayAssignments.filter((assignment) => assignment.assignmentId === person.id).length}{" "}
                        giornate assegnate
                      </small>
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {(staffRole || activeTab === "alerts") && (
          <section
            className="operationsPanel"
            role={staffRole ? undefined : "tabpanel"}
            id="operations-panel-alerts"
            aria-labelledby={staffRole ? undefined : "operations-tab-alerts"}
          >
            <h2>
              <HeartHandshake /> Segnalazioni
            </h2>
            <p>Segnalazioni dei viaggiatori disponibili per il tuo ruolo.</p>
            {data.alerts.length ? (
              <ul>
                {data.alerts.map((alert) => (
                  <li key={alert.id}>
                    <strong>{alert.travelerName}</strong>
                    <p>{alert.summary}</p>
                    {alert.instructions && <p>{alert.instructions}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nessuna segnalazione autorizzata.</p>
            )}
          </section>
        )}
        {(staffRole || activeTab === "presence") && (
          <section
            className="operationsPanel"
            role={staffRole ? undefined : "tabpanel"}
            id="operations-panel-presence"
            aria-labelledby={staffRole ? undefined : "operations-tab-presence"}
          >
            <h2>
              <ClipboardCheck /> Presenza
            </h2>
            <p>Rilevazione corrente, organizzata per gruppo e non collegata a una giornata del programma.</p>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void post({ action: "clearPresence" })}
            >
              Annulla tutte le presenze
            </button>
            <div className="attendanceGrid">
              {data.travelers.map((traveler) => {
                const current = data.presence.find((entry) => entry.travelerId === traveler.id);
                return (
                  <label key={traveler.id}>
                    <span>
                      {traveler.name}
                      <small>{traveler.group}</small>
                    </span>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={current?.isPresent ?? false}
                      onChange={(event) =>
                        void post({ action: "setPresence", travelerId: traveler.id, isPresent: event.target.checked })
                      }
                      aria-label={`Presente: ${traveler.name}`}
                    />
                  </label>
                );
              })}
            </div>
            {!data.travelers.length && <p className="operationsEmpty">Nessun viaggiatore presente nel viaggio.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
