"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, ChevronRight, Crown, Gamepad2, Grid3X3,
  ListOrdered, LoaderCircle, RotateCcw, Send, Sparkles, Trophy
} from "lucide-react";
import { gameDays, normalizeGameAnswer, type GameDay } from "@/lib/game-data";

type GameName = "word" | "order" | "puzzle";
type Scores = { word: number; order: number; puzzle: number; total: number };
type GameResponse = {
  currentUser: { id: string; name: string; initials: string };
  isAdmin: boolean;
  days: Array<{
    day: number;
    unlocked: boolean;
    scores: Scores;
    ranking: Array<{ name: string } & Scores>;
  }>;
  totals: Array<{ name: string; initials: string; score: number; completed: number }>;
};
type Photo = { id: string; day: number; contentUrl: string; originalName: string };

const APP_ICON_PHOTO: Photo = {
  id: "app-icon",
  day: 0,
  contentUrl: "/app-icon.svg",
  originalName: "Icona UZB Tour"
};

async function readResponse<T>(response: Response) {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Operazione non riuscita");
  return payload;
}

function shufflePhotos(input: Photo[]) {
  const photos = [...input];
  for (let cursor = photos.length - 1; cursor > 0; cursor -= 1) {
    const randomIndex = Math.floor(Math.random() * (cursor + 1));
    [photos[cursor], photos[randomIndex]] = [photos[randomIndex], photos[cursor]];
  }
  return photos;
}

function WordGame({
  day,
  savedScore,
  onScore
}: {
  day: GameDay;
  savedScore: number;
  onScore: (game: GameName, score: number) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const score = day.words.reduce(
    (total, word, index) => total + (
      normalizeGameAnswer(answers[index]) === normalizeGameAnswer(word.answer) ? 10 : 0
    ),
    0
  );

  async function verify() {
    setChecked(true);
    setSaving(true);
    await onScore("word", score);
    setSaving(false);
  }

  return (
    <article className="dailyGameCard">
      <header><span><Sparkles size={20}/></span><div><small>30 PUNTI</small><h3>Cruciparola del giorno</h3></div><b>{savedScore}/30</b></header>
      <p>Risolvi le tre definizioni. Spazi, accenti e maiuscole non contano.</p>
      <div className="wordGameFields">
        {day.words.map((word, index) => {
          const correct = checked && normalizeGameAnswer(answers[index]) === normalizeGameAnswer(word.answer);
          return (
            <label key={word.clue} className={checked ? (correct ? "correct" : "wrong") : ""}>
              <span>{index + 1}</span>
              <small>{word.clue}</small>
              <input
                value={answers[index]}
                onChange={(event) => {
                  const value = event.target.value;
                  setAnswers((previous) => previous.map((answer, answerIndex) => answerIndex === index ? value : answer));
                  setChecked(false);
                }}
                placeholder="La tua risposta"
                aria-label={word.clue}
              />
              {correct && <CheckCircle2 size={17}/>}
              {checked && !correct && <em>Soluzione: {word.answer}</em>}
            </label>
          );
        })}
      </div>
      <button className="gameAction" type="button" disabled={saving || answers.some((answer) => !answer.trim())} onClick={() => void verify()}>
        {saving ? <LoaderCircle className="spin" size={17}/> : <Send size={17}/>}
        Controlla le parole
      </button>
    </article>
  );
}

function shuffledOrder(items: string[]) {
  return [items[2], items[0], items[3], items[1]];
}

function OrderGame({
  day,
  savedScore,
  onScore
}: {
  day: GameDay;
  savedScore: number;
  onScore: (game: GameName, score: number) => Promise<void>;
}) {
  const [available, setAvailable] = useState(() => shuffledOrder(day.order));
  const [chosen, setChosen] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setAvailable(shuffledOrder(day.order));
    setChosen([]);
    setMessage("");
  }

  async function verify() {
    const correct = chosen.every((item, index) => item === day.order[index]);
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    if (!correct) {
      reset();
      setMessage("L’ordine non è ancora corretto. Riprova!");
      return;
    }
    const points = Math.max(15, 35 - nextAttempts * 5);
    setMessage(`Sequenza corretta: ${points} punti!`);
    setSaving(true);
    await onScore("order", points);
    setSaving(false);
  }

  return (
    <article className="dailyGameCard">
      <header><span><ListOrdered size={20}/></span><div><small>30 PUNTI</small><h3>Ordina la giornata</h3></div><b>{savedScore}/30</b></header>
      <p>Tocca le esperienze nell’ordine in cui sono avvenute.</p>
      <div className="chosenOrder">
        {chosen.length === 0
          ? <small>La sequenza apparirà qui…</small>
          : chosen.map((item, index) => <button key={item} type="button" onClick={() => {
              setChosen((previous) => previous.filter((entry) => entry !== item));
              setAvailable((previous) => [...previous, item]);
            }}><b>{index + 1}</b>{item}</button>)
        }
      </div>
      <div className="orderChoices">
        {available.map((item) => <button key={item} type="button" onClick={() => {
          setAvailable((previous) => previous.filter((entry) => entry !== item));
          setChosen((previous) => [...previous, item]);
          setMessage("");
        }}>{item}<ChevronRight size={15}/></button>)}
      </div>
      {message && <p className="gameMessage">{message}</p>}
      <div className="gameButtons">
        <button type="button" onClick={reset}><RotateCcw size={16}/> Ricomincia</button>
        <button className="gameAction" type="button" disabled={saving || chosen.length !== day.order.length} onClick={() => void verify()}>
          {saving ? <LoaderCircle className="spin" size={17}/> : <CheckCircle2 size={17}/>} Verifica ordine
        </button>
      </div>
    </article>
  );
}

