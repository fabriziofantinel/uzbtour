"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award, Brain, Camera, Check, CheckCircle2, Compass, Crown, Gamepad2,
  Grid3X3, Languages, LoaderCircle, LockKeyhole, Medal, Sparkles, Target, Trophy
} from "lucide-react";
import TripQuiz from "./trip-quiz";
import TripGames from "./trip-games";
import { bingoItems, missionDays } from "@/lib/challenge-data";

type ChallengeTab = "missioni" | "bingo" | "quiz" | "giochi" | "profilo";
type Badge = {
  id: string;
  name: string;
  icon: string;
  description: string;
  unlocked: boolean;
};
type ChallengeResponse = {
  currentUser: { id: string; name: string; initials: string };
  isAdmin: boolean;
  missionDays: Array<{
    day: number;
    label: string;
    date: string;
    city: string;
    unlocked: boolean;
    completed: Array<{ missionId: string; note: string; completedAt: string }>;
  }>;
  bingo: {
    completed: Array<{ itemId: string; note: string; completedAt: string }>;
    score: number;
    maximum: number;
  };
  totals: Array<{
    id: string;
    name: string;
    initials: string;
    score: number;
    breakdown: { quiz: number; games: number; missions: number; bingo: number; photos: number };
    badges: Badge[];
  }>;
};

const missionKindLabels = {
  photo: "SCATTO",
  discover: "SCOPERTA",
  social: "INCONTRO",
  taste: "ASSAGGIO",
  language: "LINGUA"
};

const badgeIcons = {
  compass: Compass,
  grid: Grid3X3,
  camera: Camera,
  brain: Brain,
  trophy: Trophy,
  languages: Languages,
  crown: Crown
};

async function readResponse(response: Response) {
  const payload = await response.json() as ChallengeResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Operazione non riuscita");
  return payload;
}

