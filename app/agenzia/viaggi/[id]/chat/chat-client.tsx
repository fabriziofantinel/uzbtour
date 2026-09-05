"use client";
import { useState, type CSSProperties } from "react";
import OperationalChat from "@/components/operational-chat";
import AgencyManagementNav from "@/components/agency-management-nav";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";
type Data = Awaited<ReturnType<typeof getJourneyManagement>>;
export default function AgencyOperationalChat({
  data,
  staff,
  actorUserId,
  showOperations = true,
}: {
  data: Data;
  staff: { userId: string; name: string; role: string }[];
  actorUserId: string;
  showOperations?: boolean;
}) {
  const [staffUserId, setStaffUserId] = useState("");
  const color = validBrandColor(data.journey.agencyPrimaryColor);
  const style = {
    "--agency-ui": color,
    "--agency-ui-ink": "#111111",
    "--smf-brand": color,
    "--smf-brand-deep": color,
    "--smf-action": color,
    "--smf-focus": accessibleBrandColor(color),
  } as CSSProperties;
  const groups = data.groups.map((group) => ({ id: group.id, name: group.name, travelers: group.travelers })),
    [scope, setScope] = useState<"trip" | "group" | "traveler" | "accompagnatore" | "guida">("trip"),
    [selected, setSelected] = useState(groups[0]?.id || ""),
    [traveler, setTraveler] = useState(groups[0]?.travelers[0]?.id || "");
  return (
    <main className="journeyManagePage" style={style}>
      <AgencyManagementNav
        departureId={data.journey.id}
        activeTab="chat"
        journeyTitle={data.journey.title}
        quoteImportId={data.journey.quoteImportId}
        showOperations={showOperations}
        staffView
      />
      <section className="journeyManageHero">
        <h1>{data.journey.title}</h1>
        <p>Conversazioni distinte per viaggio, gruppo e singolo viaggiatore.</p>
      </section>
      <div className="journeyManageShell">
        <>
          <div className="agencyChatScopes" role="tablist" aria-label="Chat visualizzata">
            {(
              [
                ["trip", "Viaggio"],
                ["group", "Gruppo"],
                ["traveler", "Viaggiatore"],
                ["accompagnatore", "Accompagnatore"],
                ["guida", "Guida"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                className={scope === value ? "active" : ""}
                onClick={() => {
                  setScope(value);
                  setStaffUserId("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {["group", "traveler"].includes(scope) && (
            <label className="agencyChatGroup">
              Gruppo
              <select
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setTraveler(groups.find((group) => group.id === event.target.value)?.travelers[0]?.id || "");
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
          {scope === "traveler" && (
            <label className="agencyChatGroup">
              Viaggiatore
              <select value={traveler} onChange={(event) => setTraveler(event.target.value)}>
                {groups
                  .find((group) => group.id === selected)
                  ?.travelers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {(scope === "accompagnatore" || scope === "guida") && (
            <label className="agencyChatGroup">
              {scope === "guida" ? "Guida" : "Accompagnatore"}
              <select value={staffUserId} onChange={(event) => setStaffUserId(event.target.value)}>
                <option value="">Seleziona una persona associata al viaggio</option>
                {staff
                  .filter(
                    (person) =>
                      person.userId !== actorUserId &&
                      (person.role === scope || (scope === "accompagnatore" && person.role === "tour_leader")),
                  )
                  .map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <OperationalChat
            awaitingRecipient={(scope === "accompagnatore" || scope === "guida") && !staffUserId}
            key={`${scope}-${selected}-${traveler}-${staffUserId}`}
            staffUserId={staffUserId || undefined}
            departureId={data.journey.id}
            partyId={["group", "traveler"].includes(scope) ? selected : undefined}
            travelerId={scope === "traveler" ? traveler : undefined}
            scope={scope}
          />
        </>
      </div>
    </main>
  );
}
