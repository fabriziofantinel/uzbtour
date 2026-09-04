"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  CheckCircle2,
  CircleAlert,
  FileText,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { uploadPrivateFile } from "@/lib/private-upload-client";
import AgencyManagementNav from "@/components/agency-management-nav";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";
import type { readDepartureInsurance } from "@/lib/platform/departure-operations";
import type { getJourneyManagement } from "@/lib/platform/journey-repository";

type Insurance = Awaited<ReturnType<typeof readDepartureInsurance>>;
type Guarantee = { label: string; status: "included" | "excluded" | "not_indicated"; notes: string };
type AudienceScope = "trip" | "group" | "traveler";

async function json<T>(response: Response) {
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
  return result;
}

export default function DepartureSettingsClient({
  journey,
  initialInsurance,
}: {
  journey: Awaited<ReturnType<typeof getJourneyManagement>>;
  initialInsurance: Insurance;
}) {
  const [insurance, setInsurance] = useState(initialInsurance);
  const groups = useMemo(() => journey.groups, [journey.groups]);
  const [audienceScope, setAudienceScope] = useState<AudienceScope>("trip");
  const [partyId, setPartyId] = useState(groups[0]?.id || "");
  const [travelerId, setTravelerId] = useState(groups[0]?.travelers[0]?.id || "");
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
    "--smf-brand-deep": color,
    "--smf-focus": accessibleBrandColor(color),
  } as CSSProperties;

  useEffect(() => {
    const controller = new AbortController();
    async function loadInsurance() {
      setBusy("load");
      setMessage(null);
      try {
        const params = new URLSearchParams({ audienceScope, partyId, travelerId });
        const result = await json<{ insurance: Insurance }>(
          await fetch(`/api/admin/platform/departures/${journey.journey.id}/settings?${params}`, {
            signal: controller.signal,
          }),
        );
        setInsurance(result.insurance);
        setDocument({ id: result.insurance?.documentId ?? null, title: result.insurance?.documentTitle ?? null });
        setGuarantees((result.insurance?.guarantees as Guarantee[] | undefined) ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Polizza non disponibile" });
      } finally {
        setBusy("");
      }
    }
    void loadInsurance();
    return () => controller.abort();
  }, [audienceScope, journey.journey.id, partyId, travelerId]);

  async function uploadDocument(file: File) {
    setBusy("upload");
    setMessage(null);
    try {
      const uploaded = await uploadPrivateFile({
        endpoint: `/api/admin/platform/departures/${journey.journey.id}/insurance/upload`,
        file,
        payload: { audienceScope, partyId, travelerId },
      });
      const result = await json<{ documentId: string; title: string }>(
        await fetch(`/api/admin/platform/departures/${journey.journey.id}/insurance/document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectKey: uploaded.key,
            originalName: file.name,
            contentType: uploaded.contentType,
            audienceScope,
            partyId,
            travelerId,
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
            audienceScope,
            partyId,
            travelerId,
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
      setMessage({ kind: "success", text: "Polizza salvata per i destinatari selezionati." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Salvataggio non riuscito" });
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="journeyManagePage" style={style}>
      <AgencyManagementNav
        departureId={journey.journey.id}
        activeTab="configurazione"
        journeyTitle={journey.journey.title}
        quoteImportId={journey.journey.quoteImportId}
      />
      <section className="journeyManageHero">
        <small>ASSICURAZIONE</small>
        <h1>{journey.journey.title}</h1>
        <p>Gestisci la polizza del viaggio, di un gruppo o di un singolo viaggiatore.</p>
      </section>
      <div className="settingsShell">
        {message && (
          <div className={`agencyMessage ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.kind === "error" ? <CircleAlert /> : <CheckCircle2 />}
            {message.text}
          </div>
        )}
        <section className="documentAudience insuranceAudience" aria-label="Destinatari della polizza">
          <div className="agencyChatScopes" role="tablist" aria-label="Destinatari della polizza">
            {(
              [
                ["trip", "Viaggio"],
                ["group", "Gruppo"],
                ["traveler", "Viaggiatore"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={audienceScope === value}
                className={audienceScope === value ? "active" : ""}
                onClick={() => setAudienceScope(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {audienceScope !== "trip" && (
            <label className="agencyChatGroup">
              Gruppo
              <select
                value={partyId}
                onChange={(event) => {
                  const next = event.target.value;
                  setPartyId(next);
                  setTravelerId(groups.find((group) => group.id === next)?.travelers[0]?.id || "");
                }}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} · {group.code}
                  </option>
                ))}
              </select>
            </label>
          )}
          {audienceScope === "traveler" && (
            <label className="agencyChatGroup">
              Viaggiatore
              <select value={travelerId} onChange={(event) => setTravelerId(event.target.value)}>
                {groups
                  .find((group) => group.id === partyId)
                  ?.travelers.map((traveler) => (
                    <option key={traveler.id} value={traveler.id}>
                      {traveler.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p>
            {audienceScope === "trip"
              ? "La polizza sarà visibile a tutti i viaggiatori della partenza."
              : audienceScope === "group"
                ? "La polizza sarà visibile solo ai viaggiatori del gruppo selezionato."
                : "La polizza sarà visibile solo al viaggiatore selezionato."}
          </p>
        </section>
        <form
          key={`${audienceScope}-${partyId}-${travelerId}-${insurance?.id ?? "new"}`}
          className="insuranceSettings"
          onSubmit={saveInsurance}
        >
          <div className="sectionIntro">
            <ShieldCheck />
            <span>
              <small>ASSICURAZIONE</small>
              <h2>
                Polizza{" "}
                {audienceScope === "trip"
                  ? "del viaggio"
                  : audienceScope === "group"
                    ? "del gruppo"
                    : "del viaggiatore"}
              </h2>
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
