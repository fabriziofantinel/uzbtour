"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, BookOpen, FolderOpen, MessageCircle, Send, Settings2, UsersRound } from "lucide-react";
import OperationalChat from "@/components/operational-chat";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";
type Data = Awaited<ReturnType<typeof getJourneyManagement>>;
export default function AgencyOperationalChat({ data }: { data: Data }) {
  const groups = data.families.map((group) => ({ id: group.id, name: group.name })),
    [selected, setSelected] = useState(groups[0]?.id || "");
  return (
    <main className="journeyManagePage">
      <header>
        <Link href="/agenzia">
          <ArrowLeft /> Tutti i viaggi
        </Link>
        <nav aria-label="Gestione del viaggio">
          <Link href={`/agenzia/viaggi/${data.journey.id}/programma`}>
            <BookOpen /> Programma
          </Link>
          <Link href={`/agenzia/viaggi/${data.journey.id}`}>
            <UsersRound /> Gruppi
          </Link>
          <Link href={`/agenzia/viaggi/${data.journey.id}/documenti`}>
            <FolderOpen /> Documenti
          </Link>
          <span aria-current="page">
            <MessageCircle /> Chat
          </span>
          <Link href={`/agenzia/viaggi/${data.journey.id}/comunicazioni`}>
            <Send /> Comunicazioni
          </Link>
          <Link href={`/agenzia/viaggi/${data.journey.id}/impostazioni`}>
            <Settings2 /> Configurazione
          </Link>
        </nav>
        <span className="journeyAgencyName">{data.journey.agencyName}</span>
      </header>
      <section className="journeyManageHero">
        <h1>Chat operativa</h1>
        <p>Conversazioni separate per ciascun gruppo del viaggio.</p>
      </section>
      <div className="journeyManageShell">
        {selected ? (
          <>
            <label className="agencyChatGroup">
              Conversazione
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <OperationalChat departureId={data.journey.id} partyId={selected} />
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
