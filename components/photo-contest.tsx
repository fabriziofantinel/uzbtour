"use client";

import { upload as uploadBlob } from "@vercel/blob/client";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award, Camera, CheckCircle2, Clock3, ImagePlus, LoaderCircle,
  Sparkles, Trash2, Trophy, Upload
} from "lucide-react";

type ContestType = "free" | "theme";
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
  contestType: ContestType;
  status: "processing" | "completed" | "failed";
  winnerPhotoId: string | null;
  winnerScore: number | null;
  winnerReason: string | null;
  winnerContentUrl: string | null;
  rankings: PhotoRanking[];
  judgedBy: string;
  model: string;
  errorMessage: string | null;
};
type ContestPhoto = {
  id: string;
  slot: number;
  originalName: string;
  addedBy: string;
  isMine: boolean;
  canDelete: boolean;
  contentUrl: string;
  createdAt?: string;
};
type ContestKind = {
  type: ContestType;
  title: string;
  description: string;
  photoCount: number;
  myPhotoCount: number;
  photos: ContestPhoto[];
  contest: PhotoContest | null;
};
type ContestDay = {
  day: number;
  label: string;
  date: string;
  city: string;
  contests: Record<ContestType, ContestKind>;
};
type ContestResponse = {
  isAdmin: boolean;
  maxPhotosPerParticipant: number;
  days: ContestDay[];
};
type UploadProgress = {
  key: string;
  current: number;
  total: number;
  percent: number;
};

async function readJson<T>(response: Response) {
  const payload = await response.json() as T & { error?: string };
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

function usePhotoContests() {
  const [data, setData] = useState<ContestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyContest, setBusyContest] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setData(await readJson<ContestResponse>(
        await fetch("/api/photo-contest", { cache: "no-store" })
      ));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Concorsi non disponibili");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const judge = useCallback(async (day: number, contestType: ContestType, title: string) => {
    if (!confirm(`Avviare la giuria AI per “${title}”? Le foto già caricate verranno valutate e il verdetto sarà definitivo.`)) return;
    const key = `${day}:${contestType}`;
    setBusyContest(key);
    setError("");
    try {
      setData(await readJson<ContestResponse>(await fetch("/api/photo-contest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, contestType })
      })));
    } catch (judgeError) {
      const message = judgeError instanceof Error ? judgeError.message : "Giuria non disponibile";
      await refresh();
      setError(message);
    } finally {
      setBusyContest("");
    }
  }, [refresh]);

  return { data, loading, busyContest, error, setError, refresh, judge };
}

