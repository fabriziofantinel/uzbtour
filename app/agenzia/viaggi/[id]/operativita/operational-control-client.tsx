"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardCheck, HeartHandshake, UserRoundCog } from "lucide-react";
import type { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
type Data = Awaited<ReturnType<typeof readDepartureOperationalControl>>;
export default function OperationalControlClient({
  departureId,
  initialData,
}: {
  departureId: string;
  initialData: Data;
}) {
  const [data, setData] = useState(initialData),
    [day, setDay] = useState(initialData.days[0]?.id || ""),
    [notice, setNotice] = useState("");
  async function post(body: Record<string, unknown>) {
    const response = await fetch(`/api/departures/${departureId}/operations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
    const refresh = await fetch(`/api/departures/${departureId}/operations`, { cache: "no-store" });
    setData(await refresh.json());
    setNotice("Aggiornamento registrato.");
  }
  return (
    <main className="journeyManagePage">
      <header>
        <Link href={`/agenzia/viaggi/${departureId}`}>
          <ArrowLeft /> Gruppi e viaggiatori
        </Link>
      </header>
      <section className="journeyManageHero">
        <small>GESTIONE SUL CAMPO</small>
        <h1>Operatività della partenza</h1>
        <p>Tour Leader, presenze e sole segnalazioni essenziali autorizzate.</p>
      </section>
      <div className="journeyManageShell">
        {notice && (
          <p className="agencyMessage success">
            <CheckCircle2 />
            {notice}
          </p>
        )}
        {data.eligibleStaff.length > 0 && (
          <section className="agencyPanel">
            <h2>
              <UserRoundCog /> Tour Leader
            </h2>
            <p>Il responsabile assegna una persona già censita nell’agenzia alla sola partenza.</p>
            <select
              aria-label="Persona da assegnare"
              onChange={(event) =>
                event.target.value && void post({ action: "assignTourLeader", userId: event.target.value })
              }
              defaultValue=""
            >
              <option value="" disabled>
                Seleziona persona
              </option>
              {data.eligibleStaff.map((person) => (
                <option value={person.id} key={person.id}>
                  {person.name} · {person.email}
                </option>
              ))}
            </select>
            <ul>
              {data.staff.map((person) => (
                <li key={person.id}>{person.name}</li>
              ))}
            </ul>
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