function MissionBoard({
  data,
  save
}: {
  data: ChallengeResponse;
  save: (body: object) => Promise<void>;
}) {
  const firstOpen = data.missionDays.find((day) => day.unlocked && day.completed.length < 5)
    ?? data.missionDays.find((day) => day.unlocked)
    ?? data.missionDays[0];
  const [activeDay, setActiveDay] = useState(firstOpen.day);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const state = data.missionDays.find((day) => day.day === activeDay) ?? data.missionDays[0];
  const definition = missionDays.find((day) => day.day === activeDay) ?? missionDays[0];
  const completedIds = useMemo(
    () => new Set(state.completed.map((entry) => entry.missionId)),
    [state.completed]
  );

  async function toggle(missionId: string) {
    const completed = completedIds.has(missionId);
    setBusy(missionId);
    await save({
      type: "mission",
      day: activeDay,
      id: missionId,
      completed: !completed,
      note: notes[missionId] ?? ""
    });
    setBusy("");
  }

  return (
    <section className="missionBoard">
      <div className="challengeDayPicker" aria-label="Giornate delle missioni">
        {data.missionDays.map((day) => (
          <button
            key={day.day}
            type="button"
            className={day.day === activeDay ? "active" : ""}
            onClick={() => setActiveDay(day.day)}
          >
            <small>{day.label}</small>
            <strong>{day.date}</strong>
            {day.unlocked ? <b>{day.completed.length}/5</b> : <LockKeyhole size={14}/>}
          </button>
        ))}
      </div>
      <div className="missionDayHeading">
        <div><span>{state.label} · {state.date}</span><h3>{state.city}</h3></div>
        <strong>{state.completed.length * 10}<small>/50 pt</small></strong>
      </div>
      {!state.unlocked ? (
        <div className="challengeLocked">
          <LockKeyhole size={38}/>
          <h3>Missioni ancora chiuse</h3>
          <p>Si sbloccano alle 20:00, ora uzbeka. Fabrizio può provarle in anticipo.</p>
        </div>
      ) : (
        <div className="missionList">
          {definition.missions.map((mission, index) => {
            const completed = completedIds.has(mission.id);
            return (
              <article key={mission.id} className={completed ? "completed" : ""}>
                <span className="missionNumber">{completed ? <Check size={20}/> : index + 1}</span>
                <div>
                  <small>{missionKindLabels[mission.kind]}</small>
                  <h4>{mission.title}</h4>
                  <p>{mission.description}</p>
                  {!completed && (
                    <input
                      value={notes[mission.id] ?? ""}
                      onChange={(event) => setNotes((previous) => ({ ...previous, [mission.id]: event.target.value }))}
                      placeholder="Nota o prova facoltativa…"
                      aria-label={`Nota per ${mission.title}`}
                    />
                  )}
                </div>
                <button type="button" disabled={busy === mission.id} onClick={() => void toggle(mission.id)}>
                  {busy === mission.id
                    ? <LoaderCircle className="spin" size={17}/>
                    : completed ? <><CheckCircle2 size={17}/> Fatta</> : <>+10 pt</>
                  }
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function BingoBoard({
  data,
  save
}: {
  data: ChallengeResponse;
  save: (body: object) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const completedIds = useMemo(
    () => new Set(data.bingo.completed.map((entry) => entry.itemId)),
    [data.bingo.completed]
  );

  async function toggle(itemId: string) {
    setBusy(itemId);
    await save({ type: "bingo", id: itemId, completed: !completedIds.has(itemId) });
    setBusy("");
  }

  return (
    <section className="bingoBoard">
      <div className="bingoHeading">
        <div><span>CACCIA LUNGO TUTTO IL TOUR</span><h3>Bingo Uzbekistan</h3><p>Segna una casella quando incontri davvero il suo soggetto.</p></div>
        <strong>{data.bingo.score}<small>/{data.bingo.maximum} pt</small></strong>
      </div>
      <div className="bingoProgress"><span style={{ width: `${completedIds.size / bingoItems.length * 100}%` }}/></div>
      <div className="bingoGrid">
        {bingoItems.map((item) => {
          const completed = completedIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={completed ? "completed" : ""}
              disabled={busy === item.id}
              onClick={() => void toggle(item.id)}
            >
              <span>{busy === item.id ? <LoaderCircle className="spin" size={19}/> : completed ? <Check size={21}/> : <Target size={19}/>}</span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </button>
          );
        })}
      </div>
      <p className="honourNote">Si gioca sull’onore: tocca di nuovo una casella se l’hai segnata per errore.</p>
    </section>
  );
}

function TravellerProfile({ data }: { data: ChallengeResponse }) {
  const own = data.totals.find((entry) => entry.id === data.currentUser.id) ?? data.totals[0];
  return (
    <section className="travellerProfile">
      <div className="profileScore">
        <span>{own.initials}</span>
        <div><small>PROFILO DI VIAGGIO</small><h3>{own.name}</h3><p>{own.badges.filter((badge) => badge.unlocked).length}/{own.badges.length} badge sbloccati</p></div>
        <strong>{own.score}<small>punti</small></strong>
      </div>
      <div className="scoreBreakdown">
        <span><Brain size={17}/><b>{own.breakdown.quiz}</b><small>Quiz</small></span>
        <span><Gamepad2 size={17}/><b>{own.breakdown.games}</b><small>Giochi</small></span>
        <span><Compass size={17}/><b>{own.breakdown.missions}</b><small>Missioni</small></span>
        <span><Grid3X3 size={17}/><b>{own.breakdown.bingo}</b><small>Bingo</small></span>
        <span><Camera size={17}/><b>{own.breakdown.photos}</b><small>Foto</small></span>
      </div>
      <div className="badgeGrid">
        {own.badges.map((badge) => {
          const Icon = badgeIcons[badge.icon as keyof typeof badgeIcons] ?? Award;
          return (
            <article key={badge.id} className={badge.unlocked ? "unlocked" : ""}>
              <span>{badge.unlocked ? <Icon size={25}/> : <LockKeyhole size={22}/>}</span>
              <div><strong>{badge.name}</strong><small>{badge.description}</small></div>
            </article>
          );
        })}
      </div>
      <section className="overallRanking">
        <div><Medal size={22}/><span><small>CLASSIFICA COMPLESSIVA</small><h3>La Via della Seta</h3></span></div>
        {data.totals.map((entry, index) => (
          <article key={entry.id} className={entry.id === data.currentUser.id ? "current" : ""}>
            <span>{index === 0 ? <Crown size={18}/> : index + 1}</span>
            <i>{entry.initials}</i>
            <strong>{entry.name}</strong>
            <b>{entry.score} pt</b>
          </article>
        ))}
      </section>
    </section>
  );
}

export default function TripChallenges() {
  const [tab, setTab] = useState<ChallengeTab>("missioni");
  const [data, setData] = useState<ChallengeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/challenges", { cache: "no-store" })
      .then(readResponse)
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Sfide non disponibili");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save(body: object) {
    setError("");
    try {
      setData(await readResponse(await fetch("/api/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Salvataggio non riuscito");
    }
  }

  return (
    <section className="challengesPage">
      <div className="challengesHero">
        <div><span>GIOCA · ESPLORA · RICORDA</span><h2>Le sfide del viaggio</h2><p>Missioni, Bingo, quiz e giochi: ogni esperienza fa guadagnare punti e badge.</p></div>
        <Sparkles size={54}/>
      </div>
      <nav className="challengeTabs" aria-label="Tipi di sfida">
        <button className={tab === "missioni" ? "active" : ""} onClick={() => setTab("missioni")}><Compass size={18}/>Missioni</button>
        <button className={tab === "bingo" ? "active" : ""} onClick={() => setTab("bingo")}><Grid3X3 size={18}/>Bingo</button>
        <button className={tab === "quiz" ? "active" : ""} onClick={() => setTab("quiz")}><Brain size={18}/>Quiz</button>
        <button className={tab === "giochi" ? "active" : ""} onClick={() => setTab("giochi")}><Gamepad2 size={18}/>Giochi</button>
        <button className={tab === "profilo" ? "active" : ""} onClick={() => setTab("profilo")}><Award size={18}/>Profilo</button>
      </nav>
      {loading && <div className="challengeLoading"><LoaderCircle className="spin" size={30}/><p>Preparazione delle sfide…</p></div>}
      {error && <p className="challengeError" role="alert">{error}</p>}
      {!loading && data && tab === "missioni" && <MissionBoard data={data} save={save}/>}
      {!loading && data && tab === "bingo" && <BingoBoard data={data} save={save}/>}
      {tab === "quiz" && <TripQuiz/>}
      {tab === "giochi" && <TripGames/>}
      {!loading && data && tab === "profilo" && <TravellerProfile data={data}/>}
    </section>
  );
}
