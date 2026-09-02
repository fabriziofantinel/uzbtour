"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCircle, RefreshCw, Send } from "lucide-react";
type Message = { id: string; senderName: string; senderRole: string; body: string; createdAt: string; isMine: boolean };
export default function OperationalChat({
  departureId,
  partyId,
  travelerId,
  scope = "group",
}: {
  departureId: string;
  partyId?: string;
  travelerId?: string;
  scope?: "trip" | "group" | "traveler";
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setBusy(true);
      try {
        const parameters = new URLSearchParams({ departureId, scope });
        if (partyId) parameters.set("partyId", partyId);
        if (travelerId) parameters.set("travelerId", travelerId);
        const response = await fetch(`/api/chat?${parameters}`, { cache: "no-store" }),
          result = (await response.json()) as { messages?: Message[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Chat non disponibile");
        setMessages(result.messages || []);
        setError("");
      } catch (caught) {
        if (!silent) setError(caught instanceof Error ? caught.message : "Chat non disponibile");
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [departureId, partyId, scope, travelerId],
  );
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            departureId,
            partyId,
            travelerId,
            scope,
            body: text,
            clientOperationId: crypto.randomUUID(),
          }),
        }),
        result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Invio non riuscito");
      setBody("");
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invio non riuscito");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="operationalChat" aria-labelledby="chat-title">
      <header>
        <MessageCircle />
        <div>
          <h2 id="chat-title">
            {scope === "trip" ? "Chat del viaggio" : scope === "group" ? "Chat del gruppo" : "Chat personale"}
          </h2>
          <p>
            {scope === "trip"
              ? "Conversazione condivisa con tutti i partecipanti."
              : scope === "group"
                ? "Messaggi riservati al tuo gruppo e allo staff operativo."
                : "Conversazione privata con lo staff operativo."}
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label="Aggiorna conversazione">
          <RefreshCw />
        </button>
      </header>
      {error && (
        <p className="chatError" role="alert">
          {error}
        </p>
      )}
      <div className="chatHistory" role="log" aria-live="polite" aria-relevant="additions">
        {busy && messages.length === 0 ? (
          <p className="chatEmpty">
            <LoaderCircle className="spin" />
            Caricamento…
          </p>
        ) : messages.length === 0 ? (
          <p className="chatEmpty">Nessun messaggio. Scrivi all’agenzia quando hai bisogno di assistenza.</p>
        ) : (
          messages.map((item) => (
            <article className={item.isMine ? "mine" : ""} key={item.id}>
              <span>
                <strong>{item.senderName}</strong>
                <small>
                  {item.senderRole === "agency" ? "Agenzia" : "Viaggiatore"} ·{" "}
                  {new Intl.DateTimeFormat("it-IT", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(item.createdAt))}
                </small>
              </span>
              <p>{item.body}</p>
            </article>
          ))
        )}
        <div ref={end} />
      </div>
      <form onSubmit={submit}>
        <label htmlFor="chat-message">Messaggio</label>
        <textarea
          id="chat-message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={2000}
          placeholder="Scrivi una domanda o un aggiornamento…"
          required
        />
        <button type="submit" disabled={busy || !body.trim()}>
          {busy ? <LoaderCircle className="spin" /> : <Send />}
          <span>{busy ? "Invio…" : "Invia"}</span>
        </button>
      </form>
    </section>
  );
}
