"use client";

import { useState } from "react";
import {
  BedDouble,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Download,
  Plus,
  Save,
  Trash2,
  UsersRound,
} from "lucide-react";
import AgencyManagementNav from "@/components/agency-management-nav";
import { validBrandColor } from "@/lib/platform/branding-ui";
import type { RoomingListData, RoomingRoom, RoomType } from "@/lib/platform/rooming-list";

const capacity: Record<RoomType, number> = { single: 1, double: 2, matrimonial: 2, triple: 3 };
const labels: Record<RoomType, string> = {
  single: "Singola",
  double: "Doppia",
  matrimonial: "Matrimoniale",
  triple: "Tripla",
};

function formatNightDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatBirthDate(value: string) {
  if (!value) return "data non disponibile";
  return new Intl.DateTimeFormat("it-IT").format(new Date(`${value}T12:00:00`));
}

export default function RoomingListClient({
  initialData,
  staffRole,
}: {
  initialData: RoomingListData;
  staffRole: "agent" | "accompagnatore" | "guida" | null;
}) {
  const [rooms, setRooms] = useState(initialData.rooms);
  const [stayId, setStayId] = useState(initialData.stays[0]?.id ?? "");
  const [partyId, setPartyId] = useState(initialData.groups[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const primary = validBrandColor(initialData.departure.agencyPrimaryColor);
  const style = {
    "--agency-ui": primary,
    "--smf-brand": primary,
    "--smf-brand-deep": primary,
  } as React.CSSProperties;
  const stay = initialData.stays.find((item) => item.id === stayId);
  const group = initialData.groups.find((item) => item.id === partyId);
  const visibleRooms = rooms.filter((room) => room.stayId === stayId && room.partyId === partyId);
  const assigned = new Set(visibleRooms.flatMap((room) => room.occupantIds));
  const unassigned = group?.travelers.filter((traveler) => !assigned.has(traveler.id)) ?? [];
  const errors = visibleRooms.flatMap((room) => {
    const occupants = group?.travelers.filter((traveler) => room.occupantIds.includes(traveler.id)) ?? [];
    const messages: string[] = [];
    if (occupants.length > capacity[room.type])
      messages.push(`${room.label}: troppi occupanti per una ${labels[room.type].toLowerCase()}.`);
    if (
      occupants.some((item) => item.memberType === "dependent_minor") &&
      !occupants.some((item) => item.memberType === "adult")
    )
      messages.push(`${room.label}: un minore deve essere assegnato con almeno un adulto del gruppo.`);
    return messages;
  });

  function updateRoom(id: string, changes: Partial<RoomingRoom>) {
    setRooms((current) => current.map((room) => (room.id === id ? { ...room, ...changes } : room)));
    setMessage(null);
  }

  function addRoom() {
    setRooms((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        stayId,
        partyId,
        label: `Camera ${visibleRooms.length + 1}`,
        type: "double",
        specialRequirements: "",
        occupantIds: [],
      },
    ]);
  }

  async function save() {
    if (!stayId || !partyId || errors.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/platform/departures/${initialData.departure.id}/rooming-list`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stayId, partyId, rooms: visibleRooms }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Salvataggio non riuscito");
      setMessage({ kind: "success", text: "Rooming list salvata." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Salvataggio non riuscito" });
    } finally {
      setBusy(false);
    }
  }

  async function downloadRoomingList() {
    if (!stayId || downloading) return;
    setDownloading(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/platform/departures/${initialData.departure.id}/rooming-list/export?stayId=${stayId}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || "Download del documento non riuscito");
      }
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!contentType.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
        throw new Error("Il server non ha restituito un documento DOCX valido. Riprova.");
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("Il documento generato è vuoto. Riprova.");

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const headerFilename = disposition.match(/filename="([^"]+)"/i)?.[1];
      const fallbackHotel = (stay?.hotelName || "hotel")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      const filename = headerFilename || `rooming-list-${fallbackHotel || "hotel"}.docx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({ kind: "success", text: "Documento DOCX scaricato." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Download del documento non riuscito",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="journeyManagePage roomingPage" style={style}>
      <AgencyManagementNav
        className="programmeTopbar"
        departureId={initialData.departure.id}
        activeTab="rooming"
        journeyTitle={initialData.departure.agencyName}
        staffView={staffRole != null}
        staffRole={staffRole}
      />
      <section className="journeyManageHero">
        <small>PRIMA DELLA PARTENZA</small>
        <h1>{initialData.departure.title}</h1>
        <p>
          <BedDouble /> Assegna i viaggiatori alle camere di ogni pernottamento.
        </p>
      </section>
      <div className="roomingShell">
        <section className="roomingSelectors" aria-label="Hotel e gruppo">
          <label>
            <span>
              <CalendarDays /> Hotel
            </span>
            <select
              value={stayId}
              onChange={(event) => {
                setStayId(event.target.value);
                setMessage(null);
              }}
            >
              {initialData.stays.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.hotelName} · {item.nights.length} {item.nights.length === 1 ? "notte" : "notti"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              <UsersRound /> Gruppo
            </span>
            <select
              value={partyId}
              onChange={(event) => {
                setPartyId(event.target.value);
                setMessage(null);
              }}
            >
              {initialData.groups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {stayId && (
            <button
              type="button"
              className="roomingExport"
              disabled={downloading}
              onClick={() => void downloadRoomingList()}
            >
              <Download /> {downloading ? "Preparazione DOCX…" : "Scarica DOCX per l’hotel"}
            </button>
          )}
        </section>

        {stay && (
          <section className="roomingNights" aria-label={`Notti presso ${stay.hotelName}`}>
            <header>
              <BedDouble />
              <div>
                <strong>{stay.hotelName}</strong>
                <span>
                  {stay.nights.length} {stay.nights.length === 1 ? "notte inclusa" : "notti incluse"} nella stessa
                  soluzione camere
                </span>
              </div>
            </header>
            <div className="roomingNightDates">
              {stay.nights.map((night, index) => (
                <span key={night.id}>
                  <b>Notte {index + 1}</b>
                  {formatNightDate(night.nightDate)} → {formatNightDate(night.checkoutDate)}
                </span>
              ))}
            </div>
          </section>
        )}

        {!initialData.stays.length || !initialData.groups.length ? (
          <section className="roomingEmpty">
            Servono almeno un pernottamento e un gruppo per preparare la rooming list.
          </section>
        ) : (
          <>
            <section className={`roomingCoverage ${unassigned.length ? "warning" : "complete"}`}>
              {unassigned.length ? <CircleAlert /> : <CheckCircle2 />}
              <div>
                <strong>
                  {unassigned.length
                    ? `${unassigned.length} viaggiatori ancora da assegnare`
                    : "Tutti i viaggiatori sono assegnati"}
                </strong>
                {unassigned.length > 0 && <span>{unassigned.map((item) => item.name).join(", ")}</span>}
              </div>
            </section>
            {errors.map((error) => (
              <p className="roomingError" role="alert" key={error}>
                <CircleAlert /> {error}
              </p>
            ))}
            {message && (
              <p className={`roomingMessage ${message.kind}`} role="status">
                {message.kind === "success" ? <CheckCircle2 /> : <CircleAlert />}
                {message.text}
              </p>
            )}
            <section className="roomingRooms">
              <header>
                <div>
                  <h2>{stay?.hotelName}</h2>
                  <p>
                    {group?.name} · {visibleRooms.length} {visibleRooms.length === 1 ? "camera" : "camere"}
                  </p>
                </div>
                <button type="button" onClick={addRoom}>
                  <Plus /> Nuova camera
                </button>
              </header>
              {visibleRooms.length === 0 && (
                <p className="roomingEmpty">Nessuna camera configurata per questo gruppo.</p>
              )}
              {visibleRooms.map((room) => (
                <article className="roomingRoom" key={room.id}>
                  <div className="roomingRoomHead">
                    <label>
                      <span>Camera</span>
                      <input
                        value={room.label}
                        maxLength={120}
                        onChange={(event) => updateRoom(room.id, { label: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Tipologia</span>
                      <select
                        value={room.type}
                        onChange={(event) => updateRoom(room.id, { type: event.target.value as RoomType })}
                      >
                        {Object.entries(labels).map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="roomingDelete"
                      onClick={() => setRooms((current) => current.filter((item) => item.id !== room.id))}
                      aria-label={`Elimina ${room.label}`}
                    >
                      <Trash2 /> Elimina
                    </button>
                  </div>
                  <fieldset>
                    <legend>Chi dorme in questa camera</legend>
                    <div className="roomingTravelers">
                      {group?.travelers.map((traveler) => {
                        const checked = room.occupantIds.includes(traveler.id);
                        const usedElsewhere = !checked && assigned.has(traveler.id);
                        return (
                          <label
                            key={traveler.id}
                            className={`${usedElsewhere ? "disabled" : ""} ${
                              traveler.memberType === "dependent_minor" ? "minor" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={usedElsewhere}
                              onChange={(event) =>
                                updateRoom(room.id, {
                                  occupantIds: event.target.checked
                                    ? [...room.occupantIds, traveler.id]
                                    : room.occupantIds.filter((id) => id !== traveler.id),
                                })
                              }
                            />
                            <span>
                              {traveler.name}
                              <small>
                                <b>{traveler.memberType === "dependent_minor" ? "MINORE" : "Adulto"}</b>
                                Nato/a il {formatBirthDate(traveler.birthDate)}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <label className="roomingNeeds">
                    <span>Esigenze per l’hotel</span>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={room.specialRequirements}
                      placeholder="Esempio: letti separati, culla, camera accessibile"
                      onChange={(event) => updateRoom(room.id, { specialRequirements: event.target.value })}
                    />
                  </label>
                </article>
              ))}
              <footer className="roomingActions">
                <span>Il documento non include numeri di documento o altri dati sensibili.</span>
                <button type="button" disabled={busy || errors.length > 0} onClick={() => void save()}>
                  <Save /> {busy ? "Salvataggio…" : "Salva rooming list"}
                </button>
              </footer>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
