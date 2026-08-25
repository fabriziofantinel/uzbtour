import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";

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
  const sql = getSql();
  const scope = await sql`
    SELECT departure.agency_id::text, departure.template_version_id::text,
      profile.id::text AS traveler_id
    FROM traveler_profiles profile
    JOIN party_memberships membership ON membership.traveler_id = profile.id AND membership.status = 'active'
    JOIN travel_parties party ON party.id = membership.party_id AND party.agency_id = membership.agency_id
    JOIN departures departure ON departure.id = party.departure_id AND departure.agency_id = party.agency_id
    JOIN trip_days day ON day.id = ${dayId} AND day.agency_id = departure.agency_id
      AND day.template_version_id = departure.template_version_id
    WHERE profile.user_id = ${user.id} AND party.id = ${partyId} AND departure.id = ${departureId}
    LIMIT 1
  `;
  if (!scope[0]) return NextResponse.json({ error: "Sfida non disponibile" }, { status: 403 });
  if (body?.action === "photoEvidence") {
    const contentId = String(body.contentId || "");
    const mediaId = String(body.mediaId || "");
    if (!/^[0-9a-f-]{36}$/i.test(contentId) || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
      return NextResponse.json({ error: "Foto-prova non valida" }, { status: 400 });
    }
    const linked = await sql`
      SELECT content.id::text, content.content_type
      FROM generated_content content
      JOIN media_assets media ON media.id = ${mediaId} AND media.agency_id = content.agency_id
        AND media.party_id = ${partyId} AND media.uploaded_by_user_id = ${user.id} AND media.status = 'ready'
      WHERE content.id = ${contentId} AND content.agency_id = ${String(scope[0].agency_id)}
        AND content.template_version_id = ${String(scope[0].template_version_id)}
        AND content.content_type IN ('mission', 'bingo_item', 'photo_contest')
      LIMIT 1
    `;
    if (!linked[0]) return NextResponse.json({ error: "Foto e sfida non corrispondono" }, { status: 400 });
    const contentType = String(linked[0].content_type);
    if (contentType === "photo_contest") {
      const slots = await sql`
        SELECT participant_slot FROM party_photo_contest_entries
        WHERE party_id = ${partyId} AND traveler_id = ${String(scope[0].traveler_id)}
          AND generated_content_id = ${contentId}
        ORDER BY participant_slot
      `;
      if (slots.length >= 3) return NextResponse.json({ error: "Hai già caricato 3 foto per questo contest" }, { status: 409 });
      const used = new Set(slots.map((row) => Number(row.participant_slot)));
      const slot = [1, 2, 3].find((candidate) => !used.has(candidate)) ?? 3;
      const rows = await sql`
        INSERT INTO party_photo_contest_entries (
          agency_id, party_id, traveler_id, generated_content_id, media_asset_id, participant_slot
        ) VALUES (
          ${String(scope[0].agency_id)}, ${partyId}, ${String(scope[0].traveler_id)},
          ${contentId}, ${mediaId}, ${slot}
        ) RETURNING id::text
      `;
      return NextResponse.json({ id: String(rows[0].id), slot, status: "submitted" });
    }
    const activityType = contentType === "mission" ? "mission" : "bingo";
    const rows = await sql`
      INSERT INTO party_activity_results (
        agency_id, party_id, traveler_id, trip_day_id, generated_content_id,
        activity_type, score, max_score, status, result
      ) VALUES (
        ${String(scope[0].agency_id)}, ${partyId}, ${String(scope[0].traveler_id)}, ${dayId},
        ${contentId}, ${activityType}, 0, 10, 'submitted', ${JSON.stringify({ mediaId })}::jsonb
      ) ON CONFLICT (party_id, traveler_id, generated_content_id) DO UPDATE SET
        trip_day_id = EXCLUDED.trip_day_id, status = 'submitted', score = 0,
        result = EXCLUDED.result, submitted_at = NOW(), updated_at = NOW()
      RETURNING id::text
    `;
    return NextResponse.json({ id: String(rows[0].id), status: "submitted" });
  }
  if (body?.action === "reviewEvidence") {
    if (!user.isAgencyAdmin) return NextResponse.json({ error: "Solo l’amministratore può validare le foto" }, { status: 403 });
    const resultId = String(body.resultId || "");
    const approved = body.approved === true;
    if (!/^[0-9a-f-]{36}$/i.test(resultId)) return NextResponse.json({ error: "Risultato non valido" }, { status: 400 });
    const reviewed = await sql`
      UPDATE party_activity_results result SET
        status = ${approved ? "approved" : "rejected"},
        score = CASE WHEN ${approved} AND result.activity_type = 'mission' THEN 10 ELSE 0 END,
        updated_at = NOW()
      WHERE result.id = ${resultId} AND result.party_id = ${partyId}
        AND result.agency_id = ${String(scope[0].agency_id)}
        AND result.activity_type IN ('mission', 'bingo') AND result.status = 'submitted'
      RETURNING result.id::text, result.status, result.score
    `;
    if (!reviewed[0]) return NextResponse.json({ error: "Foto già valutata o non disponibile" }, { status: 409 });
    return NextResponse.json({ id: String(reviewed[0].id), status: String(reviewed[0].status), score: Number(reviewed[0].score) });
  }
  const gameAction = String(body?.action || "");
  if (["game", "puzzle", "city", "visitCount"].includes(gameAction)) {
    const contentId = String(body?.contentId || "");
    const answer = String(body?.answer || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(contentId) || (gameAction !== "puzzle" && !answer)) {
      return NextResponse.json({ error: "Risposta non valida" }, { status: 400 });
    }
    const rows = await sql`
      SELECT content.id::text, content.content, day.city,
        (SELECT COUNT(*)::integer FROM itinerary_items item
         WHERE item.agency_id = content.agency_id AND item.trip_day_id = day.id
           AND item.item_type = 'visit') AS visit_count
      FROM generated_content content
      JOIN trip_days day ON day.id = content.trip_day_id AND day.agency_id = content.agency_id
      WHERE content.id = ${contentId} AND content.trip_day_id = ${dayId}
        AND content.agency_id = ${String(scope[0].agency_id)}
        AND content.template_version_id = ${String(scope[0].template_version_id)}
        AND content.content_type IN ('word_game', 'order_game') AND content.status = 'approved'
      LIMIT 1
    `;
    if (!rows[0]) return NextResponse.json({ error: "Gioco non disponibile" }, { status: 404 });
    const content = rows[0].content && typeof rows[0].content === "object" && !Array.isArray(rows[0].content)
      ? rows[0].content as Record<string, unknown> : {};
    const expected = gameAction === "city" ? String(rows[0].city || "").trim()
      : gameAction === "visitCount" ? String(rows[0].visit_count ?? "0")
        : String(content.answer || "").trim();
    const correct = gameAction === "puzzle"
      ? true
      : Boolean(expected) && normalizedAnswer(answer) === normalizedAnswer(expected);
    const score = correct ? 10 : 0;
    const saved = await sql`
      INSERT INTO party_activity_results (
        agency_id, party_id, traveler_id, trip_day_id, generated_content_id,
        activity_type, score, max_score, status, result
      ) VALUES (
        ${String(scope[0].agency_id)}, ${partyId}, ${String(scope[0].traveler_id)}, ${dayId},
        ${contentId}, 'game', ${score}, 10, 'approved',
        ${JSON.stringify({ answer, correct })}::jsonb
      ) ON CONFLICT (party_id, traveler_id, generated_content_id) DO UPDATE SET
        score = GREATEST(party_activity_results.score, EXCLUDED.score), max_score = 10,
        status = 'approved', result = EXCLUDED.result, submitted_at = NOW(), updated_at = NOW()
      RETURNING id::text, score
    `;
    return NextResponse.json({ id: String(saved[0].id), correct, score: Number(saved[0].score), maximum: 10, answer: correct ? "" : expected });
  }
  const answers = body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
    ? body.answers as Record<string, unknown> : null;
  if (!answers) return NextResponse.json({ error: "Risposte non valide" }, { status: 400 });
  const questionIds = Object.keys(answers).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const questions = questionIds.length ? await sql`
    SELECT id::text, content
    FROM generated_content
    WHERE id = ANY(${questionIds}::uuid[]) AND trip_day_id = ${dayId}
      AND agency_id = ${String(scope[0].agency_id)} AND content_type = 'quiz_question' AND status = 'approved'
  ` : [];
  if (questions.length === 0 || questions.length !== questionIds.length) {
    return NextResponse.json({ error: "Completa tutte le domande disponibili" }, { status: 400 });
  }
  const results = questions.map((question) => {
    const content = question.content as Record<string, unknown>;
    const selected = Number(answers[String(question.id)]);
    const correctIndex = Number(content.correctIndex);
    return { id: String(question.id), selected, correctIndex, correct: selected === correctIndex };
  });
  await sql.transaction((txn) => results.map((result) => txn`
    INSERT INTO party_activity_results (
      agency_id, party_id, traveler_id, trip_day_id, generated_content_id,
      activity_type, score, max_score, status, result
    ) VALUES (
      ${String(scope[0].agency_id)}, ${partyId}, ${String(scope[0].traveler_id)}, ${dayId},
      ${result.id}, 'quiz', ${result.correct ? 1 : 0}, 1, 'approved',
      ${JSON.stringify({ selected: result.selected, correctIndex: result.correctIndex })}::jsonb
    ) ON CONFLICT (party_id, traveler_id, generated_content_id) DO UPDATE SET
      score = EXCLUDED.score, max_score = EXCLUDED.max_score, status = 'approved',
      result = EXCLUDED.result, submitted_at = NOW(), updated_at = NOW()
  `));
  return NextResponse.json({ score: results.filter((result) => result.correct).length, maximum: results.length, results });
}
