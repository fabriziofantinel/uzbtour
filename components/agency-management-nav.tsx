"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  ClipboardCheck,
  FileText,
  FolderOpen,
  MessageCircle,
  Send,
  Settings2,
  UsersRound,
  Download,
} from "lucide-react";
import type { ReactNode } from "react";

type Tab = "programma" | "gruppi" | "documenti" | "chat" | "comunicazioni" | "operativita" | "configurazione";

type Props = {
  departureId: string;
  activeTab: Tab;
  quoteImportId?: string | null;
  className?: string;
  showOperations?: boolean;
  journeyTitle?: string | null;
  rightSlot?: ReactNode;
  staffView?: boolean;
  staffRole?: "agent" | "accompagnatore" | "guida" | null;
};

export default function AgencyManagementNav({
  departureId,
  activeTab,
  quoteImportId,
  className,
  showOperations = true,
  journeyTitle,
  rightSlot,
  staffView = false,
  staffRole = null,
}: Props) {
  if (staffView) {
    const staffHref = (path: string) => `${path}?scope=traveler-staff`;
    return (
      <header className={className}>
        <Link href="/tour-leader">
          <ArrowLeft /> Tutti i viaggi
        </Link>
        <nav aria-label="Gestione del viaggio">
          <Link
            href={staffHref(`/agenzia/viaggi/${departureId}/programma`)}
            aria-current={activeTab === "programma" ? "page" : undefined}
          >
            <BookOpen /> Programma
          </Link>
          {staffRole !== "guida" &&
            (activeTab === "documenti" ? (
              <span aria-current="page">
                <FolderOpen /> Documenti
              </span>
            ) : (
              <Link href={staffHref(`/agenzia/viaggi/${departureId}/documenti`)}>
                <FolderOpen /> Documenti
              </Link>
            ))}
          {staffRole !== "guida" &&
            (activeTab === "chat" ? (
              <span aria-current="page">
                <MessageCircle /> Chat
              </span>
            ) : (
              <Link href={staffHref(`/agenzia/viaggi/${departureId}/chat`)}>
                <MessageCircle /> Chat
              </Link>
            ))}
          {staffRole !== "guida" &&
            (activeTab === "comunicazioni" ? (
              <span aria-current="page">
                <Send /> Comunicazioni
              </span>
            ) : (
              <Link href={staffHref(`/agenzia/viaggi/${departureId}/comunicazioni`)}>
                <Send /> Comunicazioni
              </Link>
            ))}
          {showOperations &&
            (activeTab === "operativita" ? (
              <span aria-current="page">
                <ClipboardCheck /> Presenze e Segnalazioni
              </span>
            ) : (
              <Link href={staffHref(`/agenzia/viaggi/${departureId}/operativita`)}>
                <ClipboardCheck /> Presenze e Segnalazioni
              </Link>
            ))}
        </nav>
        <span className="journeyAgencyName">{journeyTitle || rightSlot}</span>
      </header>
    );
  }
  return (
    <header className={className}>
      <Link href="/agenzia">
        <ArrowLeft /> Tutti i viaggi
      </Link>
      <nav aria-label="Gestione del viaggio">
        {activeTab === "programma" ? (
          <span aria-current="page">
            <BookOpen /> Programma
          </span>
        ) : (
          <Link href={`/agenzia/viaggi/${departureId}/programma`}>
            <BookOpen /> Programma
          </Link>
        )}
        {activeTab === "gruppi" ? (
          <span aria-current="page">
            <UsersRound /> Gruppi
          </span>
        ) : (
          <Link href={`/agenzia/viaggi/${departureId}`}>
            <UsersRound /> Gruppi
          </Link>
        )}
        {activeTab === "documenti" ? (
          <span aria-current="page">
            <FolderOpen /> Documenti
          </span>
        ) : (
          <Link href={`/agenzia/viaggi/${departureId}/documenti`}>
            <FolderOpen /> Documenti
          </Link>
        )}
        {activeTab === "chat" ? (
          <span aria-current="page">
            <MessageCircle /> Chat
          </span>
        ) : (
          <Link href={`/agenzia/viaggi/${departureId}/chat`}>
            <MessageCircle /> Chat
          </Link>
        )}
        {activeTab === "comunicazioni" ? (
          <span aria-current="page">
            <Send /> Comunicazioni
          </span>
        ) : (
          <Link href={`/agenzia/viaggi/${departureId}/comunicazioni`}>
            <Send /> Comunicazioni
          </Link>
        )}
        {showOperations &&
          (activeTab === "operativita" ? (
            <span aria-current="page">
              <ClipboardCheck /> Operatività
            </span>
          ) : (
            <Link href={`/agenzia/viaggi/${departureId}/operativita`}>
              <ClipboardCheck /> Operatività
            </Link>
          ))}
        {activeTab === "configurazione" ? (
          <span aria-current="page">
            <Settings2 /> Assicurazione
          </span>
        ) : (
          <Link href={`/agenzia/viaggi/${departureId}/impostazioni`}>
            <Settings2 /> Assicurazione
          </Link>
        )}
        <details className="programmeQuotes">
          <summary>
            <FileText /> Preventivi
          </summary>
          <div>
            {quoteImportId ? (
              <>
                <a href={`/api/admin/platform/imports/${quoteImportId}/original`}>
                  <FileText /> Originale
                </a>
                <a href={`/api/admin/platform/imports/${quoteImportId}/normalized`}>
                  <Download /> Revisionato DOCX
                </a>
              </>
            ) : (
              <span>Nessun preventivo disponibile per questa partenza.</span>
            )}
          </div>
        </details>
      </nav>
      <span className="journeyAgencyName">{journeyTitle || rightSlot}</span>
    </header>
  );
}
