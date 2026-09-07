"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  HeartHandshake,
  LoaderCircle,
  MessageCircle,
  Send,
  Star,
} from "lucide-react";
import { uuidV7 } from "@/lib/pwa/offline-queue";

type Review = {
  eligible: boolean;
  rating: number | null;
  comment: string;
  referralCode: string;
  publicReviewUrl: string;
  agencyName: string;
  submittedAt: string | null;
};

export default function PostTripReview({
  departureId,
  partyId,
  onOpenChat,
}: {
  departureId: string;
  partyId: string;
  onOpenChat: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/traveler/post-trip-review?departureId=${departureId}&partyId=${partyId}`, { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as Review & { error?: string };
        if (!response.ok) throw new Error(result.error || "Valutazione non disponibile");
        if (active) {
          setReview(result);
          setRating(result.rating);
          setComment(result.comment);
        }
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Valutazione non disponibile"))
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
  }, [departureId, partyId]);

  async function save() {
    if (rating == null) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/traveler/post-trip-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departureId, partyId, rating, comment, clientOperationId: uuidV7() }),
      });
      const result = (await response.json().catch(() => ({}))) as { referralCode?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Valutazione non salvata");
      setReview((current) =>
        current
          ? {
              ...current,
              rating,
              comment,
              referralCode: result.referralCode || current.referralCode,
              submittedAt: new Date().toISOString(),
            }
          : current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Valutazione non salvata");
    } finally {
      setBusy(false);
    }
  }

  if (busy && !review)
    return (
      <section className="postTripReview">
        <p className="postTripLoading">
          <LoaderCircle className="spin" /> Caricamento della valutazione…
        </p>
      </section>
    );
  if (error && !review)
    return (
      <section className="postTripReview">
        <p className="postTripError">{error}</p>
      </section>
    );
  if (!review?.eligible)
    return (
      <section className="postTripReview">
        <p className="postTripEmpty">La valutazione sarà disponibile due giorni dopo il rientro.</p>
      </section>
    );
  const submitted = review.submittedAt != null;
  const savedRating = review.rating;
  return (
    <section className="postTripReview">
      <header>
        <span>
          <HeartHandshake />
        </span>
        <div>
          <small>DOPO IL RIENTRO</small>
          <h2>Com’è andato il viaggio?</h2>
          <p>Il tuo giudizio aiuta {review.agencyName} a migliorare le prossime partenze.</p>
        </div>
      </header>
      {submitted && (
        <p className="postTripSaved">
          <CheckCircle2 /> Grazie, la tua valutazione è stata registrata. Puoi ancora modificarla.
        </p>
      )}
      <fieldset>
        <legend>Voto complessivo da 0 a 10</legend>
        <div className="postTripScale">
          {Array.from({ length: 11 }, (_, value) => (
            <button
              type="button"
              key={value}
              className={rating === value ? "active" : ""}
              aria-pressed={rating === value}
              onClick={() => setRating(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="postTripScaleLabels">
          <span>Per niente soddisfatto</span>
          <span>Entusiasta</span>
        </div>
      </fieldset>
      <label>
        <span>Commento facoltativo</span>
        <textarea
          rows={4}
          maxLength={2000}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Raccontaci cosa ha funzionato bene e cosa potremmo migliorare."
        />
      </label>
      {error && <p className="postTripError">{error}</p>}
      <button className="postTripSubmit" type="button" disabled={busy || rating == null} onClick={() => void save()}>
        {busy ? <LoaderCircle className="spin" /> : <Send />} {submitted ? "Aggiorna valutazione" : "Invia valutazione"}
      </button>
      {submitted && savedRating != null && savedRating >= 9 && (
        <section className="postTripAdvocacy">
          <Star />
          <div>
            <h3>Vuoi consigliare questo viaggio?</h3>
            <p>Puoi lasciare una recensione pubblica oppure condividere il tuo codice con un amico.</p>
            <div>
              {review.publicReviewUrl && (
                <a href={review.publicReviewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink /> Lascia una recensione
                </a>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (navigator.clipboard) await navigator.clipboard.writeText(review.referralCode);
                  setCopied(true);
                }}
              >
                <Copy /> {copied ? "Codice copiato" : `Copia ${review.referralCode}`}
              </button>
            </div>
          </div>
        </section>
      )}
      {submitted && savedRating != null && savedRating <= 6 && (
        <section className="postTripPrivate">
          <MessageCircle />
          <div>
            <h3>Parliamone in privato</h3>
            <p>Il commento resta visibile all’agenzia. Se vuoi aggiungere dettagli, apri la chat personale.</p>
            <button type="button" onClick={onOpenChat}>
              <MessageCircle /> Apri la chat con l’agenzia
            </button>
          </div>
        </section>
      )}
      {submitted && savedRating != null && savedRating >= 7 && savedRating <= 8 && (
        <p className="postTripNeutral">Grazie: useremo il tuo commento per migliorare l’esperienza.</p>
      )}
    </section>
  );
}
