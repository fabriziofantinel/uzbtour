"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  LayoutGrid,
  List,
  MapPinned,
  Search,
  SlidersHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import type { readStaffDashboard } from "@/lib/platform/departure-operational-control";

type Trip = Awaited<ReturnType<typeof readStaffDashboard>>[number];
function tripPhase(trip: Trip, today: string) {
  return trip.endsOn.slice(0, 10) < today
    ? "past"
    : trip.startsOn.slice(0, 10) > today
      ? "future"
      : "ongoing";
}
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Rome",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
function tripStatus(trip: Trip) {
  if (trip.status === "draft") return { className: "draft", label: "Bozza" };
  if (trip.status === "cancelled") return { className: "draft", label: "Annullato" };
  if (trip.status === "archived") return { className: "draft", label: "Archiviato" };
  return { className: "validated", label: "Validato" };
}

export default function StaffTrips({ trips, today }: { trips: Trip[]; today: string }) {
  const [view, setView] = useState<"list" | "cards">("list");
  const activeTripPhase = trips.reduce<"ongoing" | "future" | "none">((current, trip) => {
    if (current === "ongoing") return "ongoing";
    const phase = tripPhase(trip, today);
    if (phase === "ongoing") return "ongoing";
    if (phase === "future" && current === "none") return "future";
    return current;
  }, "none");
  const defaultPeriod: "all" | "future" | "ongoing" | "past" =
    activeTripPhase === "ongoing" ? "ongoing" : activeTripPhase === "future" ? "future" : "all";
  const [period, setPeriod] = useState<"all" | "future" | "ongoing" | "past">(defaultPeriod);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date-asc");
  const periods = [
    ["all", "Tutti"],
    ["future", "Da fare"],
    ["ongoing", "In corso"],
    ["past", "Fatti"],
  ] as const;
  const filtered = trips
    .filter(
      (trip) =>
      (period === "all" || tripPhase(trip, today) === period) &&
        [trip.title, trip.destinationCountry, ...trip.travelerNames]
          .join(" ")
          .toLocaleLowerCase("it")
          .includes(search.trim().toLocaleLowerCase("it")),
    )
    .sort((a, b) =>
      sort === "name"
      ? a.title.localeCompare(b.title, "it")
      : sort === "date-desc"
        ? b.startsOn.localeCompare(a.startsOn)
          : a.startsOn.localeCompare(b.startsOn),
    );
  const clear = () => {
    setPeriod(defaultPeriod);
    setSearch("");
  };
  const open = (trip: Trip) => (
    <Link className="primary" href={`/agenzia/viaggi/${trip.id}/programma`}>
      <BookOpen /> Apri programma
    </Link>
  );

  return (
    <>
      <div className="agencyStats">
        <article>
          <MapPinned />
          <span>
            <small>VIAGGI</small>
            <b>{new Set(trips.map((trip) => trip.templateId)).size}</b>
          </span>
        </article>
        <article>
          <CalendarDays />
          <span>
            <small>PARTENZE</small>
            <b>{trips.length}</b>
          </span>
        </article>
        <article>
          <UsersRound />
          <span>
            <small>GRUPPI</small>
            <b>{trips.reduce((total, trip) => total + trip.partyCount, 0)}</b>
          </span>
        </article>
      </div>
      <section id="viaggi" className="agencySection">
        <div className="agencySectionHead">
          <div>
            <h2>I viaggi assegnati</h2>
          </div>
          <div className="agencySectionActions">
            <div className="tripViewToggle" role="group" aria-label="Visualizzazione viaggi">
              <button
                type="button"
                className={view === "list" ? "active" : ""}
                aria-label="Visualizza come lista"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List />
              </button>
              <button
                type="button"
                className={view === "cards" ? "active" : ""}
                aria-label="Visualizza come schede"
                aria-pressed={view === "cards"}
                onClick={() => setView("cards")}
              >
                <LayoutGrid />
              </button>
            </div>
          </div>
        </div>
        <div className="tripFilters" role="group" aria-label="Filtra i viaggi">
          <span>
            <SlidersHorizontal /> Stato
          </span>
          {periods.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={period === value ? "active" : ""}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {label} <b>{value === "all" ? trips.length : trips.filter((trip) => tripPhase(trip, today) === value).length}</b>
            </button>
          ))}
          <div className="tripSearch">
            <Search />
            <label className="srOnly" htmlFor="staff-trip-search">
              Cerca viaggio, destinazione o viaggiatore
            </label>
            <input
              id="staff-trip-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cerca viaggio o viaggiatore…"
            />
            {search && (
              <button
                type="button"
                className="clearTripSearch"
                aria-label="Cancella ricerca"
                onClick={() => setSearch("")}
              >
                <X />
              </button>
            )}
          </div>
        </div>
        <div className="tripListTools">
          <p className="tripResultCount" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? "viaggio visualizzato" : "viaggi visualizzati"}
          </p>
          {(period !== "all" || search) && (
            <button type="button" className="clearAllTripFilters" onClick={clear}>
              <X /> Azzera filtri
            </button>
          )}
          <label htmlFor="staff-trip-sort">
            Ordina per
            <select id="staff-trip-sort" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="date-asc">Partenza più vicina</option>
              <option value="date-desc">Partenza più recente</option>
              <option value="name">Nome viaggio</option>
            </select>
            <ChevronDown />
          </label>
        </div>
        {view === "list" ? (
          <div className="tripTableWrap">
            <table className="tripTable">
              <caption>Elenco dei viaggi e delle partenze assegnati</caption>
              <thead>
                <tr>
                  <th>Stato</th>
                  <th>Viaggio</th>
                  <th>Periodo</th>
                  <th>Gruppi</th>
                  <th>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((trip) => {
                  const status = tripStatus(trip);
                  return (
                    <tr key={trip.id}>
                      <td data-label="Stato">
                        <span className={`status ${status.className}`}>{status.label}</span>
                      </td>
                      <td data-label="Viaggio" className="tripNameCell">
                        <b>{trip.title}</b>
                        <span>{trip.destinationCountry}</span>
                      </td>
                      <td data-label="Periodo" className="dateRangeCell">
                        <b>{dateLabel(trip.startsOn)}</b>
                        <span aria-hidden="true">→</span>
                        <b>{dateLabel(trip.endsOn)}</b>
                      </td>
                      <td data-label="Gruppi" className="numberCell">
                        {trip.partyCount}
                      </td>
                      <td data-label="Azioni">
                        <div className="tableActions inline">{open(trip)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tripAdminGrid cards">
            {filtered.map((trip) => {
              const status = tripStatus(trip);
              return (
                <article className="tripAdminCard journeyCard" key={trip.id}>
                  <div className="tripCardTop">
                    <span className={`status ${status.className}`}>{status.label}</span>
                  </div>
                  <h3>{trip.title}</h3>
                  <p>{trip.destinationCountry}</p>
                  <div className="tripDates">
                    <span>
                      <small>PARTENZA</small>
                      <b>{dateLabel(trip.startsOn)}</b>
                    </span>
                    <span>
                      <small>RIENTRO</small>
                      <b>{dateLabel(trip.endsOn)}</b>
                    </span>
                  </div>
                  <div className="journeyCardFacts">
                    <span>
                      <UsersRound />
                      <small>GRUPPI</small>
                      <b>{trip.partyCount}</b>
                    </span>
                    <span>
                      <UsersRound />
                      <small>VIAGGIATORI</small>
                      <b>{trip.travelerNames.length}</b>
                    </span>
                  </div>
                  <div className="journeyTravelers">
                    <small>PARTECIPANTI</small>
                    <p>{trip.travelerNames.join(", ") || "Nessun viaggiatore configurato"}</p>
                  </div>
                  <div className="tableActions inline">{open(trip)}</div>
                </article>
              );
            })}
          </div>
        )}
        {!filtered.length && (
          <div className="agencyEmpty">
            <p>
              {trips.length
                ? "Nessun viaggio corrisponde ai filtri selezionati."
                : "Nessun viaggio assegnato disponibile."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
