"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
  Award, Brain, Camera, Check, CheckCircle2, ChevronRight, Compass, Crown,
  Gamepad2, Grid3X3, LoaderCircle, Medal, RotateCcw, Send, Sparkles, Trophy, Upload, XCircle,
} from "lucide-react";
import PlatformTripRankings from "@/components/platform-trip-rankings";
import { uploadPrivateFile } from "@/lib/private-upload-client";
import type { TravelerExperience as Experience } from "@/lib/platform/traveler-experience";

type ChallengeTab = "missioni" | "bingo" | "foto" | "quiz" | "giochi" | "profilo" | "classifica" | "valida";
type Challenge = Experience["challenges"][number];
type Day = Experience["days"][number];

function data(content: unknown) {
  return content && typeof content === "object" && !Array.isArray(content)
    ? content as Record<string, unknown> : {};
}
function text(content: unknown, ...keys: string[]) {
  const item = data(content);
  return String(keys.map((key) => item[key]).find(Boolean) || "");
}
function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}
function bingoMilestone(completed: number) {
  if (completed >= 5) return { label: "Cinquina", points: 30 };
  if (completed === 4) return { label: "Quaterna", points: 20 };
  if (completed === 3) return { label: "Terno", points: 10 };
  if (completed === 2) return { label: "Ambo", points: 5 };
  return null;
}

function puzzleNeighbors(blank: number) {
  const row = Math.floor(blank / 3);
  const column = blank % 3;
  return [
    row > 0 ? blank - 3 : -1,
    row < 2 ? blank + 3 : -1,
    column > 0 ? blank - 1 : -1,
    column < 2 ? blank + 1 : -1,
  ].filter((index) => index >= 0);
}

function puzzleStart(seed: number) {
  const board = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  let blank = 8;
  let previousBlank = -1;
  for (let step = 0; step < 35; step += 1) {
    const candidates = puzzleNeighbors(blank).filter((index) => index !== previousBlank);
    const selected = candidates[(seed * 11 + step * 7) % candidates.length];
    previousBlank = blank;
    [board[blank], board[selected]] = [board[selected], board[blank]];
    blank = selected;
  }
  return board;
}

function PhotoPuzzle({ dayNumber, photo, score, busy, onComplete }: {
  dayNumber: number;
  photo: { contentUrl: string; originalName: string };
  score: number;
  busy: boolean;
  onComplete: () => void;
}) {
  const [board, setBoard] = useState(() => puzzleStart(dayNumber));
  const [moves, setMoves] = useState(0);
  const [completed, setCompleted] = useState(false);

  function reset() {
    setBoard(puzzleStart(dayNumber));
    setMoves(0);
    setCompleted(false);
  }

  function move(position: number) {
    if (completed || busy) return;
    const blank = board.indexOf(8);
    if (!puzzleNeighbors(blank).includes(position)) return;
    const next = [...board];
    [next[blank], next[position]] = [next[position], next[blank]];
    setBoard(next);
    setMoves((current) => current + 1);
    if (next.every((tile, index) => tile === index)) {
      setCompleted(true);
      onComplete();
    }
  }

  return <article className={`dailyGameCard interactiveGame photoPuzzleCard ${completed ? "solved" : ""}`}>
    <header><span><Grid3X3/></span><div><small>PUZZLE FOTOGRAFICO</small><h3>Ricostruisci l’immagine</h3></div><b>{score}/10</b></header>
    <p>Sposta le tessere vicine allo spazio vuoto fino a ricomporre la fotografia.</p>
    <div className="photoPuzzle" aria-label={`Puzzle fotografico 3 per 3: ${photo.originalName}`}>
      {board.map((tile, position) => <button
        key={tile}
        type="button"
        className={tile === 8 ? "blank" : ""}
        aria-label={tile === 8 ? "Spazio vuoto" : `Tessera ${tile + 1}`}
        onClick={() => move(position)}
        style={tile === 8 ? undefined : {
          backgroundImage: `url("${photo.contentUrl}")`,
          backgroundPosition: `${(tile % 3) * 50}% ${Math.floor(tile / 3) * 50}%`,
        }}
      />)}
    </div>
    <div className="puzzleStatus"><span><b>{moves}</b> mosse</span>{completed && <strong><Trophy/> Completato!</strong>}<button type="button" onClick={reset}><RotateCcw/> Mescola</button></div>
  </article>;
}

