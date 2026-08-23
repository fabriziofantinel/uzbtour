import { getSql } from "@/lib/db";

type ReferenceRow = {
  trip_day_id: string | null;
  content_type: string;
  content: unknown;
};

function arrayContent(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function materializeTripExperience(templateId: string, agencyId: string) {
  const sql = getSql();
  const versions = await sql`
    SELECT id::text
    FROM trip_template_versions
    WHERE template_id = ${templateId} AND agency_id = ${agencyId} AND status = 'published'
    ORDER BY version_number DESC
    LIMIT 1
  `;
  if (!versions[0]) throw new Error("Versione pubblicata del viaggio non trovata");
  const versionId = String(versions[0].id);

  const [countryRows, dayRows] = await Promise.all([
    sql`
      SELECT NULL::text AS trip_day_id, rc.content_type, rc.content
      FROM trip_countries tc
      JOIN reference_contents rc
        ON rc.entity_type = 'country' AND rc.entity_id = tc.country_id
        AND rc.locale = 'it-IT' AND rc.status = 'ready'
      WHERE tc.template_id = ${templateId}
        AND rc.content_type IN ('useful_info', 'phrasebook', 'bingo')
    `,
    sql`
      SELECT DISTINCT td.id::text AS trip_day_id, rc.content_type, rc.content,
        CASE rc.entity_type WHEN 'city' THEN 0 ELSE 1 END AS entity_order
      FROM trip_days td
      JOIN (
        SELECT trip_day_id, 'city'::text AS entity_type, city_id AS entity_id
        FROM trip_day_cities
        UNION ALL
        SELECT trip_day_id, 'site'::text, site_id
        FROM trip_day_sites
      ) entities ON entities.trip_day_id = td.id
      JOIN reference_contents rc
        ON rc.entity_type = entities.entity_type AND rc.entity_id = entities.entity_id
        AND rc.locale = 'it-IT' AND rc.status = 'ready'
      WHERE td.template_version_id = ${versionId} AND td.agency_id = ${agencyId}
        AND rc.content_type IN ('quiz', 'mission', 'game', 'photo_contest')
      ORDER BY trip_day_id, entity_order, content_type
    `,
  ]);
  const countries = countryRows as ReferenceRow[];
  const days = dayRows as ReferenceRow[];

  const usefulEntries: Array<{ category: string; title: string; body: string; sortOrder: number }> = [];
  const phraseEntries: Array<{ language: string; term: string; pronunciation: string; translation: string; sortOrder: number }> = [];
  const generatedEntries: Array<{
    tripDayId: string | null;
    contentType: string;
    title: string;
    content: Record<string, unknown>;
    sortOrder: number;
  }> = [];
  let bingoCount = 0;

  for (const row of countries) {
    const entries = arrayContent(row.content);
    if (row.content_type === "useful_info") {
      entries.forEach((entry, index) => usefulEntries.push({
        category: text(entry.category) || "Generale",
        title: text(entry.title) || "Informazione utile",
        body: text(entry.body),
        sortOrder: index,
      }));
    } else if (row.content_type === "phrasebook") {
      entries.forEach((entry, index) => phraseEntries.push({
        language: text(entry.language) || "local",
        term: text(entry.term),
        pronunciation: text(entry.pronunciation),
        translation: text(entry.translation),
        sortOrder: index,
      }));
    } else if (row.content_type === "bingo") {
      entries.forEach((entry, index) => {
        if (bingoCount >= 25) return;
        generatedEntries.push({
          tripDayId: null,
          contentType: "bingo_item",
          title: text(entry.title),
          content: entry,
          sortOrder: index,
        });
        bingoCount += 1;
      });
    }
  }

  let sortOrder = 0;
  const dayContentCounts = new Map<string, number>();
  for (const row of days) {
    const mappedType = row.content_type === "quiz" ? "quiz_question"
      : row.content_type === "mission" ? "mission"
        : row.content_type === "photo_contest" ? "photo_contest"
          : null;
    for (const entry of arrayContent(row.content)) {
      const gameType = text(entry.type) === "order" ? "order_game" : "word_game";
      const contentType = mappedType ?? gameType;
      const contentGroup = row.content_type === "game" ? "game" : row.content_type;
      const limit = contentGroup === "quiz" ? 15
        : contentGroup === "mission" ? 10
          : contentGroup === "game" ? 6 : 2;
      const countKey = `${row.trip_day_id}:${contentGroup}`;
      const currentCount = dayContentCounts.get(countKey) ?? 0;
      if (currentCount >= limit) continue;
      dayContentCounts.set(countKey, currentCount + 1);
      const title = text(entry.title) || text(entry.question) || "Sfida del giorno";
      generatedEntries.push({
        tripDayId: row.trip_day_id,
        contentType,
        title,
        content: entry,
        sortOrder,
      });
      sortOrder += 1;
    }
  }

  await sql.transaction((txn) => [
    txn`DELETE FROM useful_information WHERE agency_id = ${agencyId} AND template_version_id = ${versionId} AND metadata->>'source' = 'ai'`,
    txn`DELETE FROM phrasebook_entries WHERE agency_id = ${agencyId} AND template_version_id = ${versionId} AND source = 'ai'`,
    txn`DELETE FROM generated_content WHERE agency_id = ${agencyId} AND template_version_id = ${versionId} AND source = 'ai'`,
    ...usefulEntries.map((entry) => txn`
      INSERT INTO useful_information (
        agency_id, template_version_id, category, title, body, sort_order, metadata
      ) VALUES (
        ${agencyId}, ${versionId}, ${entry.category}, ${entry.title}, ${entry.body},
        ${entry.sortOrder}, '{"source":"ai"}'::jsonb
      )
    `),
    ...phraseEntries.map((entry) => txn`
      INSERT INTO phrasebook_entries (
        agency_id, template_version_id, language_code, category, term,
        pronunciation, translation, sort_order, source
      ) VALUES (
        ${agencyId}, ${versionId}, ${entry.language}, 'general', ${entry.term},
        ${entry.pronunciation}, ${entry.translation}, ${entry.sortOrder}, 'ai'
      )
    `),
    ...generatedEntries.map((entry) => txn`
      INSERT INTO generated_content (
        agency_id, template_version_id, trip_day_id, content_type, title,
        content, status, source, sort_order
      ) VALUES (
        ${agencyId}, ${versionId}, ${entry.tripDayId}, ${entry.contentType}, ${entry.title},
        ${JSON.stringify(entry.content)}::jsonb, 'approved', 'ai', ${entry.sortOrder}
      )
    `),
  ]);
  return { versionId, generatedSections: usefulEntries.length + phraseEntries.length + generatedEntries.length };
}
