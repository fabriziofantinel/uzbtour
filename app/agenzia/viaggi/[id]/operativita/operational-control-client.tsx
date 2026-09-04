"use client";
import Link from "next/link";
import { useState } from "react";
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
}: {
  departureId: string;
  initialData: Data;
  journey?: Journey;
  backHref?: string;
  backLabel?: string;
  staffRole?: "agent" | "accompagnatore" | "guida";
}) {
  const [data, setData] = useState(initialData),
    [day, setDay] = useState(initialData.days[0]?.id || ""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [staffUserId, setStaffUserId] = useState(""),
    [staffDayIds, setStaffDayIds] = useState<string[]>(initialData.days.map((item) => item.id)),
    [period, setPeriod] = useState(() => ({
      validFrom: new Date().toISOString().slice(0, 16),
      validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16),
    })),
    [invite, setInvite] = useState({ name: "", username: "", email: "", phone: "" });
  const agencyColor = validBrandColor(journey?.journey.agencyPrimaryColor);
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
    try {
      const response = await fetch(`/api/departures/${departureId}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
      const refresh = await fetch(`/api/departures/${departureId}/operations`, { cache: "no-store" });
      setData(await refresh.json());
      setNotice(
        result.invitationEmailSent === false
          ? "Tour Leader creato, ma l’email di invito non è stata inviata."
          : result.invitationEmailSent
            ? "Tour Leader invitato via email e assegnato alla partenza."
            : "Aggiornamento registrato.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operazione non riuscita");
    } finally {
      setBusy(false);
    }
  }
  const isoPeriod = () => ({
    validFrom: new Date(period.validFrom).toISOString(),
    validUntil: new Date(period.validUntil).toISOString(),
  });
  return (
    <main className="journeyManagePage" style={agencyStyle}>
      {journey ? (
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
        <small>GESTIONE SUL CAMPO</small>
        <h1>{journey?.journey.title ?? "Operatività della partenza"}</h1>
        <p>
          {staffRole
            ? "Presenze e segnalazioni operative essenziali autorizzate."
            : "Personale, presenze e sole segnalazioni essenziali autorizzate."}
        </p>
      </section>
      <div className="journeyManageShell">
        {notice && (
          <p className="agencyMessage success">
            <CheckCircle2 />
            {notice}
          </p>
        )}
        {error && <p className="agencyMessage error">{error}</p>}
        {!staffRole && data.eligibleStaff.length > 0 && (
          <section className="agencyPanel">
            <h2>
              <UserRoundCog /> Personale assegnato alle giornate
            </h2>
            <p>Associa agenti, accompagnatori e guide alle giornate in cui operano.</p>
            <select
              aria-label="Persona da assegnare"
              value={staffUserId}
              onChange={(event) => setStaffUserId(event.target.value)}
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
            <div className="attendanceGrid">
              {data.days.map((item) => (
                <label key={item.id}>
                  <span>{item.label}</span>
                  <input
                    type="checkbox"
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
              {data.staff.map((person) => (
                <li key={person.id}>
                  <span>
                    <strong>{person.name}</strong> ·{" "}
                    {person.role === "accompagnatore" ? "Accompagnatore" : person.role === "guida" ? "Guida" : "Agente"}
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
        {!staffRole && (
          <section className="agencyPanel">
            <h2>
              <UserPlus /> Invita Tour Leader esterno
            </h2>
            <p>
              L’account sarà legato esclusivamente a questa partenza e non diventerà un utente permanente dell’agenzia.
            </p>
            <form
              className="agencyFormGrid"
              onSubmit={(event) => {
                event.preventDefault();
                void post({ action: "inviteTourLeader", ...invite, ...isoPeriod() });
              }}
            >
              <label>
                Abilitato dal
                <input
                  required
                  type="datetime-local"
                  value={period.validFrom}
                  onChange={(event) => setPeriod((value) => ({ ...value, validFrom: event.target.value }))}
                />
              </label>
              <label>
                Abilitato fino al
                <input
                  required
                  type="datetime-local"
                  value={period.validUntil}
                  onChange={(event) => setPeriod((value) => ({ ...value, validUntil: event.target.value }))}
                />
              </label>
              {(["name", "username", "email", "phone"] as const).map((field) => (
                <label key={field}>
                  {field === "name"
                    ? "Nome e cognome"
                    : field === "username"
                      ? "Username"
                      : field === "email"
                        ? "Email"
                        : "Telefono"}
                  <input
                    required
                    type={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
                    value={invite[field]}
                    onChange={(event) => setInvite((value) => ({ ...value, [field]: event.target.value }))}
                  />
                </label>
              ))}
              <button type="submit" disabled={busy}>
                <UserPlus /> {busy ? "Invio…" : "Crea e invia invito"}
              </button>
            </form>
          </section>
        )}
        <section className="agencyPanel">
          <h2>
            <ClipboardCheck /> Presenze
          </h2>
          <label>
            Giornata
            <select value={day} onChange={(event) => setDay(event.target.value)}>
              {data.days.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="attendanceGrid">
            {data.travelers.map((traveler) => {
              const current = data.attendance.find((entry) => entry.dayId === day && entry.travelerId === traveler.id);
              return (
                <label key={traveler.id}>
                  <span>
                    {traveler.name}
                    <small>{traveler.group}</small>
                  </span>
                  <select
                    value={current?.status || ""}
                    onChange={(event) =>
                      event.target.value &&
                      void post({
                        action: "attendance",
                        dayId: day,
                        travelerId: traveler.id,
                        status: event.target.value,
                        note: "",
                      })
                    }
                  >
                    <option value="">Da registrare</option>
                    <option value="present">Presente</option>
                    <option value="absent">Assente</option>
                    <option value="excused">Giustificato</option>
                  </select>
                </label>
              );
            })}
          </div>
        </section>
        <section className="agencyPanel">
          <h2>
            <HeartHandshake /> Segnalazioni operative essenziali
          </h2>
          <p>
            Visibili esclusivamente al responsabile e al Tour Leader. Nessun passaporto, documento sanitario, diagnosi o
            posizione.
          </p>
          {data.alerts.length ? (
            <ul>
              {data.alerts.map((alert) => (
                <li key={alert.id}>
                  <strong>{alert.travelerName}</strong>: {alert.summary}
                  {alert.instructions ? ` · ${alert.instructions}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nessuna segnalazione autorizzata.</p>
          )}
        </section>
      </div>
    </main>
  );
}