function WinnerCard({ day, kind, compact = false }: {
  day: ContestDay;
  kind: ContestKind;
  compact?: boolean;
}) {
  const contest = kind.contest;
  if (!contest || contest.status !== "completed" || !contest.winnerContentUrl) return null;
  const winner = contest.rankings[0];

  return (
    <article className={`photoWinnerCard ${compact ? "compact" : ""}`}>
      <div className="photoWinnerImage">
        <Image
          src={contest.winnerContentUrl}
          alt={`Foto vincitrice di ${kind.title}, giorno ${day.day}`}
          fill
          sizes={compact ? "(max-width: 700px) 100vw, 300px" : "(max-width: 700px) 100vw, 420px"}
          unoptimized
        />
        <span><Trophy size={14}/> Vincitrice · {kind.title}</span>
      </div>
      <div className="photoWinnerCopy">
        <small>{day.label} · {day.date}</small>
        <h3>{kind.title}</h3>
        <strong>{contest.winnerScore}/100 punti</strong>
        <p>{contest.winnerReason}</p>
        {winner && <span>Scatto di {winner.addedBy}</span>}
        {!compact && winner && (
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

function ContestEntryGrid({ day, kind, deletingId, onDelete }: {
  day: ContestDay;
  kind: ContestKind;
  deletingId: string;
  onDelete: (photo: ContestPhoto, day: number, kind: ContestKind) => void;
}) {
  if (kind.photos.length === 0) {
    return <p className="contestNoEntries"><ImagePlus size={18}/> Nessuna foto ancora caricata.</p>;
  }

  return (
    <div className="contestEntryGrid">
      {kind.photos.map((photo) => (
        <figure key={photo.id} className={photo.isMine ? "mine" : ""}>
          <div>
            <Image
              src={photo.contentUrl}
              alt={photo.originalName}
              fill
              sizes="(max-width: 520px) 44vw, 180px"
              unoptimized
            />
          </div>
          <figcaption>
            <span>{photo.addedBy}{photo.isMine ? " · la tua foto" : ""}</span>
            {photo.canDelete && kind.contest?.status !== "completed" && (
              <button
                type="button"
                aria-label={`Elimina ${photo.originalName}`}
                disabled={deletingId === photo.id}
                onClick={() => onDelete(photo, day.day, kind)}
              >
                {deletingId === photo.id ? <LoaderCircle className="spin" size={14}/> : <Trash2 size={14}/>}
              </button>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function ContestCard({
  day,
  kind,
  isAdmin,
  maximum,
  busyContest,
  uploadProgress,
  deletingId,
  onFiles,
  onDelete,
  onJudge
}: {
  day: ContestDay;
  kind: ContestKind;
  isAdmin: boolean;
  maximum: number;
  busyContest: string;
  uploadProgress: UploadProgress | null;
  deletingId: string;
  onFiles: (day: number, kind: ContestKind, files: File[]) => void;
  onDelete: (photo: ContestPhoto, day: number, kind: ContestKind) => void;
  onJudge: (day: number, kind: ContestKind) => void;
}) {
  const key = `${day.day}:${kind.type}`;
  const completed = kind.contest?.status === "completed";
  const processing = kind.contest?.status === "processing" || busyContest === key;
  const uploading = uploadProgress?.key === key;
  const remaining = Math.max(0, maximum - kind.myPhotoCount);

  return (
    <article className={`dualContestCard ${kind.type} ${completed ? "completed" : ""}`}>
      <header>
        <span>{kind.type === "free" ? <Camera size={21}/> : <Sparkles size={21}/>}</span>
        <div>
          <small>{kind.type === "free" ? "CONTEST 1 · TEMA LIBERO" : "CONTEST 2 · TEMA DEL GIORNO"}</small>
          <h3>{kind.title}</h3>
          <p>{kind.description}</p>
        </div>
        <b>{kind.photoCount} foto</b>
      </header>

      {completed && <WinnerCard day={day} kind={kind}/>}
      {!completed && (
        <>
          <div className="contestUploadBar">
            <div>
              <strong>Le tue foto: {kind.myPhotoCount}/{maximum}</strong>
              <small>{remaining > 0 ? `Puoi aggiungerne ancora ${remaining}` : "Hai raggiunto il limite"}</small>
            </div>
            <label className={uploading || remaining === 0 || processing ? "disabled" : ""}>
              {uploading ? <LoaderCircle className="spin" size={16}/> : <Upload size={16}/>}
              <span>{uploading
                ? `Foto ${uploadProgress.current}/${uploadProgress.total} · ${uploadProgress.percent}%`
                : "Carica foto"
              }</span>
              <input
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                disabled={uploading || remaining === 0 || processing}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length > 0) onFiles(day.day, kind, files);
                }}
              />
            </label>
          </div>
          <ContestEntryGrid day={day} kind={kind} deletingId={deletingId} onDelete={onDelete}/>
          <div className="contestJudgeBar">
            {isAdmin ? (
              <button
                type="button"
                disabled={kind.photoCount === 0 || processing || uploading}
                onClick={() => onJudge(day.day, kind)}
              >
                {processing
                  ? <><LoaderCircle className="spin" size={17}/> Giuria in corso…</>
                  : <><Sparkles size={17}/> Avvia valutazione</>
                }
              </button>
            ) : (
              <p><Clock3 size={15}/> Fabrizio può avviare la valutazione in qualsiasi momento.</p>
            )}
            {kind.contest?.status === "failed" && isAdmin && (
              <small>Il tentativo precedente non è riuscito: puoi riprovare.</small>
            )}
          </div>
        </>
      )}
    </article>
  );
}

export function PhotoContestPanel({ day }: { day: number }) {
  const { data, loading, error } = usePhotoContests();
  const contestDay = data?.days.find((entry) => entry.day === day);
  if (day < 1 || day > 13) return null;

  return (
    <section className="photoContestPanel programContestPanel" aria-label={`Concorsi fotografici del giorno ${day}`}>
      <div className="photoContestPanelHead">
        <span><Award size={20}/></span>
        <div>
          <small>DUE CONTEST FOTOGRAFICI</small>
          <strong>Tema libero e sfida fotografica del giorno</strong>
        </div>
      </div>
      {loading && <p><LoaderCircle className="spin" size={16}/> Caricamento dei contest…</p>}
      {error && <p className="photoContestError" role="alert">{error}</p>}
      {contestDay && (
        <div className="programContestGrid">
          {(["free", "theme"] as const).map((contestType) => {
            const kind = contestDay.contests[contestType];
            const completed = kind.contest?.status === "completed";
            return (
              <section key={contestType}>
                <small>{contestType === "free" ? "CONTEST 1" : "CONTEST 2"}</small>
                <h3>{kind.title}</h3>
                <p>{kind.description}</p>
                {completed
                  ? <WinnerCard day={contestDay} kind={kind} compact/>
                  : <span><Camera size={14}/> Vincitrice non ancora decretata</span>
                }
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function PhotoContestShowcase() {
  const { data, loading, error } = usePhotoContests();
  const winners = useMemo(
    () => data?.days.flatMap((day) =>
      (["free", "theme"] as const)
        .map((contestType) => ({ day, kind: day.contests[contestType] }))
        .filter(({ kind }) => kind.contest?.status === "completed")
    ) ?? [],
    [data]
  );

  return (
    <section className="photoContestShowcase">
      <div className="photoContestIntro">
        <span><Award size={22}/></span>
        <div>
          <small>LA GIURIA DI GEMINI</small>
          <h2>Le foto vincitrici</h2>
          <p>Ogni giornata premia due scatti: il migliore a tema libero e quello che interpreta meglio il tema proposto.</p>
        </div>
      </div>
      {loading && <p className="photoContestLoading"><LoaderCircle className="spin" size={17}/> Caricamento dei verdetti…</p>}
      {error && <p className="photoContestError" role="alert">{error}</p>}
      {!loading && winners.length === 0 && (
        <p className="photoContestEmpty">Le vincitrici appariranno qui dopo la prima selezione avviata da Fabrizio.</p>
      )}
      <div className="photoWinnerList">
        {winners.map(({ day, kind }) => <WinnerCard key={`${day.day}-${kind.type}`} day={day} kind={kind}/>)}
      </div>
    </section>
  );
}

export function PhotoContestHub() {
  const { data, loading, busyContest, error, setError, refresh, judge } = usePhotoContests();
  const [selectedDay, setSelectedDay] = useState(1);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const contestDay = data?.days.find((entry) => entry.day === selectedDay);

  async function uploadPhotos(day: number, kind: ContestKind, selectedFiles: File[]) {
    if (!data) return;
    const remaining = data.maxPhotosPerParticipant - kind.myPhotoCount;
    if (selectedFiles.length > remaining) {
      setError(`Puoi selezionare al massimo ${remaining} ${remaining === 1 ? "foto" : "foto"} per questo contest.`);
      return;
    }
    const invalid = selectedFiles.find((file) => !photoExtension(file) || file.size > 25 * 1024 * 1024);
    if (invalid) {
      setError(`“${invalid.name}” non è supportata oppure supera 25 MB.`);
      return;
    }

    const key = `${day}:${kind.type}`;
    let uploadErrorMessage = "";
    setError("");
    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        const extension = photoExtension(file)!;
        setUploadProgress({ key, current: index + 1, total: selectedFiles.length, percent: 0 });
        const pathname = `uzbekistan-2026/contest/giorno-${day}/${kind.type}/${crypto.randomUUID()}.${extension}`;
        const blob = await uploadBlob(pathname, file, {
          access: "private",
          handleUploadUrl: "/api/photo-contest/upload",
          clientPayload: JSON.stringify({
            day,
            contestType: kind.type,
            originalName: file.name
          }),
          onUploadProgress: ({ percentage }) => {
            setUploadProgress({
              key,
              current: index + 1,
              total: selectedFiles.length,
              percent: Math.round(percentage)
            });
          }
        });
        await readJson<{ photo: ContestPhoto }>(await fetch("/api/photo-contest/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            day,
            contestType: kind.type,
            pathname: blob.pathname,
            originalName: file.name
          })
        }));
      }
    } catch (uploadError) {
      uploadErrorMessage = uploadError instanceof Error ? uploadError.message : "Caricamento non riuscito";
    } finally {
      setUploadProgress(null);
      await refresh();
      if (uploadErrorMessage) setError(uploadErrorMessage);
    }
  }

  async function deletePhoto(photo: ContestPhoto, _day: number, kind: ContestKind) {
    if (!confirm(`Eliminare “${photo.originalName}” dal contest “${kind.title}”?`)) return;
    setDeletingId(photo.id);
    setError("");
    try {
      await readJson<{ deleted: boolean }>(await fetch(`/api/photo-contest/photos/${photo.id}`, {
        method: "DELETE"
      }));
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Foto non eliminata");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className="contestHub" aria-label="Contest fotografico">
      <header className="contestHubHero">
        <span><Camera size={25}/></span>
        <div>
          <small>DUE CONTEST · TRE FOTO A TESTA · DUE VINCITORI</small>
          <h3>Contest fotografici</h3>
          <p>Sempre sbloccati: per ogni giornata partecipa sia alla gara a tema libero sia alla sfida con il tema proposto. Fabrizio decide quando avviare la valutazione.</p>
        </div>
      </header>

      {loading && <p className="photoContestLoading"><LoaderCircle className="spin" size={17}/> Caricamento dei contest…</p>}
      {error && <p className="photoContestError" role="alert">{error}</p>}

      {!loading && data && (
        <>
          <div className="contestDayPicker" aria-label="Scegli la giornata del contest">
            {data.days.map((day) => {
              const total = day.contests.free.photoCount + day.contests.theme.photoCount;
              const completed = [day.contests.free, day.contests.theme]
                .filter((kind) => kind.contest?.status === "completed").length;
              return (
                <button
                  type="button"
                  key={day.day}
                  className={selectedDay === day.day ? "active" : ""}
                  onClick={() => setSelectedDay(day.day)}
                >
                  <small>GIORNO {day.day}</small>
                  <strong>{day.city}</strong>
                  <span>{completed === 2 ? <CheckCircle2 size={13}/> : <Camera size={13}/>} {total} foto · {completed}/2 verdetti</span>
                </button>
              );
            })}
          </div>

          {contestDay && (
            <>
              <div className="dualContestDayHeading">
                <div><small>{contestDay.label} · {contestDay.date}</small><h3>{contestDay.city}</h3></div>
                <span>Massimo {data.maxPhotosPerParticipant} foto per partecipante e per contest</span>
              </div>
              <div className="dualContestGrid">
                {(["free", "theme"] as const).map((contestType) => (
                  <ContestCard
                    key={contestType}
                    day={contestDay}
                    kind={contestDay.contests[contestType]}
                    isAdmin={data.isAdmin}
                    maximum={data.maxPhotosPerParticipant}
                    busyContest={busyContest}
                    uploadProgress={uploadProgress}
                    deletingId={deletingId}
                    onFiles={(contestDayNumber, kind, files) => void uploadPhotos(contestDayNumber, kind, files)}
                    onDelete={(photo, contestDayNumber, kind) => void deletePhoto(photo, contestDayNumber, kind)}
                    onJudge={(contestDayNumber, kind) => void judge(contestDayNumber, kind.type, kind.title)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