function puzzleNeighbors(blank: number) {
  const row = Math.floor(blank / 3);
  const column = blank % 3;
  return [
    row > 0 ? blank - 3 : -1,
    row < 2 ? blank + 3 : -1,
    column > 0 ? blank - 1 : -1,
    column < 2 ? blank + 1 : -1
  ].filter((index) => index >= 0);
}

function puzzleStart(day: number) {
  const board = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  let blank = 8;
  let previousBlank = -1;
  for (let step = 0; step < 45; step += 1) {
    const candidates = puzzleNeighbors(blank).filter((index) => index !== previousBlank);
    const selected = candidates[(day * 11 + step * 7) % candidates.length];
    previousBlank = blank;
    [board[blank], board[selected]] = [board[selected], board[blank]];
    blank = selected;
  }
  return board;
}

function PhotoPuzzle({
  day,
  photo,
  savedScore,
  onScore
}: {
  day: number;
  photo: Photo;
  savedScore: number;
  onScore: (game: GameName, score: number) => Promise<void>;
}) {
  const [board, setBoard] = useState(() => puzzleStart(day));
  const [moves, setMoves] = useState(0);
  const [completed, setCompleted] = useState(false);

  function reset() {
    setBoard(puzzleStart(day));
    setMoves(0);
    setCompleted(false);
  }

  function move(position: number) {
    if (completed) return;
    const blank = board.indexOf(8);
    if (!puzzleNeighbors(blank).includes(position)) return;
    const next = [...board];
    [next[blank], next[position]] = [next[position], next[blank]];
    const nextMoves = moves + 1;
    const solved = next.every((tile, index) => tile === index);
    setBoard(next);
    setMoves(nextMoves);
    if (solved) {
      setCompleted(true);
      const points = Math.max(20, 40 - Math.max(0, nextMoves - 35));
      void onScore("puzzle", points);
    }
  }

  return (
    <article className="dailyGameCard photoPuzzleCard">
      <header><span><Grid3X3 size={20}/></span><div><small>40 PUNTI</small><h3>Puzzle fotografico</h3></div><b>{savedScore}/40</b></header>
      <p>Ricostruisci lo scatto spostando le tessere accanto allo spazio vuoto.</p>
      <div className="photoPuzzle" aria-label={`Puzzle fotografico 3 per 3: ${photo.originalName}`}>
        {board.map((tile, position) => (
          <button
            key={tile}
            type="button"
            className={tile === 8 ? "blank" : ""}
            aria-label={tile === 8 ? "Spazio vuoto" : `Tessera ${tile + 1}`}
            onClick={() => move(position)}
            style={tile === 8 ? undefined : {
              backgroundImage: `url("${photo.contentUrl}")`,
              backgroundPosition: `${(tile % 3) * 50}% ${Math.floor(tile / 3) * 50}%`
            }}
          />
        ))}
      </div>
      <div className="puzzleStatus">
        <span><b>{moves}</b> mosse</span>
        {completed && <strong><Trophy size={17}/> Puzzle completato!</strong>}
        <button type="button" onClick={reset}><RotateCcw size={16}/> Mescola</button>
      </div>
    </article>
  );
}

