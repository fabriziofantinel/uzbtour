"use client";

import Image from "next/image";
import { upload as uploadBlob } from "@vercel/blob/client";
import { useEffect, useMemo, useState } from "react";
import {
  Award, Brain, Camera, Check, CheckCircle2, Compass, Crown, Gamepad2,
  Grid3X3, Languages, LoaderCircle, LockKeyhole, Medal,
  ShieldCheck, Sparkles, Target, ThumbsDown, ThumbsUp, Trophy
} from "lucide-react";
import TripQuiz from "./trip-quiz";
import TripGames from "./trip-games";
import { PhotoContestHub } from "./photo-contest";
import { bingoItems, missionDays } from "@/lib/challenge-data";
import { selectedTripDay } from "@/lib/today-data";

type ChallengeTab = "missioni" | "bingo" | "foto" | "quiz" | "giochi" | "profilo" | "validazioni";
type EvidenceType = "mission" | "bingo";
type EvidenceStatus = "pending" | "approved" | "rejected";
type Submission = {
  id: number;
  status: EvidenceStatus;
  evidenceUrl: string | null;
  originalName: string | null;
  note: string;
  reviewNote: string;
  reviewedBy: string | null;
  submittedAt: string;
};
type Badge = {
  id: string;
  name: string;
  icon: string;
  description: string;
  unlocked: boolean;
};
type PendingReview = {
  id: number;
  type: EvidenceType;
  challengeId: string;
  title: string;
  description: string;
  day: number;
  dayLabel: string;
  userName: string;
  note: string;
  evidenceUrl: string;
  submittedAt: string;
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
    submissions: Array<Submission & { missionId: string }>;
  }>;
  bingo: {
    submissions: Array<Submission & { itemId: string; day: number | null }>;
    score: number;
    maximum: number;
  };
  pendingReviews: PendingReview[];
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

function photoExtension(file: File) {
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif"
  };
  const fromName = file.name.split(".").pop()?.toLowerCase();
  return byType[file.type] ?? (
    fromName && ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(fromName)
      ? fromName
      : null
  );
}

function EvidenceState({ submission }: { submission: Submission }) {
  return (
    <div className={`evidenceState ${submission.status}`}>
      {submission.evidenceUrl && (
        <span className="evidenceThumb">
          <Image src={submission.evidenceUrl} alt="Foto-prova" fill sizes="76px" unoptimized/>
        </span>
      )}
      <span>
        {submission.status === "pending" && <><LoaderCircle size={15}/> In attesa di Fabrizio</>}
        {submission.status === "approved" && <><CheckCircle2 size={15}/> Foto approvata</>}
        {submission.status === "rejected" && <><ThumbsDown size={15}/> Da rifare</>}
        {submission.reviewNote && <small>{submission.reviewNote}</small>}
      </span>
    </div>
  );
}

