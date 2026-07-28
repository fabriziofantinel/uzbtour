"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, Crown, LockKeyhole,
  Medal, RotateCcw, Send, Trophy, X
} from "lucide-react";

type QuizQuestion = { id: string; prompt: string; options: string[] };
type QuizResult = {
  id: string;
  selectedAnswer: string;
  correctAnswer: string;
  correct: boolean;
};
type QuizAttempt = {
  score: number;
  answers: Record<string, string>;
  submittedAt: string;
  result: QuizResult[];
};
type QuizDay = {
  day: number;
  date: string;
  city: string;
  unlockAt: string;
  unlocked: boolean;
  questions: QuizQuestion[];
  attempt: QuizAttempt | null;
};
type RankingEntry = {
  day: number;
  userName: string;
  score: number;
  submittedAt: string;
};
type QuizData = {
  currentUser: { id: string; name: string; initials: string };
  isAdmin: boolean;
  days: QuizDay[];
  dailyRankings: Array<{ day: number; entries: RankingEntry[] }>;
  totals: Array<{ name: string; initials: string; score: number; completed: number }>;
};

async function readQuizResponse(response: Response) {
  const result = (await response.json()) as QuizData & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Operazione non riuscita");
  return result;
}

export default function TripQuiz() {
  const [data, setData] = useState<QuizData | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [retaking, setRetaking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quiz")
      .then(readQuizResponse)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        const firstAvailable = result.days.find((day) => day.unlocked && !day.attempt)
          ?? result.days.find((day) => day.unlocked)
          ?? result.days[0];
        setActiveDay(firstAvailable.day);
        setAnswers(firstAvailable.attempt?.answers ?? {});
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Quiz non disponibile");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const day = data?.days.find((entry) => entry.day === activeDay) ?? null;
  const resultByQuestion = useMemo(
    () => new Map(day?.attempt?.result.map((result) => [result.id, result]) ?? []),
    [day]
  );
  const dailyRanking = data?.dailyRankings.find((ranking) => ranking.day === activeDay)?.entries ?? [];
  const answeredCount = day?.questions.reduce(
    (count, question) => count + (answers[question.id] ? 1 : 0),
    0
  ) ?? 0;
  const showingResult = Boolean(day?.attempt && !retaking);

  function selectDay(selectedDay: QuizDay) {
    setActiveDay(selectedDay.day);
    setAnswers(selectedDay.attempt?.answers ?? {});
    setRetaking(false);
    setError("");
  }

  async function submitQuiz() {
    if (!day || answeredCount !== day.questions.length) {
      setError("Rispondi a tutte le 15 domande prima di confermare.");
      return;
    }
    if (!confirm("Confermi definitivamente le risposte? Il punteggio sarà visibile agli altri partecipanti.")) {
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const updated = await readQuizResponse(await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: day.day, answers })
      }));
      setData(updated);
      setRetaking(false);
      const updatedDay = updated.days.find((entry) => entry.day === day.day);
      setAnswers(updatedDay?.attempt?.answers ?? {});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Punteggio non salvato");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <section className="quizPage"><div className="quizLoading"><CircleHelp size={34}/><p>Preparazione delle domande…</p></div></section>;
  }

  if (!data || !day) {
    return <section className="quizPage"><p className="quizError" role="alert">{error || "Quiz non disponibile"}</p></section>;
  }

  return (
    <section className="quizPage">
      <div className="quizHero">
        <div>
          <span>SFIDA SULLA VIA DELLA SETA</span>
          <h2>Il quiz della giornata</h2>
          <p>15 domande, un punto per ogni risposta corretta. Dopo la conferma il risultato entra in classifica.</p>
        </div>
        <Trophy size={58}/>
      </div>

      <section className="quizTotals" aria-label="Classifica generale">
        <div className="quizSectionHead">
          <div><span>CLASSIFICA GENERALE</span><h3>La corsa al trofeo</h3></div>
          <small>Massimo 165 punti</small>
        </div>
        <div className="quizPodium">
          {data.totals.map((entry, index) => (
            <div key={entry.name} className={entry.name === data.currentUser.name ? "isCurrent" : ""}>
              <span className="quizRank">{index === 0 ? <Crown size={18}/> : index + 1}</span>
              <i>{entry.initials}</i>
              <span><strong>{entry.name}</strong><small>{entry.completed}/11 quiz completati</small></span>
              <b>{entry.score}<small> pt</small></b>
            </div>
          ))}
        </div>
      </section>

      <div className="quizLayout">
        <aside className="quizDays" aria-label="Quiz giornalieri">
          <div className="quizSectionHead">
            <div><span>LE SFIDE</span><h3>Scegli la giornata</h3></div>
          </div>
          <div className="quizDayList">
            {data.days.map((quizDay) => (
              <button
                key={quizDay.day}
                type="button"
                className={`${quizDay.day === activeDay ? "active" : ""} ${!quizDay.unlocked ? "locked" : ""}`}
                onClick={() => selectDay(quizDay)}
              >
                <span className="quizDayNumber">{quizDay.day}</span>
                <span><small>{quizDay.date}</small><strong>{quizDay.city}</strong></span>
                {quizDay.attempt
                  ? <b>{quizDay.attempt.score}/15</b>
                  : quizDay.unlocked ? <ChevronRight size={17}/> : <LockKeyhole size={16}/>}
              </button>
            ))}
          </div>
        </aside>

        <div className="quizPlay">
          <div className="quizPlayHead">
            <div>
              <span>GIORNO {day.day} · {day.date.toUpperCase()}</span>
              <h3>{day.city}</h3>
            </div>
            {day.attempt && <div className="quizScoreBadge"><Medal size={20}/><strong>{day.attempt.score}/15</strong></div>}
          </div>

          {!day.unlocked ? (
            <div className="quizLocked">
              <LockKeyhole size={42}/>
              <h3>Quiz ancora chiuso</h3>
              <p>Si sbloccherà il {day.date} alle <strong>20:00, ora dell’Uzbekistan</strong>, al termine della giornata di visite.</p>
              <span><Clock3 size={15}/> Le risposte restano segrete fino allo sblocco</span>
            </div>
          ) : (
            <>
              {showingResult && day.attempt ? (
                <div className="quizResultBanner">
                  <span className={day.attempt.score >= 12 ? "great" : ""}><Trophy size={28}/></span>
                  <div><small>RISULTATO CONFERMATO</small><strong>{day.attempt.score} risposte corrette su 15</strong></div>
                  {data.isAdmin && <button type="button" onClick={() => { setRetaking(true); setAnswers({}); }}>
                    <RotateCcw size={15}/> Riprova
                  </button>}
                </div>
              ) : (
                <div className="quizProgress">
                  <span><b style={{ width: `${(answeredCount / 15) * 100}%` }}/></span>
                  <small>{answeredCount} di 15 risposte</small>
                </div>
              )}

              <div className="quizQuestions">
                {day.questions.map((question, questionIndex) => {
                  const result = resultByQuestion.get(question.id);
                  return (
                    <fieldset key={question.id} className={showingResult ? "showResult" : ""}>
                      <legend><span>{questionIndex + 1}</span>{question.prompt}</legend>
                      <div>
                        {question.options.map((option, optionIndex) => {
                          const selected = answers[question.id] === option;
                          const isCorrect = showingResult && result?.correctAnswer === option;
                          const isWrong = showingResult && selected && !result?.correct;
                          return (
                            <label
                              key={option}
                              className={`${selected ? "selected" : ""} ${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}`}
                            >
                              <input
                                type="radio"
                                name={question.id}
                                value={option}
                                checked={selected}
                                disabled={showingResult}
                                onChange={() => setAnswers((previous) => ({ ...previous, [question.id]: option }))}
                              />
                              <span>{String.fromCharCode(65 + optionIndex)}</span>
                              <strong>{option}</strong>
                              {isCorrect ? <Check size={17}/> : isWrong ? <X size={17}/> : null}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
              </div>

              {!showingResult && (
                <div className="quizSubmitBar">
                  <span>{answeredCount === 15 ? <CheckCircle2 size={17}/> : <CircleHelp size={17}/>} {answeredCount}/15 completate</span>
                  <button type="button" disabled={submitting || answeredCount !== 15} onClick={submitQuiz}>
                    <Send size={16}/>{submitting ? "Calcolo…" : "Conferma risposte"}
                  </button>
                </div>
              )}
            </>
          )}

          {error && <p className="quizError" role="alert">{error}</p>}

          <section className="quizDailyRanking">
            <div className="quizSectionHead">
              <div><span>GIORNO {day.day}</span><h3>Classifica della giornata</h3></div>
            </div>
            {dailyRanking.length === 0 ? (
              <p>Nessun punteggio registrato: il podio aspetta il primo concorrente.</p>
            ) : dailyRanking.map((entry, index) => (
              <div key={entry.userName}>
                <span>{index + 1}</span>
                <strong>{entry.userName}</strong>
                <b>{entry.score}/15</b>
              </div>
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}

