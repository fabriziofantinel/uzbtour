"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, Camera, Clock3, LoaderCircle, Sparkles, Trophy } from "lucide-react";

type PhotoRanking = {
  photoId: string;
  originalName: string;
  addedBy: string;
  composition: number;
  technical: number;
  storytelling: number;
  originality: number;
  relevance: number;
  total: number;
  rationale: string;
};

type PhotoContest = {
  day: number;
  status: "processing" | "completed" | "failed";
  winnerPhotoId: string | null;
  winnerScore: number | null;
  winnerReason: string | null;
  winnerContentUrl: string | null;
  rankings: PhotoRanking[];
  judgedBy: string;
  model: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage: string | null;
};

type ContestDay = {
  day: number;
  date: string;
  city: string;
  unlockAt: string;
  unlocked: boolean;
  photoCount: number;
  contest: PhotoContest | null;
};

type ContestResponse = {
  isAdmin: boolean;
  days: ContestDay[];
};

async function readResponse(response: Response) {
  const payload = await response.json() as ContestResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Operazione non riuscita");
  return payload;
}

function usePhotoContests() {
  const [data, setData] = useState<ContestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDay, setBusyDay] = useState<number | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setData(await readResponse(await fetch("/api/photo-contest", { cache: "no-store" })));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Concorsi non disponibili");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const judge = useCallback(async (day: number) => {
    if (!confirm("Avviare la giuria AI? Verranno considerate tutte le foto già caricate per questa giornata e il verdetto sarà definitivo.")) return;
    setBusyDay(day);
    setError("");
    try {
      setData(await readResponse(await fetch("/api/photo-contest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day })
      })));
    } catch (judgeError) {
      const message = judgeError instanceof Error ? judgeError.message : "Giuria non disponibile";
      await refresh();
      setError(message);
    } finally {
      setBusyDay(null);
    }
  }, [refresh]);

  return { data, loading, busyDay, error, judge };
}

function WinnerCard({ day }: { day: ContestDay }) {
  const contest = day.contest;
  if (!contest || contest.status !== "completed" || !contest.winnerContentUrl) return null;
  const winner = contest.rankings[0];

  return (
    <article className="photoWinnerCard">
      <div className="photoWinnerImage">
        <Image
          src={contest.winnerContentUrl}
          alt={`Foto vincitrice del giorno ${day.day}`}
          fill
          sizes="(max-width: 700px) 100vw, 420px"
          unoptimized
        />
        <span><Trophy size={14}/> Foto del giorno</span>
      </div>
      <div className="photoWinnerCopy">
        <small>GIORNO {day.day} · {day.date}</small>
        <h3>{day.city}</h3>
        <strong>{contest.winnerScore}/100 punti</strong>
        <p>{contest.winnerReason}</p>
        {winner && <span>Scatto di {winner.addedBy}</span>}
        {winner && (
          <div className="photoScoreGrid" aria-label="Dettaglio del punteggio">
            <span><b>{winner.composition}</b>/25 Composizione</span>
            <span><b>{winner.technical}</b>/20 Tecnica</span>
            <span><b>{winner.storytelling}</b>/25 Racconto</span>
            <span><b>{winner.originality}</b>/15 Originalità</span>
            <span><b>{winner.relevance}</b>/15 Luogo</span>
          </div>
        )}
      </div>
    </article>
  );
}

export function PhotoContestPanel({ day, photoCount }: { day: number; photoCount: number }) {
  const { data, loading, busyDay, error, judge } = usePhotoContests();
  const contestDay = data?.days.find((entry) => entry.day === day);
  if (day < 1 || day > 11) return null;

  const completed = contestDay?.contest?.status === "completed";
  const processing = contestDay?.contest?.status === "processing" || busyDay === day;
  const count = Math.max(photoCount, contestDay?.photoCount ?? 0);

  return (
    <section className="photoContestPanel" aria-label={`Concorso fotografico del giorno ${day}`}>
      <div className="photoContestPanelHead">
        <span><Award size={20}/></span>
        <div>
          <small>CONCORSO FOTOGRAFICO</small>
          <strong>{completed ? "La foto del giorno è stata scelta" : "Quale scatto racconterà meglio la giornata?"}</strong>
        </div>
      </div>

      {loading && <p><LoaderCircle className="spin" size={16}/> Caricamento della giuria…</p>}
      {error && <p className="photoContestError" role="alert">{error}</p>}
      {contestDay?.contest?.status === "failed" && data?.isAdmin && (
        <p className="photoContestError">Il tentativo precedente non è riuscito. Puoi riprovare.</p>
      )}
      {completed && contestDay && <WinnerCard day={contestDay}/>}
      {!completed && !loading && (
        <div className="photoContestAction">
          <span><Camera size={17}/><b>{count}</b> foto pronte per la giuria</span>
          {data?.isAdmin ? (
            <button
              type="button"
              disabled={count === 0 || processing}
              onClick={() => void judge(day)}
            >
              {processing
                ? <><LoaderCircle className="spin" size={17}/> Giuria in corso…</>
                : <><Sparkles size={17}/> Eleggi la foto del giorno</>
              }
            </button>
          ) : (
            <span className="photoContestWaiting"><Clock3 size={15}/> La selezione sarà avviata da Fabrizio</span>
          )}
          {!data?.isAdmin && !contestDay?.unlocked && (
            <small>Disponibile dalle 20:00, ora dell’Uzbekistan, nel giorno della visita.</small>
          )}
          {processing && <small>L’analisi può richiedere alcuni minuti. Non chiudere questa pagina.</small>}
        </div>
      )}
    </section>
  );
}

export function PhotoContestShowcase() {
  const { data, loading, error } = usePhotoContests();
  const winners = useMemo(
    () => data?.days.filter((day) => day.contest?.status === "completed") ?? [],
    [data]
  );

  return (
    <section className="photoContestShowcase">
      <div className="photoContestIntro">
        <span><Award size={22}/></span>
        <div>
          <small>LA GIURIA DI GEMINI</small>
          <h2>Le foto del giorno</h2>
          <p>Composizione, tecnica, racconto, originalità e valorizzazione del luogo: 100 punti per eleggere lo scatto più bello.</p>
        </div>
      </div>
      {loading && <p className="photoContestLoading"><LoaderCircle className="spin" size={17}/> Caricamento dei verdetti…</p>}
      {error && <p className="photoContestError" role="alert">{error}</p>}
      {!loading && winners.length === 0 && (
        <p className="photoContestEmpty">Le vincitrici appariranno qui dopo la prima selezione avviata da Fabrizio.</p>
      )}
      <div className="photoWinnerList">
        {winners.map((winner) => <WinnerCard key={winner.day} day={winner}/>)}
      </div>
    </section>
  );
}
