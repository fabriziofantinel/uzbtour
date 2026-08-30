import "server-only";
import { getSql } from "@/lib/db";

export type AgencyAnalytics = {
  periodDays: number;
  generatedAt: string;
  summary: {
    invitedTravelers: number; activatedTravelers: number; activeTravelers: number;
    programmeViews: number; documentUsers: number; assistanceRequests: number;
    engagementActions: number; averageFeedback: number | null; feedbackCount: number;
  };
  departures: Array<{
    id: string; title: string; startsOn: string; travelers: number; activated: number;
    active: number; programmeViews: number; documentUsers: number;
    assistanceRequests: number; engagementActions: number; feedbackAverage: number | null;
  }>;
  feedback: Array<{
    itemId: string; dayNumber: number; dayTitle: string; itemTitle: string;
    average: number; responses: number;
  }>;
  definitions: Array<{ code:string; label:string; formula:string; numerator:string; denominator:string; refreshMinutes:number; version:number }>;
};

const numberValue = (value: unknown) => Number(value ?? 0);
const nullableNumber = (value: unknown) => value == null ? null : Number(value);

export async function getAgencyAnalytics(input: {
  agencyId: string; periodDays: number; departureId?: string;
}): Promise<AgencyAnalytics> {
  const sql = getSql();
  const periodDays = [7, 30, 90].includes(input.periodDays) ? input.periodDays : 30;
  const departureId = input.departureId || null;
  const [,,summaryRows,departureRows,feedbackRows,definitionRows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,
    txn`SELECT set_config('app.analytics_days',${String(periodDays)},true)`,
    txn`
      WITH population AS (
        SELECT count(DISTINCT membership.traveler_id) AS invited,
          count(DISTINCT membership.traveler_id) FILTER (WHERE profile.user_id IS NOT NULL) AS activated
        FROM travel.party_memberships membership
        JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
        WHERE membership.agency_id=${input.agencyId} AND membership.status<>'removed'
          AND (${departureId}::uuid IS NULL OR membership.departure_id=${departureId}::uuid)
      ), events AS (
        SELECT count(DISTINCT actor_user_id) FILTER (WHERE event_name='traveler_session') AS active,
          count(*) FILTER (WHERE event_name='programme_view') AS programme_views,
          count(DISTINCT actor_user_id) FILTER (WHERE event_name='document_download') AS document_users
        FROM ops.product_analytics_events
        WHERE agency_id=${input.agencyId} AND occurred_at>=now()-make_interval(days=>${periodDays})
          AND (${departureId}::uuid IS NULL OR departure_id=${departureId}::uuid)
      ), assistance AS (
        SELECT count(*) AS requests FROM journey.operational_messages
        WHERE agency_id=${input.agencyId} AND sender_role='traveler' AND deleted_at IS NULL
          AND created_at>=now()-make_interval(days=>${periodDays})
          AND (${departureId}::uuid IS NULL OR departure_id=${departureId}::uuid)
      ), engagement AS (
        SELECT (SELECT count(*) FROM journey.activity_attempts WHERE agency_id=${input.agencyId}
          AND status<>'draft' AND submitted_at>=now()-make_interval(days=>${periodDays})
          AND (${departureId}::uuid IS NULL OR departure_id=${departureId}::uuid))
        + (SELECT count(*) FROM journey.photo_contest_entries WHERE agency_id=${input.agencyId}
          AND submitted_at>=now()-make_interval(days=>${periodDays})
          AND (${departureId}::uuid IS NULL OR departure_id=${departureId}::uuid)) AS actions
      ), feedback AS (
        SELECT avg(rating)::numeric(4,2) AS average,count(*) AS count FROM journey.programme_feedback
        WHERE agency_id=${input.agencyId} AND updated_at>=now()-make_interval(days=>${periodDays})
          AND (${departureId}::uuid IS NULL OR departure_id=${departureId}::uuid)
      ) SELECT * FROM population,events,assistance,engagement,feedback`,
    txn`
      SELECT departure.id::text,departure.title,departure.starts_on::text,
        count(DISTINCT membership.traveler_id) FILTER (WHERE membership.status<>'removed') AS travelers,
        count(DISTINCT profile.id) FILTER (WHERE membership.status<>'removed' AND profile.user_id IS NOT NULL) AS activated,
        count(DISTINCT event.actor_user_id) FILTER (WHERE event.event_name='traveler_session') AS active,
        count(DISTINCT event.id) FILTER (WHERE event.event_name='programme_view') AS programme_views,
        count(DISTINCT event.actor_user_id) FILTER (WHERE event.event_name='document_download') AS document_users,
        (SELECT count(*) FROM journey.operational_messages message WHERE message.agency_id=departure.agency_id
          AND message.departure_id=departure.id AND message.sender_role='traveler' AND message.deleted_at IS NULL
          AND message.created_at>=now()-make_interval(days=>${periodDays})) AS assistance_requests,
        (SELECT count(*) FROM journey.activity_attempts attempt WHERE attempt.agency_id=departure.agency_id
          AND attempt.departure_id=departure.id AND attempt.status<>'draft'
          AND attempt.submitted_at>=now()-make_interval(days=>${periodDays}))
        + (SELECT count(*) FROM journey.photo_contest_entries entry WHERE entry.agency_id=departure.agency_id
          AND entry.departure_id=departure.id AND entry.submitted_at>=now()-make_interval(days=>${periodDays})) AS engagement_actions,
        (SELECT avg(rating)::numeric(4,2) FROM journey.programme_feedback feedback WHERE feedback.agency_id=departure.agency_id
          AND feedback.departure_id=departure.id AND feedback.updated_at>=now()-make_interval(days=>${periodDays})) AS feedback_average
      FROM travel.departures departure
      LEFT JOIN travel.party_memberships membership ON membership.agency_id=departure.agency_id AND membership.departure_id=departure.id
      LEFT JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
      LEFT JOIN ops.product_analytics_events event ON event.agency_id=departure.agency_id AND event.departure_id=departure.id
        AND event.occurred_at>=now()-make_interval(days=>${periodDays})
      WHERE departure.agency_id=${input.agencyId} AND (${departureId}::uuid IS NULL OR departure.id=${departureId}::uuid)
      GROUP BY departure.agency_id,departure.id,departure.title,departure.starts_on
      ORDER BY departure.starts_on DESC,departure.title`,
    txn`
      SELECT item.id::text AS item_id,template_day.day_number,COALESCE(NULLIF(template_day.title,''),'Giornata '||template_day.day_number) AS day_title,
        item.title AS item_title,avg(feedback.rating)::numeric(4,2) AS average,count(*) AS responses
      FROM journey.programme_feedback feedback
      JOIN travel.departure_itinerary_items item ON item.agency_id=feedback.agency_id
        AND item.departure_id=feedback.departure_id AND item.id=feedback.departure_item_id
      JOIN travel.departure_days day ON day.agency_id=item.agency_id AND day.departure_id=item.departure_id
        AND day.id=item.departure_day_id
      JOIN travel.template_days template_day ON template_day.agency_id=day.agency_id
        AND template_day.template_version_id=day.template_version_id
        AND template_day.id=day.template_day_id
      WHERE feedback.agency_id=${input.agencyId} AND feedback.updated_at>=now()-make_interval(days=>${periodDays})
        AND (${departureId}::uuid IS NULL OR feedback.departure_id=${departureId}::uuid)
      GROUP BY item.id,template_day.day_number,template_day.title,item.title
      ORDER BY template_day.day_number,average ASC,item.title LIMIT 80`,
    txn`SELECT code,label,formula,numerator_definition,denominator_definition,
      GREATEST(1,extract(epoch FROM refresh_interval)/60)::int refresh_minutes,version
      FROM ops.analytics_kpi_definitions WHERE effective_to IS NULL ORDER BY code`,
  ], { readOnly: true });
  const summary = summaryRows[0] ?? {};
  return {
    periodDays, generatedAt: new Date().toISOString(),
    summary: {
      invitedTravelers: numberValue(summary.invited), activatedTravelers: numberValue(summary.activated),
      activeTravelers: numberValue(summary.active), programmeViews: numberValue(summary.programme_views),
      documentUsers: numberValue(summary.document_users), assistanceRequests: numberValue(summary.requests),
      engagementActions: numberValue(summary.actions), averageFeedback: nullableNumber(summary.average),
      feedbackCount: numberValue(summary.count),
    },
    departures: departureRows.map((row) => ({
      id:String(row.id),title:String(row.title),startsOn:String(row.starts_on),travelers:numberValue(row.travelers),
      activated:numberValue(row.activated),active:numberValue(row.active),programmeViews:numberValue(row.programme_views),
      documentUsers:numberValue(row.document_users),assistanceRequests:numberValue(row.assistance_requests),
      engagementActions:numberValue(row.engagement_actions),feedbackAverage:nullableNumber(row.feedback_average),
    })),
    feedback: feedbackRows.map((row) => ({
      itemId:String(row.item_id),dayNumber:numberValue(row.day_number),dayTitle:String(row.day_title),
      itemTitle:String(row.item_title),average:numberValue(row.average),responses:numberValue(row.responses),
    })),
    definitions: definitionRows.map((row)=>({code:String(row.code),label:String(row.label),formula:String(row.formula),
      numerator:String(row.numerator_definition),denominator:String(row.denominator_definition||"Non applicabile"),
      refreshMinutes:Number(row.refresh_minutes),version:Number(row.version)})),
  };
}

export async function recordTravelerAnalytics(input: {
  userId: string; departureId: string; partyId: string; dayId?: string | null;
  eventName: string; sessionId: string; clientOperationId: string; properties?: Record<string, unknown>;
}) {
  const rows = await getSql()`SELECT app.record_product_analytics_event_v3(
    ${input.userId},${input.departureId}::uuid,${input.partyId}::uuid,${input.dayId ?? null}::uuid,
    ${input.eventName},${input.sessionId}::uuid,${input.clientOperationId}::uuid,${JSON.stringify(input.properties ?? {})}::jsonb
  )::text AS id`;
  return String(rows[0].id);
}
