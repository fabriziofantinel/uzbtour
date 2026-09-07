"use client";

import { useState } from "react";
import { CheckCircle2, Link2, LoaderCircle, Save } from "lucide-react";

export default function PostTripSettings({ agencyId, initialUrl }: { agencyId: string; initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/platform/agency/post-trip-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencyId, publicReviewUrl: url.trim() }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Impostazioni non salvate");
      setMessage("Indirizzo salvato.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impostazioni non salvate");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="postTripSettings">
      <div>
        <Link2 />
        <span>
          <h4>Recensione pubblica</h4>
          <p>
            Dopo un voto da 9 a 10, il viaggiatore può aprire questo indirizzo oppure condividere il proprio codice
            passaparola.
          </p>
        </span>
      </div>
      <label>
        <span>Pagina recensioni dell’agenzia</span>
        <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
      </label>
      <button type="button" disabled={busy} onClick={() => void save()}>
        {busy ? <LoaderCircle className="spin" /> : <Save />} Salva
      </button>
      {message && (
        <small role="status">
          <CheckCircle2 /> {message}
        </small>
      )}
    </section>
  );
}
