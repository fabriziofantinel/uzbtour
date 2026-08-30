import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import {
  readV3ChallengeAnswerSpecs,
} from "@/lib/platform/v3-gamification";
import {
  addV3PhotoContestEntry,
  confirmV3PhotoContest,
  reviewV3ActivityEvidence,
  saveV3ActivityItemResult,
  submitV3PhotoEvidence,
} from "@/lib/platform/v3-gamification-mutations";
import { resolveTravelerContext } from "@/lib/platform/traveler-experience";
import { getJobQueue } from "@/lib/platform/job-queue";

export const runtime = "nodejs";

function normalizedAnswer(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it").replace(/[^a-z0-9]+/g, " ").trim();
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const departureId = String(body?.departureId || "");
  const partyId = String(body?.partyId || "");
  const dayId = String(body?.dayId || "");
  if (!/^[0-9a-f-]{36}$/i.test(departureId) || !/^[0-9a-f-]{36}$/i.test(partyId) || !/^[0-9a-f-]{36}$/i.test(dayId)) {
    return NextResponse.json({ error: "Sfida non valida" }, { status: 400 });
  }
  const travelerContext = await resolveTravelerContext({ userId: user.id, departureId, partyId, dayId });
  if (!travelerContext) return NextResponse.json({ error: "Sfida non disponibile" }, { status: 403 });
  const agencyId = travelerContext.agencyId;
  const templateVersionId = travelerContext.templateVersionId;
  if(body?.action==="confirmPhotoContest"){
    const contentId=String(body.contentId||"");
    if(!/^[0-9a-f-]{36}$/i.test(contentId))return NextResponse.json({error:"Contest non valido"},{status:400});
    try{
      const confirmed=await confirmV3PhotoContest({userId:user.id,agencyId,departureId,partyId,itemId:contentId});
      const entryIds=Array.isArray(confirmed.entry_ids)?confirmed.entry_ids.map(String):[];
      if(entryIds.length!==2)throw new Error("Conferma contest incompleta");
      const queued=await getJobQueue().enqueue({actorId:user.id,agencyId,type:"photo-contest.evaluate",
        idempotencyKey:`photo-contest:${partyId}:${user.id}:${contentId}`,payload:{departureId,partyId,itemId:contentId,entryIds}});
      return NextResponse.json({id:queued.id,status:"evaluating",entryIds});
    }catch(error){
      if(error instanceof Error&&/exactly two/i.test(error.message))return NextResponse.json({error:"Carica due foto prima di confermare"},{status:409});
      if(error instanceof Error&&/closed/i.test(error.message))return NextResponse.json({error:"Il contest è già chiuso"},{status:409});
      throw error;
    }
  }
  if (body?.action === "photoEvidence") {
    const contentId = String(body.contentId || "");
    const mediaId = String(body.mediaId || "");
    if (!/^[0-9a-f-]{36}$/i.test(contentId) || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
      return NextResponse.json({ error: "Foto-prova non valida" }, { status: 400 });
    }
    const linked = await readV3ChallengeAnswerSpecs({
      agencyId, templateVersionId, dayId, itemIds: [contentId],
    });
    if (!linked[0]) return NextResponse.json({ error: "Foto e sfida non corrispondono" }, { status: 400 });
    const contentType = String(linked[0].activity_type);
    if (contentType === "photo_contest") {
      try {
        const participantSlot=body.participantSlot==null?null:Number(body.participantSlot);
        if(participantSlot!==null&&![1,2].includes(participantSlot))return NextResponse.json({error:"Posizione foto non valida"},{status:400});
        const row = await addV3PhotoContestEntry({
          userId: user.id, agencyId, departureId, partyId, dayId, itemId: contentId, mediaId,participantSlot,
        });
        return NextResponse.json({ id: String(row.id), slot: Number(row.participant_slot), status: "draft" });
      } catch (error) {
        if (error instanceof Error && /contest draft limit reached/i.test(error.message)) {
          return NextResponse.json({ error: "Hai già caricato 2 foto per questo contest" }, { status: 409 });
        }
        if(error instanceof Error&&/no longer editable/i.test(error.message))return NextResponse.json({error:"Le foto sono già state confermate"},{status:409});
        if(error instanceof Error&&/contest is closed/i.test(error.message))return NextResponse.json({error:"Il contest è già chiuso"},{status:409});
        throw error;
      }
    }
    if (!["mission", "bingo"].includes(contentType)) {
      return NextResponse.json({ error: "Foto e sfida non corrispondono" }, { status: 400 });
    }
    let row: Record<string, unknown>;
    try {
      row = await submitV3PhotoEvidence({ userId: user.id, agencyId, departureId, partyId, dayId, itemId: contentId, mediaId });
    } catch (error) {
      if (error instanceof Error && /validation pending/i.test(error.message)) return NextResponse.json({ error: "La foto è ancora in verifica" }, { status: 409 });
      if (error instanceof Error && /already approved/i.test(error.message)) return NextResponse.json({ error: "La missione è già stata superata" }, { status: 409 });
      if (error instanceof Error && /attempt limit reached/i.test(error.message)) return NextResponse.json({ error: "Hai esaurito i due tentativi disponibili" }, { status: 409 });
      throw error;
    }
    const resultId=String(row.id);
    const attemptNumber=Number(row.attempt_number);
    await getJobQueue().enqueue({actorId:user.id,agencyId,type:"photo-evidence.validate",idempotencyKey:`photo-evidence:${resultId}`,payload:{userId:user.id,departureId,partyId,dayId,itemId:contentId,mediaId,resultId,attemptNumber}});
    return NextResponse.json({ id: resultId, status: "submitted", aiValidation:"queued", attemptNumber, attemptsRemaining:Number(row.attempts_remaining) });
  }
  if (body?.action === "reviewEvidence") {
    if (!user.isAgencyAdmin) return NextResponse.json({ error: "Solo l’amministratore può validare le foto" }, { status: 403 });
    const resultId = String(body.resultId || "");
    const approved = body.approved === true;
    if (!/^[0-9a-f-]{36}$/i.test(resultId)) return NextResponse.json({ error: "Risultato non valido" }, { status: 400 });
    try {
      const reviewed = await reviewV3ActivityEvidence({ userId: user.id, agencyId, partyId, resultId, approved });
      return NextResponse.json({ id: String(reviewed.id), status: String(reviewed.status), score: Number(reviewed.score) });
    } catch (error) {
      if (error instanceof Error && /evidence not available/i.test(error.message)) {
        return NextResponse.json({ error: "Foto già valutata o non disponibile" }, { status: 409 });
      }
      throw error;
    }
  }
  const gameAction = String(body?.action || "");
  if (["game", "puzzle", "city", "visitCount"].includes(gameAction)) {
    const contentId = String(body?.contentId || "");
    const answer = String(body?.answer || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(contentId) || (gameAction !== "puzzle" && !answer)) {
      return NextResponse.json({ error: "Risposta non valida" }, { status: 400 });
    }
    const v3Items = await readV3ChallengeAnswerSpecs({
      agencyId, templateVersionId, dayId, itemIds: [contentId],
    });
    if (!v3Items[0]
      || !["word_game", "order_game", "puzzle"].includes(String(v3Items[0].activity_type))) {
      return NextResponse.json({ error: "Gioco non disponibile nel catalogo pubblicato" }, { status: 404 });
    }
    const answerSpec = v3Items[0]?.answer_spec && typeof v3Items[0].answer_spec === "object"
      && !Array.isArray(v3Items[0].answer_spec)
      ? v3Items[0].answer_spec as Record<string, unknown> : {};
    const expected = String(answerSpec.answer || "").trim();
    const correct = gameAction === "puzzle"
      ? true
      : Boolean(expected) && normalizedAnswer(answer) === normalizedAnswer(expected);
    const score = correct ? 10 : 0;
    const saved = await saveV3ActivityItemResult({
      userId: user.id, agencyId, departureId, partyId, dayId, itemId: contentId,
      score, maxScore: 10, status: "approved", result: { answer, correct },
    });
    return NextResponse.json({ id: String(saved.id), correct, score, maximum: 10, answer: correct ? "" : expected });
  }
  const answers = body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
    ? body.answers as Record<string, unknown> : null;
  if (!answers) return NextResponse.json({ error: "Risposte non valide" }, { status: 400 });
  const questionIds = Object.keys(answers).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const questionCandidates = questionIds.length
    ? await readV3ChallengeAnswerSpecs({ agencyId, templateVersionId, dayId, itemIds: questionIds })
    : [];
  const questions = questionCandidates.filter((question) => String(question.activity_type) === "quiz");
  if (questions.length !== 10 || questions.length !== questionIds.length) {
    return NextResponse.json({ error: "Completa tutte le domande disponibili" }, { status: 400 });
  }
  const results = questions.map((question) => {
    const answerSpec = question.answer_spec as Record<string, unknown>;
    const selected = Number(answers[String(question.id)]);
    const correctIndex = Number(answerSpec.correctIndex);
    return { id: String(question.id), selected, correctIndex, correct: selected === correctIndex };
  });
  for (const result of results) {
    await saveV3ActivityItemResult({
      userId: user.id, agencyId, departureId, partyId, dayId, itemId: result.id,
      score: result.correct ? 1 : 0, maxScore: 1, status: "approved",
      result: { selected: result.selected, correct: result.correct },
    });
  }
  return NextResponse.json({
    score: results.filter((result) => result.correct).length,
    maximum: results.length,
    results: results.map(({ id, correct }) => ({ id, correct })),
  });
}
