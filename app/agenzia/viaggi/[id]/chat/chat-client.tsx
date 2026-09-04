"use client";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import OperationalChat from "@/components/operational-chat";
import AgencyManagementNav from "@/components/agency-management-nav";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";
type Data = Awaited<ReturnType<typeof getJourneyManagement>>;
export default function AgencyOperationalChat({ data }: { data: Data }) {
  const groups = data.groups.map((group) => ({ id: group.id, name: group.name, travelers: group.travelers })),
    [scope, setScope] = useState<"trip" | "group" | "traveler">("trip"),
    [selected, setSelected] = useState(groups[0]?.id || ""),
    [traveler, setTraveler] = useState(groups[0]?.travelers[0]?.id || "");
  return (
    <main className="journeyManagePage">
      <AgencyManagementNav departureId={data.journey.id} activeTab="chat" journeyTitle={data.journey.agencyName} />
      <section className="journeyManageHero">
        <h1>Chat operativa</h1>
        <p>Conversazioni distinte per viaggio, gruppo e singolo viaggiatore.</p>
      </section>
      <div className="journeyManageShell">
        {groups.length ? (
          <>
            <label className="agencyChatGroup">
              Livello
              <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
                <option value="trip">Viaggio</option>
                <option value="group">Gruppo</option>
                <option value="traveler">Viaggiatore</option>
              </select>
            </label>
            {scope !== "trip" && (
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
            <OperationalChat
              departureId={data.journey.id}
              partyId={scope === "trip" ? undefined : selected}
              travelerId={scope === "traveler" ? traveler : undefined}
              scope={scope}
            />
          </>
        ) : (
          <section className="agencyChatEmpty">
            <MessageCircle />
            <h2>Nessun gruppo disponibile</h2>
            <p>Crea prima un gruppo per aprire una conversazione.</p>
          </section>
        )}
      </div>
    </main>
  );
}
