import { getSql } from "@/lib/db";

type ReferenceRow = { template_version_id: string; template_day_id: string | null; content_type: string; content: unknown; entity_order: number };
type ActivityItem = { ordinal: number; itemKind: "question" | "mission" | "bingo_cell" | "word" | "order_step" | "contest_rule"; prompt: string; payload: Record<string, unknown>; answerSpec: Record<string, unknown>; points: number };
type MaterializedActivity = {
  templateDayId: string | null;
  activityType: "quiz" | "mission" | "bingo" | "word_game" | "order_game" | "photo_contest";
  contestCategory: "free" | "theme" | null;
  title: string;
  instructions: string;
  availabilityRule: "always" | "relative_day_time";
  relativeDays: number | null;
  unlockLocalTime: string | null;
  maxScore: number | null;
  maxEntries: number | null;
  sortOrder: number;
  items: ActivityItem[];
};

function arrayContent(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
async function applyUsefulInformationGovernance(jobId:string,agencyId:string,versionId:string){
  const sql=getSql();
  await sql.transaction((txn)=>[
    txn`SELECT set_config('app.materialization_job_id',${jobId},true)`,
    txn`UPDATE travel.template_useful_information SET
      source_name=CASE WHEN COALESCE(url,'')<>'' THEN 'Fonte ufficiale indicata' ELSE NULL END,
      source_url=NULLIF(url,''),source_retrieved_at=clock_timestamp(),review_status='needs_review',verified_at=NULL,
      expires_at=clock_timestamp()+CASE WHEN lower(category)~'(salute|document|sicurezza|emergenza|ambasciata)' THEN interval '7 days' ELSE interval '90 days' END,
      disclaimer='Contenuto informativo generato con supporto AI e soggetto a verifica dell’agenzia. Per salute, sicurezza e requisiti di ingresso consulta sempre la fonte ufficiale.'
      WHERE agency_id=${agencyId} AND template_version_id=${versionId}`,
  ]);
}

export async function materializeTripUsefulInformation(jobId: string, templateId: string, agencyId: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM app.read_trip_reference_content_v3(${jobId},${agencyId},${templateId})` as ReferenceRow[];
  const usefulEntries: Array<{ category: string; title: string; body: string; phone: string; url: string; sortOrder: number }> = [];
  for (const row of rows.filter((item) => item.content_type === "useful_info")) {
    for (const entry of arrayContent(row.content)) usefulEntries.push({
      category: text(entry.category) || "Generale", title: text(entry.title) || "Informazione utile",
      body: text(entry.body), phone: text(entry.phone), url: text(entry.url), sortOrder: usefulEntries.length,
    });
  }
  if (usefulEntries.length === 0) throw new Error("Informazioni utili di riferimento non disponibili");
  const result = await sql`SELECT * FROM app.replace_trip_useful_information_v3(${jobId},${agencyId},${templateId},${JSON.stringify(usefulEntries)}::jsonb)`;
  if (!result[0]) throw new Error("Materializzazione delle informazioni utili non completata");
  await applyUsefulInformationGovernance(jobId,agencyId,String(result[0].template_version_id));
  return { versionId: String(result[0].template_version_id), generatedSections: Number(result[0].generated_sections) };
}

export async function materializeTripExperience(jobId: string, templateId: string, agencyId: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM app.read_trip_reference_content_v3(${jobId},${agencyId},${templateId})` as ReferenceRow[];
  if (!rows[0]) throw new Error("Contenuti di riferimento del viaggio non disponibili");

  const usefulEntries: Array<{ category: string; title: string; body: string; phone: string; url: string; sortOrder: number }> = [];
  const phraseEntries: Array<{ language: string; term: string; pronunciation: string; translation: string; sortOrder: number }> = [];
  const activities: MaterializedActivity[] = [];
  const grouped = new Map<string, MaterializedActivity>();
  const daySources = new Map<string, { dayId: string; contentType: string; sources: Array<{ entityOrder: number; entries: Array<Record<string, unknown>> }> }>();
  let activitySort = 0;
  const ensureGroup = (dayId: string | null, type: "quiz" | "mission" | "bingo") => {
    const key = `${dayId ?? "trip"}:${type}`;
    const existing = grouped.get(key);
    if (existing) return existing;
    const activity: MaterializedActivity = {
      templateDayId: dayId, activityType: type, contestCategory: null,
      title: type === "quiz" ? "Quiz del giorno" : type === "mission" ? "Missioni del giorno" : "Bingo del viaggio",
      instructions: type === "quiz" ? "Rispondi alle domande sulle visite della giornata."
        : type === "mission" ? "Completa le missioni e documentale con una foto."
          : "Completa la cartella fotografica durante il viaggio.",
      availabilityRule: type === "quiz" || type === "mission" ? "relative_day_time" : "always",
      relativeDays: type === "quiz" ? 0 : type === "mission" ? -2 : null,
      unlockLocalTime: type === "quiz" || type === "mission" ? "20:00" : null,
      maxScore: null, maxEntries: null, sortOrder: activitySort++, items: [],
    };
    grouped.set(key, activity); activities.push(activity); return activity;
  };

  for (const row of rows) {
    const entries = arrayContent(row.content);
    if (row.content_type === "useful_info") {
      entries.forEach((entry) => usefulEntries.push({ category: text(entry.category) || "Generale", title: text(entry.title) || "Informazione utile", body: text(entry.body), phone: text(entry.phone), url: text(entry.url), sortOrder: usefulEntries.length }));
      continue;
    }
    if (row.content_type === "phrasebook") {
      entries.forEach((entry) => phraseEntries.push({ language: text(entry.language) || "local", term: text(entry.term), pronunciation: text(entry.pronunciation), translation: text(entry.translation), sortOrder: phraseEntries.length }));
      continue;
    }
    if (row.content_type === "bingo") {
      const activity = ensureGroup(null, "bingo");
      for (const entry of entries) {
        if (activity.items.length >= 25) break;
        activity.items.push({ ordinal: activity.items.length + 1, itemKind: "bingo_cell", prompt: text(entry.title), payload: { description: text(entry.description), photoValidation: record(entry.photoValidation) }, answerSpec: { validation: "photo" }, points: 0 });
      }
      continue;
    }
    const dayId = row.template_day_id;
    if (!dayId) continue;
    if (!["quiz", "mission", "game", "photo_contest"].includes(row.content_type)) continue;
    const key = `${dayId}:${row.content_type}`;
    const source = daySources.get(key) ?? { dayId, contentType: row.content_type, sources: [] };
    source.sources.push({ entityOrder: row.entity_order, entries });
    daySources.set(key, source);
  }

  // Alternate city and site sources so a day's activities represent the whole
  // itinerary rather than being exhausted by the first entity returned by SQL.
  for (const { dayId, contentType, sources } of daySources.values()) {
    const limit = contentType === "quiz" ? 10 : contentType === "mission" ? 5 : contentType === "game" ? 3 : 2;
    const sourceGroups = [0, 1].map((entityOrder) => {
      const group = sources.filter((source) => source.entityOrder === entityOrder);
      const flattened: Array<Record<string, unknown>> = [];
      for (let itemIndex = 0; ; itemIndex += 1) {
        let added = false;
        for (const source of group) {
          const entry = source.entries[itemIndex];
          if (!entry) continue;
          flattened.push(entry); added = true;
        }
        if (!added) break;
      }
      return flattened;
    });
    const [cityEntries, siteEntries] = sourceGroups;
    let selected: Array<Record<string, unknown>>;
    if (contentType === "game") {
      const candidates = [...siteEntries, ...cityEntries];
      selected = ["photo_puzzle", "memory", "odd_one_out"]
        .map((type) => candidates.find((entry) => text(entry.type) === type))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    } else if (contentType === "quiz" && cityEntries.length > 0 && siteEntries.length > 0) {
      const prioritized = [
        ...cityEntries.slice(0, 1),
        ...siteEntries.slice(0, 4),
        ...cityEntries.slice(1, 2),
        ...siteEntries.slice(4, 8),
      ];
      selected = [...prioritized, ...siteEntries.slice(8), ...cityEntries.slice(2)].slice(0, limit);
    } else {
      const preferred = siteEntries.length > 0 ? siteEntries : cityEntries;
      const fallback = siteEntries.length > 0 ? cityEntries : [];
      selected = [...preferred, ...fallback].slice(0, limit);
    }
    if (contentType === "quiz" || contentType === "mission") {
      const type = contentType;
      const activity = ensureGroup(dayId, type);
      for (const entry of selected) activity.items.push(type === "quiz"
        ? { ordinal: activity.items.length + 1, itemKind: "question", prompt: text(entry.question) || text(entry.title), payload: { options: Array.isArray(entry.options) ? entry.options : [], explanation: text(entry.explanation), sourceUrl: text(entry.sourceUrl) }, answerSpec: { correctIndex: entry.correctIndex }, points: 1 }
        : { ordinal: activity.items.length + 1, itemKind: "mission", prompt: text(entry.title), payload: { description: text(entry.description), photoValidation: record(entry.photoValidation) }, answerSpec: { validation: "photo" }, points: 10 });
      activity.maxScore = activity.items.reduce((total, item) => total + item.points, 0);
      continue;
    }
    selected.forEach((entry, index) => {
      if (contentType === "game") {
        const gameType = text(entry.type);
        const isOddOneOut = gameType === "odd_one_out";
        activities.push({
          templateDayId: dayId,
          activityType: isOddOneOut ? "order_game" : "word_game",
          contestCategory: null,
          title: text(entry.title) || "Gioco del giorno",
          instructions: text(entry.instructions),
          availabilityRule: "always",
          relativeDays: null,
          unlockLocalTime: null,
          maxScore: 10,
          maxEntries: null,
          sortOrder: activitySort++,
          items: [{
            ordinal: 1,
            itemKind: isOddOneOut ? "order_step" : "word",
            prompt: text(entry.title),
            payload: {
              type: gameType,
              instructions: text(entry.instructions),
              pairs: Array.isArray(entry.pairs) ? entry.pairs : [],
              options: Array.isArray(entry.options) ? entry.options : [],
            },
            answerSpec: isOddOneOut ? { correctIndex: entry.correctIndex } : { answer: "complete" },
            points: 10,
          }],
        });
      } else {
        const category = index === 0 ? "free" : "theme";
        activities.push({ templateDayId: dayId, activityType: "photo_contest", contestCategory: category, title: text(entry.title) || (category === "free" ? "Tema libero" : "Tema del giorno"), instructions: text(entry.description), availabilityRule: "always", relativeDays: null, unlockLocalTime: null, maxScore: null, maxEntries: 2, sortOrder: activitySort++, items: [{ ordinal: 1, itemKind: "contest_rule", prompt: text(entry.title), payload: { description: text(entry.description), photoValidation: record(entry.photoValidation) }, answerSpec: {}, points: 0 }] });
      }
    });
  }

  const result = await sql`SELECT * FROM app.replace_trip_experience_v3(${jobId},${agencyId},${templateId},${JSON.stringify(usefulEntries)}::jsonb,${JSON.stringify(phraseEntries)}::jsonb,${JSON.stringify(activities)}::jsonb)`;
  if (!result[0]) throw new Error("Materializzazione dei contenuti non completata");
  await sql`SELECT app.apply_generated_useful_information_contacts_v3(${jobId},${agencyId},${templateId},${JSON.stringify(usefulEntries)}::jsonb)`;
  await applyUsefulInformationGovernance(jobId,agencyId,String(result[0].template_version_id));
  return { versionId: String(result[0].template_version_id), generatedSections: Number(result[0].generated_sections) };
}