export default function TripGames() {
  const [data, setData] = useState<GameResponse | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activeDay, setActiveDay] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/games", { cache: "no-store" }).then((response) => readResponse<GameResponse>(response)),
      fetch("/api/photos", { cache: "no-store" })
        .then((response) => readResponse<{ photos: Photo[] }>(response))
        .catch(() => ({ photos: [] }))
    ]).then(([gameData, photoData]) => {
      if (cancelled) return;
      setData(gameData);
      setPhotos(shufflePhotos(photoData.photos));
      const first = gameData.days.find((day) => day.unlocked && day.scores.total < 100)
        ?? gameData.days.find((day) => day.unlocked)
        ?? gameData.days[0];
      setActiveDay(first.day);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Giochi non disponibili");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const day = gameDays.find((entry) => entry.day === activeDay) ?? gameDays[0];
  const dayState = data?.days.find((entry) => entry.day === activeDay);
  const puzzlePhoto = useMemo(
    () => {
      const dayPhotos = photos.filter((photo) => photo.day === activeDay);
      const candidates = dayPhotos.length > 0 ? dayPhotos : photos;
      if (candidates.length === 0) return APP_ICON_PHOTO;
      return candidates[activeDay % candidates.length];
    },
    [activeDay, photos]
  );

  async function saveScore(game: GameName, score: number) {
    setError("");
    try {
      setData(await readResponse<GameResponse>(await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: activeDay, game, score })
      })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Punteggio non salvato");
    }
  }

  if (loading) {
    return <section className="gamesPage"><div className="gamesLoading"><LoaderCircle className="spin" size={32}/><p>Preparazione dei giochi…</p></div></section>;
  }
  if (!data || !dayState) {
    return <section className="gamesPage"><p className="gamesError" role="alert">{error || "Giochi non disponibili"}</p></section>;
  }

  return (
    <section className="gamesPage">
      <div className="gamesHero">
        <div><span>SEMPRE SBLOCCATI</span><h2>Giochi della giornata</h2><p>Parole, ricordi e fotografie: fino a 100 punti ogni giorno.</p></div>
        <Gamepad2 size={58}/>
      </div>

      <section className="gamesTotals" aria-label="Classifica generale dei giochi">
        <div className="gamesSectionHead"><div><span>CLASSIFICA GENERALE</span><h3>Campioni di viaggio</h3></div><small>Massimo 1.300 punti</small></div>
        <div className="gamesPodium">
          {data.totals.map((entry, index) => (
            <div key={entry.name} className={entry.name === data.currentUser.name ? "isCurrent" : ""}>
              <span>{index === 0 ? <Crown size={18}/> : index + 1}</span>
              <i>{entry.initials}</i>
              <b>{entry.name}<small>{entry.completed}/13 giornate complete</small></b>
              <strong>{entry.score} pt</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="gamesDayPicker" aria-label="Giornate di gioco">
        {gameDays.map((gameDay) => {
          const status = data.days.find((entry) => entry.day === gameDay.day)!;
          return <button key={gameDay.day} className={gameDay.day === activeDay ? "active" : ""} type="button" onClick={() => setActiveDay(gameDay.day)}>
            <small>{gameDay.label}</small><strong>{gameDay.date}</strong>
            <b>{status.scores.total}/100</b>
          </button>;
        })}
      </div>

      <section className="gamesDayHead">
        <div><span>{day.label} · {day.date.toUpperCase()}</span><h3>{day.city}</h3></div>
        <strong>{dayState.scores.total}<small>/100</small></strong>
      </section>

      <div className="dailyGamesGrid">
        <WordGame key={`word-${activeDay}`} day={day} savedScore={dayState.scores.word} onScore={saveScore}/>
        <OrderGame key={`order-${activeDay}`} day={day} savedScore={dayState.scores.order} onScore={saveScore}/>
        <PhotoPuzzle key={`puzzle-${activeDay}-${puzzlePhoto.id}`} day={activeDay} photo={puzzlePhoto} savedScore={dayState.scores.puzzle} onScore={saveScore}/>
      </div>

      {error && <p className="gamesError" role="alert">{error}</p>}

      <section className="gamesDailyRanking">
        <div className="gamesSectionHead"><div><span>{day.label}</span><h3>Classifica della giornata</h3></div></div>
        {dayState.ranking.length === 0
          ? <p>Il podio aspetta il primo giocatore.</p>
          : dayState.ranking.map((entry, index) => <div key={entry.name}><span>{index + 1}</span><strong>{entry.name}</strong><b>{entry.total}/100</b></div>)
        }
      </section>
    </section>
  );
}