export default function PlatformTripChallenges({ experience, userName, isAdmin, onResultsChange }: {
  experience: Experience; userName: string; isAdmin: boolean;
  onResultsChange?: (results: Experience["challengeResults"]) => void;
}) {
  const [tab, setTab] = useState<ChallengeTab>("missioni");
  const [activeDayId, setActiveDayId] = useState(experience.days[0]?.id || "");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [quizResult, setQuizResult] = useState<{ score: number; maximum: number; results: Array<{ id: string; correct: boolean; correctIndex: number }> } | null>(null);
  const [gameAnswers, setGameAnswers] = useState<Record<string, string>>({});
  const [gameFeedback, setGameFeedback] = useState<Record<string, { correct: boolean; score: number; answer: string }>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [challengeResults, setChallengeResults] = useState(experience.challengeResults);
  const [submitted, setSubmitted] = useState(() => new Set(experience.challengeResults.filter((item) => item.travelerName === userName && item.status !== "rejected").map((item) => item.contentId)));
  const [contestEntries, setContestEntries] = useState(experience.contestEntries);
  const day = experience.days.find((entry) => entry.id === activeDayId) ?? experience.days[0];
  const missions = experience.challenges.filter((entry) => entry.type === "mission" && entry.dayId === day?.id).slice(0, 5);
  const bingo = experience.challenges.filter((entry) => entry.type === "bingo_item").slice(0, 15);
  const contests = experience.challenges.filter((entry) => entry.type === "photo_contest" && entry.dayId === day?.id);
  const questions = experience.challenges.filter((entry) => entry.type === "quiz_question" && entry.dayId === day?.id);
  const games = experience.challenges.filter((entry) => ["word_game", "order_game"].includes(entry.type) && entry.dayId === day?.id).slice(0, 3);
  const puzzleGame = games[0];
  const cityGame = games[1];
  const visitCountGame = games[2];
  const dayPhotos = experience.photos.filter((photo) => photo.dayId === day?.id);
  const puzzleCandidates = dayPhotos.length > 0 ? dayPhotos : experience.photos;
  const puzzlePhoto = puzzleCandidates.length > 0
    ? puzzleCandidates[(day?.number || 0) % puzzleCandidates.length]
    : { contentUrl: "/app-icon.svg", originalName: "Icona SMF Travel" };
  const approved = new Set(challengeResults.filter((item) => item.travelerName === userName && item.status === "approved").map((item) => item.contentId));
  const bingoRows = [bingo.slice(0, 5), bingo.slice(5, 10), bingo.slice(10, 15)];
  const bingoPositions = [[0, 2, 4, 6, 8], [1, 2, 5, 6, 7], [0, 3, 4, 7, 8]];
  const bingoCells = bingoRows.flatMap((row, rowIndex) => Array.from({ length: 9 }, (_, columnIndex) => ({
    rowIndex, columnIndex, item: row[bingoPositions[rowIndex].indexOf(columnIndex)] ?? null,
  })));
  const currentGameScore = games.reduce((sum, game) => {
    const saved = challengeResults.find((result) => result.travelerName === userName && result.contentId === game.id && result.status === "approved");
    return sum + (gameFeedback[game.id]?.score ?? saved?.score ?? 0);
  }, 0);
  const scores = useMemo(() => {
    const totals = new Map<string, number>();
    for (const result of challengeResults) {
      if (result.status === "approved") totals.set(result.travelerName, (totals.get(result.travelerName) || 0) + result.score);
    }
    return [...totals].sort((a, b) => b[1] - a[1]);
  }, [challengeResults]);

  async function uploadEvidence(challenge: Challenge, selectedDay: Day, file: File) {
    const key = `${challenge.id}-photo`;
    setBusy(key); setError("");
    try {
      const uploaded = await uploadPrivateFile({ endpoint: "/api/traveler/photos/upload", file, payload: {
        departureId: experience.journey.departureId, partyId: experience.journey.partyId, dayId: selectedDay.id,
      } });
      const registeredResponse = await fetch("/api/traveler/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        departureId: experience.journey.departureId, partyId: experience.journey.partyId,
        dayId: selectedDay.id, objectKey: uploaded.key, originalName: file.name,
      }) });
      const registered = await registeredResponse.json() as { photo?: Experience["photos"][number]; error?: string };
      if (!registeredResponse.ok || !registered.photo) throw new Error(registered.error || "Foto non registrata");
      const linkedResponse = await fetch("/api/traveler/challenges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "photoEvidence", departureId: experience.journey.departureId, partyId: experience.journey.partyId,
        dayId: selectedDay.id, contentId: challenge.id, mediaId: registered.photo.mediaId,
      }) });
      const linked = await linkedResponse.json() as { id?: string; slot?: number; status?: string; error?: string };
      if (!linkedResponse.ok || !linked.id) throw new Error(linked.error || "Foto non collegata alla sfida");
      setSubmitted((current) => new Set(current).add(challenge.id));
      if (challenge.type === "photo_contest") setContestEntries((current) => [{
        id: linked.id!, travelerId: "current", travelerName: userName, contentId: challenge.id,
        mediaId: registered.photo!.mediaId, slot: linked.slot || 1, status: "submitted", score: null,
        reason: "", isWinner: false, submittedAt: new Date().toISOString(), contentUrl: registered.photo!.contentUrl,
      }, ...current]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Foto non caricata"); }
    finally { setBusy(""); }
  }

  async function submitQuiz() {
    if (!day || questions.some((question) => answers[question.id] == null)) { setError("Rispondi a tutte le domande prima di confermare."); return; }
    if (!confirm("Confermi definitivamente le risposte? Il punteggio sarà visibile agli altri partecipanti.")) return;
    setBusy("quiz"); setError("");
    try {
      const response = await fetch("/api/traveler/challenges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        departureId: experience.journey.departureId, partyId: experience.journey.partyId,
        dayId: day.id, answers,
      }) });
      const result = await response.json() as typeof quizResult & { error?: string };
      if (!response.ok || !result) throw new Error(result?.error || "Punteggio non salvato");
      setQuizResult(result);
      const retained = challengeResults.filter((entry) => !(entry.travelerName === userName && entry.type === "quiz" && result.results.some((answer) => answer.id === entry.contentId)));
      const nextResults: Experience["challengeResults"] = [...retained, ...result.results.map((answer) => ({
        id: `quiz-${answer.id}-${userName}`, travelerId: "current", travelerName: userName,
        dayId: day.id, contentId: answer.id, type: "quiz", score: answer.correct ? 1 : 0,
        maxScore: 1, status: "approved", result: { correctIndex: answer.correctIndex },
        submittedAt: new Date().toISOString(), evidenceUrl: "",
      }))];
      setChallengeResults(nextResults); onResultsChange?.(nextResults);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Punteggio non salvato"); }
    finally { setBusy(""); }
  }

  async function submitGame(game: Challenge, action: "puzzle" | "city" | "visitCount", suppliedAnswer = "") {
    if (!day) return;
    const answer = suppliedAnswer || gameAnswers[game.id]?.trim() || "";
    if (action !== "puzzle" && !answer) { setError("Inserisci una risposta prima di verificare."); return; }
    const key = `game-${game.id}`;
    setBusy(key); setError("");
    try {
      const response = await fetch("/api/traveler/challenges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, departureId: experience.journey.departureId, partyId: experience.journey.partyId,
        dayId: day.id, contentId: game.id, answer,
      }) });
      const result = await response.json() as { id?: string; correct?: boolean; score?: number; answer?: string; error?: string };
      if (!response.ok || typeof result.correct !== "boolean") throw new Error(result.error || "Risultato non salvato");
      setGameFeedback((current) => ({ ...current, [game.id]: { correct: result.correct!, score: result.score || 0, answer: result.answer || "" } }));
      const existing = challengeResults.find((entry) => entry.travelerName === userName && entry.contentId === game.id);
      const nextResults: Experience["challengeResults"] = existing
        ? challengeResults.map((entry) => entry.id === existing.id ? { ...entry, status: "approved", score: result.score || 0, submittedAt: new Date().toISOString() } : entry)
        : [...challengeResults, { id: result.id || `game-${game.id}-${userName}`, travelerId: "current", travelerName: userName, dayId: day.id, contentId: game.id, type: "game", score: result.score || 0, maxScore: 10, status: "approved", result: { answer }, submittedAt: new Date().toISOString(), evidenceUrl: "" }];
      setChallengeResults(nextResults); onResultsChange?.(nextResults);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Risultato non salvato"); }
    finally { setBusy(""); }
  }

  async function reviewEvidence(resultId: string, accepted: boolean) {
    if (!day) return;
    const key = `review-${resultId}`;
    setBusy(key); setError("");
    try {
      const response = await fetch("/api/traveler/challenges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "reviewEvidence", departureId: experience.journey.departureId, partyId: experience.journey.partyId,
        dayId: day.id, resultId, approved: accepted,
      }) });
      const reviewed = await response.json() as { status?: string; score?: number; error?: string };
      if (!response.ok || !reviewed.status) throw new Error(reviewed.error || "Validazione non salvata");
      const nextResults = challengeResults.map((result) => result.id === resultId ? { ...result, status: reviewed.status!, score: reviewed.score || 0 } : result);
      setChallengeResults(nextResults); onResultsChange?.(nextResults);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Validazione non salvata"); }
    finally { setBusy(""); }
  }

  if (!day) return null;
  return <section className="challengesPage">
    <div className="challengesHero"><div><span>GIOCA · ESPLORA · RICORDA</span><h2>Le sfide del viaggio</h2><p>Missioni e Bingo assegnano punti soltanto dopo la validazione fotografica.</p></div><Sparkles size={54}/></div>
    <nav className={`challengeTabs${isAdmin ? " admin" : ""}`} aria-label="Tipi di sfida">
      <button className={tab === "missioni" ? "active" : ""} onClick={() => setTab("missioni")}><Compass/>Missioni</button>
      <button className={tab === "bingo" ? "active" : ""} onClick={() => setTab("bingo")}><Grid3X3/>Bingo</button>
      <button className={tab === "foto" ? "active" : ""} onClick={() => setTab("foto")}><Camera/>Foto</button>
      <button className={tab === "quiz" ? "active" : ""} onClick={() => setTab("quiz")}><Brain/>Quiz</button>
      <button className={tab === "giochi" ? "active" : ""} onClick={() => setTab("giochi")}><Gamepad2/>Giochi</button>
      <button className={tab === "profilo" ? "active" : ""} onClick={() => setTab("profilo")}><Award/>Profilo</button>
      <button className={tab === "classifica" ? "active" : ""} onClick={() => setTab("classifica")}><Trophy/>Classifica</button>
      {isAdmin && <button className={tab === "valida" ? "active" : ""} onClick={() => setTab("valida")}><CheckCircle2/>Valida <b>{challengeResults.filter((result) => result.status === "submitted" && ["mission", "bingo"].includes(result.type)).length}</b></button>}
    </nav>
    {error && <p className="quizError" role="alert">{error}</p>}

    {tab === "missioni" && <section className="missionBoard"><DayPicker days={experience.days} activeDayId={day.id} onDay={setActiveDayId} count={(entry) => Math.min(5, experience.challenges.filter((item) => item.type === "mission" && item.dayId === entry.id).length)}/><div className="missionDayHeading"><div><span>GIORNO {day.number} · {dateLabel(day.date)}</span><h3>{day.city}</h3></div><strong>{missions.filter((item) => approved.has(item.id)).length * 10}<small>punti validati</small></strong></div><p className="evidenceIntro"><Camera/> Cinque missioni ogni giorno: allega una foto e ottieni 10 punti dopo la validazione.</p><div className="missionList">{missions.map((mission, index) => <article key={mission.id} className={approved.has(mission.id) ? "approved" : submitted.has(mission.id) ? "pending" : ""}><span className="missionNumber">{submitted.has(mission.id) ? <Check/> : index + 1}</span><div><small>MISSIONE {index + 1} DI 5</small><h4>{mission.title}</h4><p>{text(mission.content, "description", "instructions")}</p></div>{approved.has(mission.id) ? <span className="missionStatus approved">Validata · 10 pt</span> : submitted.has(mission.id) ? <span className="missionStatus pending">In verifica</span> : <PhotoPicker busy={busy === `${mission.id}-photo`} label="Aggiungi foto" onFile={(file) => void uploadEvidence(mission, day, file)}/>}</article>)}</div></section>}

    {tab === "bingo" && <section className="bingoBoard"><div className="bingoHeading"><div><span>SEMPRE SBLOCCATO · CARTELLA 3 × 9</span><h3>Tombola fotografica {experience.journey.destinationCountry}</h3><p>Completa le caselle con una foto validata e conquista ambo, terno, quaterna, cinquina e tombola.</p></div><strong>{bingo.filter((item) => approved.has(item.id)).length}/15<small>caselle validate</small></strong></div><div className="bingoAwards">{bingoRows.map((row, index) => { const milestone = bingoMilestone(row.filter((item) => approved.has(item.id)).length); return <span className={milestone ? "won" : ""} key={index}>Riga {index + 1}<b>{milestone ? `${milestone.label} · ${milestone.points} pt` : "In gioco"}</b></span>; })}<span className={bingo.length === 15 && bingo.every((item) => approved.has(item.id)) ? "won tombola" : ""}>Cartella completa<b>Tombola · 50 pt</b></span></div><div className="tombolaScroller"><div className="tombolaCard">{bingoCells.map(({ rowIndex, columnIndex, item }) => item ? <article key={item.id} className={approved.has(item.id) ? "approved" : submitted.has(item.id) ? "pending" : ""}><span className="tombolaNumber">{columnIndex * 10 + rowIndex * 3 + 1}</span><strong>{item.title}</strong>{approved.has(item.id) ? <b className="bingoStatus approved"><Check/> Validata</b> : submitted.has(item.id) ? <b className="bingoStatus pending">In verifica</b> : <PhotoPicker busy={busy === `${item.id}-photo`} label="Foto" onFile={(file) => void uploadEvidence(item, day, file)}/>}</article> : <span className="tombolaBlank" key={`${rowIndex}-${columnIndex}`}/>)}</div></div><p className="bingoRules">Punteggi per ogni riga: ambo 5, terno 10, quaterna 20, cinquina 30. Completando tutte le 15 caselle ottieni altri 50 punti.</p></section>}

    {tab === "foto" && <section className="contestHub"><header className="contestHubHero"><span><Camera/></span><div><small>DUE CONTEST · TRE FOTO A TESTA</small><h3>Contest fotografici</h3><p>Sempre sbloccati: partecipa alla gara a tema libero e alla sfida proposta.</p></div></header><DayPicker days={experience.days} activeDayId={day.id} onDay={setActiveDayId} count={(entry) => experience.challenges.filter((item) => item.type === "photo_contest" && item.dayId === entry.id).length}/><div className="dualContestDayHeading"><div><small>GIORNO {day.number} · {dateLabel(day.date)}</small><h3>{day.city}</h3></div><span>Massimo 3 foto per partecipante e per contest</span></div><div className="dualContestGrid">{contests.map((contest, index) => { const entries = contestEntries.filter((entry) => entry.contentId === contest.id); return <article className={`dualContestCard ${index === 0 ? "free" : "theme"}`} key={contest.id}><header><span>{index === 0 ? <Camera/> : <Sparkles/>}</span><div><small>CONTEST {index + 1} · {index === 0 ? "TEMA LIBERO" : "TEMA DEL GIORNO"}</small><h3>{contest.title}</h3><p>{text(contest.content, "description")}</p></div><b>{entries.length} foto</b></header><div className="contestEntryGrid">{entries.map((entry) => entry.contentUrl && <figure key={entry.id}><div><Image src={entry.contentUrl} alt="Foto contest" fill sizes="180px" unoptimized/></div><figcaption>{entry.travelerName}</figcaption></figure>)}</div><div className="contestUploadBar"><div><strong>Le tue foto: {entries.filter((entry) => entry.travelerName === userName).length}/3</strong><small>{entries.length < 3 ? "Puoi aggiungere altre foto" : "Limite raggiunto"}</small></div><PhotoPicker busy={busy === `${contest.id}-photo`} disabled={entries.filter((entry) => entry.travelerName === userName).length >= 3} label="Carica foto" onFile={(file) => void uploadEvidence(contest, day, file)}/></div><div className="contestJudgeBar">{isAdmin ? <button disabled={entries.length === 0}><Sparkles/> Avvia valutazione</button> : <p>La valutazione può essere avviata dall’amministratore.</p>}</div></article>; })}</div></section>}

    {tab === "quiz" && <section className="quizPage"><div className="quizHero"><div><span>SFIDA DELLA GIORNATA</span><h2>Il quiz della giornata</h2><p>{questions.length} domande, un punto per ogni risposta corretta.</p></div><Trophy/></div><div className="quizLayout"><aside className="quizDays"><div className="quizSectionHead"><div><span>LE SFIDE</span><h3>Scegli la giornata</h3></div></div><div className="quizDayList">{experience.days.map((entry) => <button className={entry.id === day.id ? "active" : ""} onClick={() => { setActiveDayId(entry.id); setAnswers({}); setQuizResult(null); }} key={entry.id}><span className="quizDayNumber">{entry.number}</span><span><small>{dateLabel(entry.date)}</small><strong>{entry.city}</strong></span><ChevronRight/></button>)}</div></aside><div className="quizPlay"><div className="quizPlayHead"><div><span>GIORNO {day.number} · {dateLabel(day.date).toUpperCase()}</span><h3>{day.city}</h3></div>{quizResult && <div className="quizScoreBadge"><Medal/><strong>{quizResult.score}/{quizResult.maximum}</strong></div>}</div>{quizResult ? <div className="quizResultBanner"><span className={quizResult.score >= Math.ceil(quizResult.maximum * .8) ? "great" : ""}><Trophy/></span><div><small>RISULTATO CONFERMATO</small><strong>{quizResult.score} risposte corrette su {quizResult.maximum}</strong></div></div> : <><div className="quizProgress"><span><b style={{ width: `${questions.length ? Object.keys(answers).length / questions.length * 100 : 0}%` }}/></span><small>{Object.keys(answers).length} di {questions.length} risposte</small></div><div className="quizQuestions">{questions.map((question, questionIndex) => { const item = data(question.content); const options = Array.isArray(item.options) ? item.options.map(String) : []; return <fieldset key={question.id}><legend><span>{questionIndex + 1}</span>{text(question.content, "question") || question.title}</legend><div>{options.map((option, optionIndex) => <label className={answers[question.id] === optionIndex ? "selected" : ""} key={option}><input type="radio" checked={answers[question.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}/><span>{String.fromCharCode(65 + optionIndex)}</span><strong>{option}</strong></label>)}</div></fieldset>; })}</div><div className="quizSubmitBar"><span><CheckCircle2/> {Object.keys(answers).length}/{questions.length} completate</span><button disabled={busy === "quiz" || Object.keys(answers).length !== questions.length || questions.length === 0} onClick={() => void submitQuiz()}>{busy === "quiz" ? <LoaderCircle className="spin"/> : <Send/>} Conferma risposte</button></div></>}</div></div></section>}

    {tab === "giochi" && <section className="gamesPage">
      <div className="gamesHero"><div><span>SEMPRE SBLOCCATI · 3 GIOCHI FACILI</span><h2>Giochi della giornata</h2><p>Un puzzle fotografico e due domande semplici sul programma del giorno.</p></div><Gamepad2/></div>
      <DayPicker days={experience.days} activeDayId={day.id} onDay={(id) => { setActiveDayId(id); setGameAnswers({}); setGameFeedback({}); }} count={(entry) => Math.min(3, experience.challenges.filter((item) => ["word_game", "order_game"].includes(item.type) && item.dayId === entry.id).length)}/>
      <section className="gamesDayHead"><div><span>GIORNO {day.number} · {dateLabel(day.date)}</span><h3>{day.city}</h3></div><strong>{currentGameScore}<small>pt</small></strong></section>
      <div className="dailyGamesGrid easyGamesGrid">
        {puzzleGame && <PhotoPuzzle
          key={`puzzle-${day.id}-${puzzlePhoto.contentUrl}`}
          dayNumber={day.number}
          photo={puzzlePhoto}
          score={gameFeedback[puzzleGame.id]?.score ?? challengeResults.find((result) => result.travelerName === userName && result.contentId === puzzleGame.id && result.status === "approved")?.score ?? 0}
          busy={busy === `game-${puzzleGame.id}`}
          onComplete={() => void submitGame(puzzleGame, "puzzle")}
        />}
        {cityGame && <article className={`dailyGameCard interactiveGame ${gameFeedback[cityGame.id]?.correct ? "solved" : ""}`}>
          <header><span>2</span><div><small>INDOVINA LA CITTÀ</small><h3>Dove siamo oggi?</h3></div><b>10 pt</b></header>
          <p>Scrivi il nome della città principale della giornata. Aiuto: inizia con <strong>{day.city.charAt(0).toUpperCase()}</strong> e ha {day.city.length} lettere.</p>
          <div className="gameAnswerBox"><label htmlFor={`game-${cityGame.id}`}>La tua risposta</label><div><input id={`game-${cityGame.id}`} value={gameAnswers[cityGame.id] || ""} disabled={gameFeedback[cityGame.id]?.correct} placeholder="Nome della città" onChange={(event) => setGameAnswers((current) => ({ ...current, [cityGame.id]: event.target.value }))}/><button disabled={busy === `game-${cityGame.id}` || gameFeedback[cityGame.id]?.correct} onClick={() => void submitGame(cityGame, "city")}>{busy === `game-${cityGame.id}` ? <LoaderCircle className="spin"/> : <CheckCircle2/>} Verifica</button></div></div>
          {gameFeedback[cityGame.id] && <p className={`gameFeedback ${gameFeedback[cityGame.id].correct ? "correct" : "wrong"}`}>{gameFeedback[cityGame.id].correct ? "Corretto: +10 punti!" : `Riprova. Soluzione: ${gameFeedback[cityGame.id].answer}`}</p>}
        </article>}
        {visitCountGame && <article className={`dailyGameCard interactiveGame ${gameFeedback[visitCountGame.id]?.correct ? "solved" : ""}`}>
          <header><span>3</span><div><small>CONTA LE VISITE</small><h3>Occhio al programma</h3></div><b>10 pt</b></header>
          <p>Quante visite a monumenti o luoghi d’interesse sono previste oggi? Conta soltanto le tappe indicate come “Visita”.</p>
          <div className="gameVisitHint">Nel programma ci sono <strong>{day.items.length}</strong> tappe complessive.</div>
          <div className="gameAnswerBox"><label htmlFor={`game-${visitCountGame.id}`}>Numero di visite</label><div><input id={`game-${visitCountGame.id}`} type="number" min="0" max="20" inputMode="numeric" value={gameAnswers[visitCountGame.id] || ""} disabled={gameFeedback[visitCountGame.id]?.correct} placeholder="0" onChange={(event) => setGameAnswers((current) => ({ ...current, [visitCountGame.id]: event.target.value }))}/><button disabled={busy === `game-${visitCountGame.id}` || gameFeedback[visitCountGame.id]?.correct} onClick={() => void submitGame(visitCountGame, "visitCount")}>{busy === `game-${visitCountGame.id}` ? <LoaderCircle className="spin"/> : <CheckCircle2/>} Verifica</button></div></div>
          {gameFeedback[visitCountGame.id] && <p className={`gameFeedback ${gameFeedback[visitCountGame.id].correct ? "correct" : "wrong"}`}>{gameFeedback[visitCountGame.id].correct ? "Corretto: +10 punti!" : `Riprova. Le visite sono ${gameFeedback[visitCountGame.id].answer}.`}</p>}
        </article>}
      </div>
      {games.length < 3 && <p className="gamesNotice">I tre giochi saranno disponibili dopo il completamento dei contenuti della giornata.</p>}
    </section>}

    {tab === "valida" && isAdmin && <section className="reviewPanel"><div className="reviewHeading"><span><CheckCircle2/></span><div><small>AREA AMMINISTRATORE</small><h3>Valida le foto-prova</h3><p>Controlla le missioni e le caselle della tombola prima di assegnare i punti.</p></div></div>{challengeResults.filter((result) => result.status === "submitted" && ["mission", "bingo"].includes(result.type)).length === 0 ? <div className="reviewEmpty"><CheckCircle2/><h3>Nessuna foto da validare</h3><p>Tutte le prove ricevute sono state esaminate.</p></div> : <div className="reviewList">{challengeResults.filter((result) => result.status === "submitted" && ["mission", "bingo"].includes(result.type)).map((result) => { const challenge = experience.challenges.find((item) => item.id === result.contentId); const challengeDay = experience.days.find((entry) => entry.id === result.dayId); return <article key={result.id}><div className="reviewImage">{result.evidenceUrl ? <Image src={result.evidenceUrl} alt={`Foto-prova di ${result.travelerName}`} fill sizes="(max-width: 800px) 100vw, 380px" unoptimized/> : <Camera/>}</div><div className="reviewCopy"><small>{result.type === "mission" ? "MISSIONE" : "TOMBOLA"} · {challengeDay ? `GIORNO ${challengeDay.number}` : "VIAGGIO"}</small><h4>{challenge?.title || "Foto-prova"}</h4><p>{result.travelerName}</p><blockquote>{challenge ? text(challenge.content, "description", "instructions") : "Verifica che la foto rispetti la richiesta."}</blockquote><div><button className="reject" disabled={busy === `review-${result.id}`} onClick={() => void reviewEvidence(result.id, false)}><XCircle/> Rifiuta</button><button className="approve" disabled={busy === `review-${result.id}`} onClick={() => void reviewEvidence(result.id, true)}>{busy === `review-${result.id}` ? <LoaderCircle className="spin"/> : <Check/>} Valida</button></div></div></article>; })}</div>}</section>}

    {tab === "profilo" && <section className="travellerProfile"><div className="profileScore"><span>{userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><small>PROFILO DI VIAGGIO</small><h3>{userName}</h3><p>{submitted.size} sfide inviate</p></div><strong>{challengeResults.filter((item) => item.travelerName === userName && item.status === "approved").reduce((sum, item) => sum + item.score, 0)}<small>punti validati</small></strong></div><section className="overallRanking"><div><Medal/><span><small>CLASSIFICA COMPLESSIVA</small><h3>{experience.journey.partyName}</h3></span></div>{scores.length === 0 ? <p>Il podio aspetta il primo punteggio.</p> : scores.map(([name, score], index) => <article className={name === userName ? "current" : ""} key={name}><span>{index === 0 ? <Crown/> : index + 1}</span><i>{name.slice(0, 2).toUpperCase()}</i><strong>{name}</strong><b>{score} pt</b></article>)}</section></section>}
    {tab === "classifica" && <PlatformTripRankings experience={{ ...experience, challengeResults }} userName={userName}/>}
  </section>;
}

function DayPicker({ days, activeDayId, onDay, count }: { days: Day[]; activeDayId: string; onDay: (id: string) => void; count: (day: Day) => number }) {
  return <div className="challengeDayPicker">{days.map((day) => <button className={day.id === activeDayId ? "active" : ""} onClick={() => onDay(day.id)} key={day.id}><small>GIORNO {day.number}</small><strong>{dateLabel(day.date)}</strong><b>{count(day)} sfide</b></button>)}</div>;
}

function PhotoPicker({ label, busy, disabled = false, onFile }: { label: string; busy: boolean; disabled?: boolean; onFile: (file: File) => void }) {
  return <label className={`evidencePicker ${disabled ? "disabled" : ""}`}>{busy ? <LoaderCircle className="spin"/> : <Upload/>}{label}<input type="file" accept="image/*,.heic,.heif" capture="environment" disabled={busy || disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }}/></label>;
}
