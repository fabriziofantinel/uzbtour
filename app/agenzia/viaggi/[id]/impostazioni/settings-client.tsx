"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  FileText,
  FolderOpen,
  LoaderCircle,
  MessageCircle,
  Plus,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import { uploadPrivateFile } from "@/lib/private-upload-client";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";
import type { readDepartureInsurance } from "@/lib/platform/departure-operations";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";

type Insurance = Awaited<ReturnType<typeof readDepartureInsurance>>;
type Profile = "essential" | "standard" | "complete";
type Guarantee = { label: string; status: "included" | "excluded" | "not_indicated"; notes: string };

async function json<T>(response: Response) {
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
  return result;
}

export default function DepartureSettingsClient({
  journey,
  initialProfile,
  initialInsurance,
}: {
  journey: Awaited<ReturnType<typeof getJourneyManagement>>;
  initialProfile: Profile;
  initialInsurance: Insurance;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [insurance, setInsurance] = useState(initialInsurance);
  const [document, setDocument] = useState<{ id: string | null; title: string | null }>({
    id: initialInsurance?.documentId ?? null,
    title: initialInsurance?.documentTitle ?? null,
  });
  const [guarantees, setGuarantees] = useState<Guarantee[]>(
    (initialInsurance?.guarantees as Guarantee[] | undefined) ?? [],
  );
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const color = validBrandColor(journey.journey.agencyPrimaryColor);
  const style = {
    "--agency-ui": color,
    "--agency-ui-ink": "#111111",
    "--smf-brand": color,
    "--smf-focus": accessibleBrandColor(color),
  } as CSSProperties;

  async function updateProfile(nextProfile: Profile) {
    setBusy("profile");
    setMessage(null);
    try {
      const result = await json<{ profile: Profile; enrichmentJob: { id: string } | null }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "profile", profile: nextProfile }),
        }),
      );
      setProfile(result.profile);
      setMessage({
        kind: "success",
        text: result.enrichmentJob
          ? "Profilo aggiornato. La generazione dei contenuti mancanti è stata avviata; i risultati esistenti sono conservati."
          : "Profilo esperienza aggiornato. I risultati esistenti sono conservati.",
      });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Aggiornamento non riuscito" });
    } finally {
      setBusy("");
    }
  }

  async function uploadDocument(file: File) {
    setBusy("upload");
    setMessage(null);
    try {
      const uploaded = await uploadPrivateFile({
        endpoint: `/api/admin/platform/departures/${journey.journey.id}/insurance/upload`,
        file,
        payload: {},
      });
      const result = await json<{ documentId: string; title: string }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/insurance/document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectKey: uploaded.key,
            originalName: file.name,
            contentType: uploaded.contentType,
          }),
        }),
      );
      setDocument({ id: result.documentId, title: result.title });
      setMessage({ kind: "success", text: "Documento assicurativo caricato. Salva la polizza per collegarlo." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Caricamento non riuscito" });
    } finally {
      setBusy("");
    }
  }

  async function saveInsurance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("insurance");
    setMessage(null);
    try {
      const result = await json<{ insurance: Insurance }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "insurance",
            providerName: form.get("providerName"),
            productName: form.get("productName"),
            policyNumber: form.get("policyNumber"),
            assistancePhone: form.get("assistancePhone"),
            validFrom: form.get("validFrom"),
            validTo: form.get("validTo"),
            guarantees,
            documentId: document.id,
          }),
        }),
      );
      setInsurance(result.insurance);
      setMessage({ kind: "success", text: "Polizza salvata e resa disponibile ai viaggiatori." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Salvataggio non riuscito" });
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="departureSettingsPage" style={style}>
      <header className="journeyOpsHeader">
        <Link href="/agenzia">
          <ArrowLeft /> Tutti i viaggi
        </Link>
        <nav aria-label="Gestione del viaggio">
          <Link href={`/agenzia/viaggi/${journey.journey.id}/programma`}>
            <BookOpen /> Programma
          </Link>
          <Link href={`/agenzia/viaggi/${journey.journey.id}`}>
            <UsersRound /> Gruppi
          </Link>
          <Link href={`/agenzia/viaggi/${journey.journey.id}/documenti`}>
            <FolderOpen /> Documenti
          </Link>
          <Link href={`/agenzia/viaggi/${journey.journey.id}/chat`}>
            <MessageCircle /> Chat
          </Link>
          <Link href={`/agenzia/viaggi/${journey.journey.id}/comunicazioni`}>
            <Send /> Comunicazioni
          </Link>
          <span aria-current="page">
            <Settings2 /> Configurazione
          </span>
        </nav>
      </header>
      <section className="communicationsHero">
        <small>CONFIGURAZIONE PARTENZA</small>
        <h1>{journey.journey.title}</h1>
        <p>Definisci l’esperienza del viaggiatore e i riferimenti assicurativi reali della partenza.</p>
      </section>
      <div className="settingsShell">
        {message && (
          <div className={`agencyMessage ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.kind === "error" ? <CircleAlert /> : <CheckCircle2 />}
            {message.text}
          </div>
        )}
        <section className="profileSettings">
          <div>
            <small>ESPERIENZA</small>
            <h2>Livello di coinvolgimento</h2>
            <p>Riducendo il livello i risultati già ottenuti non vengono cancellati.</p>
          </div>
          <div className="profileCards">
            {(
              [
                ["essential", "Essenziale", "Programma, mappa, documenti, informazioni utili, chat, SOS e spese."],
                ["standard", "Standard", "Tutto Essenziale, più quiz e ricordi."],
                ["complete", "Completo", "Tutto Standard, più missioni, bingo, giochi e contest."],
              ] as const
            ).map(([value, label, description]) => (
              <button
                key={value}
                type="button"
                className={profile === value ? "selected" : ""}
                disabled={Boolean(busy)}
                onClick={() => void updateProfile(value)}
              >
                <b>{label}</b>
                <span>{description}</span>
                {profile === value && <CheckCircle2 />}
              </button>
            ))}
          </div>
        </section>
        <form className="insuranceSettings" onSubmit={saveInsurance}>
          <div className="sectionIntro">
            <ShieldCheck />
            <span>
              <small>ASSICURAZIONE</small>
              <h2>Polizza della partenza</h2>
              <p>I dati non sono generati dall’intelligenza artificiale.</p>
            </span>
          </div>
          <label>
            Compagnia
            <input name="providerName" required maxLength={180} defaultValue={insurance?.providerName ?? ""} />
          </label>
          <label>
            Prodotto
            <input name="productName" maxLength={180} defaultValue={insurance?.productName ?? ""} />
          </label>
          <label>
            Numero polizza
            <input name="policyNumber" required maxLength={120} defaultValue={insurance?.policyNumber ?? ""} />
          </label>
          <label>
            Telefono centrale operativa
            <input
              name="assistancePhone"
              type="tel"
              required
              maxLength={80}
              defaultValue={insurance?.assistancePhone ?? ""}
            />
          </label>
          <label>
            Valida dal
            <input
              name="validFrom"
              type="date"
              required
              defaultValue={insurance?.validFrom ?? journey.journey.startsOn}
            />
          </label>
          <label>
            Valida fino al
            <input name="validTo" type="date" required defaultValue={insurance?.validTo ?? journey.journey.endsOn} />
          </label>
          <div className="guarantees wide">
            <header>
              <span>
                <b>Garanzie</b>
                <small>Indica anche quando una copertura non è specificata.</small>
              </span>
              <button
                type="button"
                onClick={() =>
                  setGuarantees((current) => [...current, { label: "", status: "not_indicated", notes: "" }])
                }
              >
                <Plus /> Aggiungi
              </button>
            </header>
            {guarantees.map((guarantee, index) => (
              <div key={index}>
                <input
                  aria-label={`Garanzia ${index + 1}`}
                  placeholder="Es. Annullamento"
                  value={guarantee.label}
                  onChange={(event) =>
                    setGuarantees((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, label: event.target.value } : item,
                      ),
                    )
                  }
                />
                <select
                  aria-label={`Stato garanzia ${index + 1}`}
                  value={guarantee.status}
                  onChange={(event) =>
                    setGuarantees((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, status: event.target.value as Guarantee["status"] } : item,
                      ),
                    )
                  }
                >
                  <option value="included">Inclusa</option>
                  <option value="excluded">Esclusa</option>
                  <option value="not_indicated">Non indicata</option>
                </select>
                <input
                  aria-label={`Note garanzia ${index + 1}`}
                  placeholder="Note facoltative"
                  value={guarantee.notes}
                  onChange={(event) =>
                    setGuarantees((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, notes: event.target.value } : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={`Elimina garanzia ${index + 1}`}
                  onClick={() => setGuarantees((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
          <div className="insuranceDocument wide">
            <FileText />
            <span>
              <b>{document.title || "Nessun documento contrattuale"}</b>
              <small>PDF, massimo 25 MB. Il documento resterà privato e visibile ai partecipanti.</small>
            </span>
            <label className="uploadButton">
              {busy === "upload" ? <LoaderCircle className="spin" /> : <Upload />} Carica PDF
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={Boolean(busy)}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void uploadDocument(file);
                }}
              />
            </label>
          </div>
          <button className="saveInsurance" type="submit" disabled={Boolean(busy)}>
            {busy === "insurance" ? <LoaderCircle className="spin" /> : <Save />} Salva polizza
          </button>
        </form>
      </div>
    </main>
  );
}