function EvidencePicker({
  label,
  disabled,
  busy,
  onFile
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className={`evidencePicker ${disabled ? "disabled" : ""}`}>
      {busy ? <LoaderCircle className="spin" size={17}/> : <Camera size={17}/>}
      {label}
      <input
        type="file"
        accept="image/*,.heic,.heif"
        capture="environment"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function MissionBoard({
  data,
  uploadingKey,
  uploadEvidence
}: {
  data: ChallengeResponse;
  uploadingKey: string;
  uploadEvidence: (input: {
    type: EvidenceType;
    day: number;
    id: string;
    note: string;
    file: File;
  }) => Promise<void>;
}) {
  const firstOpen = data.missionDays.find((day) =>
    day.unlocked && day.submissions.filter((entry) => entry.status === "approved").length < 5
  ) ?? data.missionDays.find((day) => day.unlocked) ?? data.missionDays[0];
  const [activeDay, setActiveDay] = useState(firstOpen.day);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const state = data.missionDays.find((day) => day.day === activeDay) ?? data.missionDays[0];
  const definition = missionDays.find((day) => day.day === activeDay) ?? missionDays[0];
  const approved = state.submissions.filter((entry) => entry.status === "approved").length;

  return (
    <section className="missionBoard">
      <div className="challengeDayPicker" aria-label="Giornate delle missioni">
        {data.missionDays.map((day) => {
          const approvedCount = day.submissions.filter((entry) => entry.status === "approved").length;
          const pendingCount = day.submissions.filter((entry) => entry.status === "pending").length;
          return (
            <button
              key={day.day}
              type="button"
              className={day.day === activeDay ? "active" : ""}
              onClick={() => setActiveDay(day.day)}
            >
              <small>{day.label}</small>
              <strong>{day.date}</strong>
              {day.unlocked
                ? <b>{approvedCount}/5{pendingCount > 0 ? ` · ${pendingCount} ⏳` : ""}</b>
                : <LockKeyhole size={14}/>}
            </button>
          );
        })}
      </div>
      <div className="missionDayHeading">
        <div><span>{state.label} · {state.date}</span><h3>{state.city}</h3></div>
        <strong>{approved * 10}<small>/50 pt validati</small></strong>
      </div>
      {!state.unlocked ? (
        <div className="challengeLocked">
          <LockKeyhole size={38}/>
          <h3>Missioni ancora chiuse</h3>
          <p>Si sbloccano alle 20:00, ora uzbeka, due giorni prima della giornata. Fabrizio può provarle in anticipo.</p>
        </div>
      ) : (
        <>
          <p className="evidenceIntro"><Camera size={17}/> Per ogni missione allega una foto: i 10 punti arriveranno dopo la validazione di Fabrizio.</p>
          <div className="missionList">
            {definition.missions.map((mission, index) => {
              const submission = state.submissions.find((entry) => entry.missionId === mission.id);
              const key = `mission-${activeDay}-${mission.id}`;
              const canSubmit = !submission || submission.status === "rejected";
              return (
                <article key={mission.id} className={submission?.status ?? ""}>
                  <span className="missionNumber">
                    {submission?.status === "approved" ? <Check size={20}/> : index + 1}
                  </span>
                  <div>
                    <small>{missionKindLabels[mission.kind]}</small>
                    <h4>{mission.title}</h4>
                    <p>{mission.description}</p>
                    {submission && <EvidenceState submission={submission}/>}
                    {canSubmit && (
                      <input
                        value={notes[mission.id] ?? submission?.note ?? ""}
                        onChange={(event) => setNotes((previous) => ({ ...previous, [mission.id]: event.target.value }))}
                        placeholder="Nota facoltativa per Fabrizio…"
                        aria-label={`Nota per ${mission.title}`}
                      />
                    )}
                  </div>
                  {canSubmit ? (
                    <EvidencePicker
                      label={submission?.status === "rejected" ? "Nuova foto" : "Aggiungi foto"}
                      disabled={Boolean(uploadingKey)}
                      busy={uploadingKey === key}
                      onFile={(file) => void uploadEvidence({
                        type: "mission",
                        day: activeDay,
                        id: mission.id,
                        note: notes[mission.id] ?? submission?.note ?? "",
                        file
                      })}
                    />
                  ) : (
                    <span className={`missionStatus ${submission.status}`}>
                      {submission.status === "approved" ? "+10 pt" : "In verifica"}
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function BingoBoard({
  data,
  uploadingKey,
  uploadEvidence
}: {
  data: ChallengeResponse;
  uploadingKey: string;
  uploadEvidence: (input: {
    type: EvidenceType;
    day: number;
    id: string;
    note: string;
    file: File;
  }) => Promise<void>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const evidenceDay = selectedTripDay().day;
  const approved = data.bingo.submissions.filter((entry) => entry.status === "approved").length;

  return (
    <section className="bingoBoard">
      <div className="bingoHeading">
        <div><span>SEMPRE SBLOCCATO · CACCIA LUNGO TUTTO IL TOUR</span><h3>Bingo Uzbekistan</h3><p>Fotografa ciò che trovi: la casella vale punti solo dopo l’approvazione di Fabrizio.</p></div>
        <strong>{data.bingo.score}<small>/{data.bingo.maximum} pt validati</small></strong>
      </div>
      <div className="bingoProgress"><span style={{ width: `${approved / bingoItems.length * 100}%` }}/></div>
      <div className="bingoGrid evidenceBingoGrid">
        {bingoItems.map((item) => {
          const submission = data.bingo.submissions.find((entry) => entry.itemId === item.id);
          const key = `bingo-${evidenceDay}-${item.id}`;
          const canSubmit = !submission || submission.status === "rejected";
          return (
            <article key={item.id} className={submission?.status ?? ""}>
              <span>{submission?.status === "approved" ? <Check size={21}/> : <Target size={19}/>}</span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
              {submission && <EvidenceState submission={submission}/>}
              {canSubmit && (
                <>
                  <input
                    value={notes[item.id] ?? submission?.note ?? ""}
                    onChange={(event) => setNotes((previous) => ({ ...previous, [item.id]: event.target.value }))}
                    placeholder="Nota facoltativa…"
                    aria-label={`Nota per ${item.title}`}
                  />
                  <EvidencePicker
                    label={submission?.status === "rejected" ? "Nuova foto" : "Fotografa"}
                    disabled={Boolean(uploadingKey)}
                    busy={uploadingKey === key}
                    onFile={(file) => void uploadEvidence({
                      type: "bingo",
                      day: evidenceDay,
                      id: item.id,
                      note: notes[item.id] ?? submission?.note ?? "",
                      file
                    })}
                  />
                </>
              )}
              {submission?.status === "pending" && <b className="bingoStatus pending">In verifica</b>}
              {submission?.status === "approved" && <b className="bingoStatus approved">Punti assegnati</b>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ReviewPanel({
  data,
  review
}: {
  data: ChallengeResponse;
  review: (input: {
    type: EvidenceType;
    evidenceId: number;
    decision: "approved" | "rejected";
    reviewNote: string;
  }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(0);
  const [notes, setNotes] = useState<Record<number, string>>({});

  async function decide(item: PendingReview, decision: "approved" | "rejected") {
    setBusy(item.id);
    await review({
      type: item.type,
      evidenceId: item.id,
      decision,
      reviewNote: notes[item.id] ?? ""
    });
    setBusy(0);
  }

  return (
    <section className="reviewPanel">
      <div className="reviewHeading">
        <span><ShieldCheck size={23}/></span>
        <div><small>SOLO FABRIZIO</small><h3>Validazione delle foto</h3><p>{data.pendingReviews.length} prove in attesa.</p></div>
      </div>
      {data.pendingReviews.length === 0 ? (
        <div className="reviewEmpty"><CheckCircle2 size={36}/><h3>Tutto controllato</h3><p>Non ci sono fotografie da validare.</p></div>
      ) : (
        <div className="reviewList">
          {data.pendingReviews.map((item) => (
            <article key={`${item.type}-${item.id}`}>
              <div className="reviewImage">
                <Image src={item.evidenceUrl} alt={`Prova di ${item.userName}`} fill sizes="(max-width: 700px) 100vw, 340px" unoptimized/>
              </div>
              <div className="reviewCopy">
                <small>{item.dayLabel} · {item.userName}</small>
                <h4>{item.title}</h4>
                <p>{item.description}</p>
                {item.note && <blockquote>“{item.note}”</blockquote>}
                <input
                  value={notes[item.id] ?? ""}
                  onChange={(event) => setNotes((previous) => ({ ...previous, [item.id]: event.target.value }))}
                  placeholder="Motivazione facoltativa…"
                  aria-label={`Motivazione per ${item.title}`}
                />
                <div>
                  <button type="button" className="reject" disabled={busy === item.id} onClick={() => void decide(item, "rejected")}><ThumbsDown size={17}/> Rifiuta</button>
                  <button type="button" className="approve" disabled={busy === item.id} onClick={() => void decide(item, "approved")}>
                    {busy === item.id ? <LoaderCircle className="spin" size={17}/> : <ThumbsUp size={17}/>} Approva punti
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
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
        <strong>{own.score}<small>punti validati</small></strong>
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
  const [uploadingKey, setUploadingKey] = useState("");
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

  async function post(body: object) {
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

  async function uploadEvidence(input: {
    type: EvidenceType;
    day: number;
    id: string;
    note: string;
    file: File;
  }) {
    const extension = photoExtension(input.file);
    if (!extension || input.file.size > 25 * 1024 * 1024) {
      setError("La foto non è supportata oppure supera 25 MB.");
      return;
    }
    const key = `${input.type}-${input.day}-${input.id}`;
    const folder = input.type === "mission" ? "missione" : "bingo";
    const pathname = `uzbekistan-2026/prove/${folder}/giorno-${input.day}/${crypto.randomUUID()}.${extension}`;
    setUploadingKey(key);
    setError("");
    try {
      const blob = await uploadBlob(pathname, input.file, {
        access: "private",
        handleUploadUrl: "/api/challenges/upload",
        clientPayload: JSON.stringify({
          type: input.type,
          day: input.day,
          challengeId: input.id,
          originalName: input.file.name,
          note: input.note
        })
      });
      await post({
        action: "submit",
        type: input.type,
        day: input.day,
        id: input.id,
        pathname: blob.pathname,
        originalName: input.file.name,
        note: input.note
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Foto-prova non caricata");
    } finally {
      setUploadingKey("");
    }
  }

  async function review(input: {
    type: EvidenceType;
    evidenceId: number;
    decision: "approved" | "rejected";
    reviewNote: string;
  }) {
    await post({ action: "review", ...input });
  }

  return (
    <section className="challengesPage">
      <div className="challengesHero">
        <div><span>GIOCA · ESPLORA · RICORDA</span><h2>Le sfide del viaggio</h2><p>Missioni e Bingo assegnano punti soltanto dopo la validazione fotografica di Fabrizio.</p></div>
        <Sparkles size={54}/>
      </div>
      <nav className={`challengeTabs ${data?.isAdmin ? "admin" : ""}`} aria-label="Tipi di sfida">
        <button className={tab === "missioni" ? "active" : ""} onClick={() => setTab("missioni")}><Compass size={18}/>Missioni</button>
        <button className={tab === "bingo" ? "active" : ""} onClick={() => setTab("bingo")}><Grid3X3 size={18}/>Bingo</button>
        <button className={tab === "foto" ? "active" : ""} onClick={() => setTab("foto")}><Camera size={18}/>Foto</button>
        <button className={tab === "quiz" ? "active" : ""} onClick={() => setTab("quiz")}><Brain size={18}/>Quiz</button>
        <button className={tab === "giochi" ? "active" : ""} onClick={() => setTab("giochi")}><Gamepad2 size={18}/>Giochi</button>
        <button className={tab === "profilo" ? "active" : ""} onClick={() => setTab("profilo")}><Award size={18}/>Profilo</button>
        {data?.isAdmin && (
          <button className={tab === "validazioni" ? "active" : ""} onClick={() => setTab("validazioni")}>
            <ShieldCheck size={18}/>Valida
            {data.pendingReviews.length > 0 && <b>{data.pendingReviews.length}</b>}
          </button>
        )}
      </nav>
      {loading && <div className="challengeLoading"><LoaderCircle className="spin" size={30}/><p>Preparazione delle sfide…</p></div>}
      {error && <p className="challengeError" role="alert">{error}</p>}
      {!loading && data && tab === "missioni" && <MissionBoard data={data} uploadingKey={uploadingKey} uploadEvidence={uploadEvidence}/>}
      {!loading && data && tab === "bingo" && <BingoBoard data={data} uploadingKey={uploadingKey} uploadEvidence={uploadEvidence}/>}
      {tab === "foto" && <PhotoContestHub/>}
      {tab === "quiz" && <TripQuiz/>}
      {tab === "giochi" && <TripGames/>}
      {!loading && data && tab === "profilo" && <TravellerProfile data={data}/>}
      {!loading && data && data.isAdmin && tab === "validazioni" && <ReviewPanel data={data} review={review}/>}
    </section>
  );
}
