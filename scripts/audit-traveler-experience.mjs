import { Client } from "@neondatabase/serverless";

const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL;
const userSelector=process.argv[2];
if(!url||!userSelector)throw new Error("Connessione o utente audit non configurati");
const client=new Client(url);
await client.connect();
try{
  const candidates=(await client.query(`SELECT map.legacy_id AS legacy_user_id
    FROM iam.users account JOIN ops.legacy_id_map map ON map.target_id=account.id
      AND map.source_system='public-v2' AND map.entity_type='user'
    WHERE map.legacy_id=$1 OR lower(account.display_name) LIKE lower('%'||$1||'%')`,[userSelector])).rows;
  if(candidates.length!==1)throw new Error(`Il selettore utente deve individuare un solo profilo (trovati: ${candidates.length})`);
  const legacyUserId=candidates[0].legacy_user_id;
  const journeys=(await client.query("SELECT * FROM app.list_legacy_user_journeys($1)",[legacyUserId])).rows;
  const reports=[];
  for(const journey of journeys){
    await client.query("SELECT set_config('app.agency_id',$1,false)",[journey.agency_id]);
    const params=[journey.agency_id,journey.departure_id,journey.party_id,journey.template_version_id];
    const [catalog,activities,documents,finance,parties,referenceContent,accessGrants,quizEligibility,runtimeCandidates,identityDiagnostic]=await Promise.all([
      client.query(`SELECT
        (SELECT count(*) FROM travel.template_days WHERE agency_id=$1 AND template_version_id=$3) days,
        (SELECT count(*) FROM travel.departure_itinerary_items WHERE agency_id=$1 AND departure_id=$2) items,
        (SELECT count(*) FROM travel.template_day_cities WHERE agency_id=$1 AND template_version_id=$3) cities,
        (SELECT count(*) FROM travel.template_day_sites WHERE agency_id=$1 AND template_version_id=$3) sites,
        (SELECT count(*) FROM travel.template_day_hotels WHERE agency_id=$1 AND template_version_id=$3) hotels,
        (SELECT count(*) FROM travel.template_useful_information WHERE agency_id=$1 AND template_version_id=$3) useful_info,
        (SELECT count(*) FROM travel.template_phrasebook_entries WHERE agency_id=$1 AND template_version_id=$3) phrases`,[journey.agency_id,journey.departure_id,journey.template_version_id]),
      client.query(`SELECT COALESCE(day.day_number,0) AS day_number,activity.activity_type,count(item.id)::int items,
          array_agg(item.prompt ORDER BY item.ordinal) FILTER(WHERE item.prompt<>'') titles
        FROM content.activities activity
        LEFT JOIN content.activity_items item ON item.activity_id=activity.id AND item.agency_id=activity.agency_id
        LEFT JOIN travel.template_days day ON day.id=activity.template_day_id AND day.agency_id=activity.agency_id
        WHERE activity.agency_id=$1 AND activity.template_version_id=$2 AND activity.status='approved'
        GROUP BY day.day_number,activity.activity_type ORDER BY day.day_number,activity.activity_type`,[journey.agency_id,journey.template_version_id]),
      client.query(`SELECT count(*)::int total,
          count(*) FILTER(WHERE document.party_id=$3)::int current_party,
          count(*) FILTER(WHERE document.party_id<>$3)::int other_parties
        FROM ops.travel_documents document JOIN ops.media_assets asset ON asset.id=document.media_asset_id
        WHERE document.agency_id=$1 AND document.departure_id=$2 AND document.status='ready'
          AND asset.status='ready' AND asset.deleted_at IS NULL`,[journey.agency_id,journey.departure_id,journey.party_id]),
      client.query(`SELECT
        (SELECT count(*) FROM journey.expenses WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3)::int expenses,
        (SELECT count(*) FROM journey.cash_movements WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3)::int cash`,[journey.agency_id,journey.departure_id,journey.party_id]),
      client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE id=$3)::int current
        FROM travel.travel_parties WHERE agency_id=$1 AND departure_id=$2`,[journey.agency_id,journey.departure_id,journey.party_id]),
      client.query(`WITH entities AS(
          SELECT 'country' entity_type,country.country_id entity_id FROM travel.template_countries country
          WHERE country.agency_id=$1 AND country.template_id=(SELECT template_id FROM travel.departures WHERE id=$2)
          UNION ALL SELECT 'city',city.city_id FROM travel.template_day_cities city
          WHERE city.agency_id=$1 AND city.template_version_id=$3
          UNION ALL SELECT 'site',site.visit_site_id FROM travel.template_day_sites site
          WHERE site.agency_id=$1 AND site.template_version_id=$3)
        SELECT entity.entity_type,content.content_type,content.status,count(*)::int entries
        FROM entities entity JOIN ref.reference_contents content
          ON (entity.entity_type='country' AND content.country_id=entity.entity_id)
          OR (entity.entity_type='city' AND content.city_id=entity.entity_id)
          OR (entity.entity_type='site' AND content.visit_site_id=entity.entity_id)
        WHERE content.locale='it-IT' GROUP BY entity.entity_type,content.content_type,content.status
        ORDER BY entity.entity_type,content.content_type,content.status`,[journey.agency_id,journey.departure_id,journey.template_version_id]),
      client.query(`SELECT count(*)::int total,
          count(*) FILTER(WHERE revoked_at IS NULL AND available_at<=clock_timestamp()
            AND (expires_at IS NULL OR expires_at>clock_timestamp()))::int active
        FROM journey.activity_access_grants
        WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3`,
        [journey.agency_id,journey.departure_id,journey.party_id]),
      client.query(`SELECT activity.availability_rule,count(*)::int activities,
          count(*) FILTER(WHERE activity.availability_rule='always' OR
            (activity.availability_rule='relative_day_time' AND operational_day.service_date IS NOT NULL
             AND (((operational_day.service_date+activity.relative_days)+activity.unlock_local_time)
               AT TIME ZONE departure.timezone)<=clock_timestamp()))::int eligible
        FROM content.activities activity
        JOIN travel.departures departure ON departure.agency_id=activity.agency_id
          AND departure.id=$2 AND departure.template_version_id=activity.template_version_id
        LEFT JOIN travel.departure_days operational_day ON operational_day.agency_id=activity.agency_id
          AND operational_day.departure_id=departure.id AND operational_day.template_day_id=activity.template_day_id
        WHERE activity.agency_id=$1 AND activity.template_version_id=$3
          AND activity.activity_type='quiz' AND activity.status='approved'
        GROUP BY activity.availability_rule`,[journey.agency_id,journey.departure_id,journey.template_version_id]),
      client.query(`SELECT count(*)::int candidates FROM travel.traveler_profiles traveler
        JOIN travel.party_memberships membership ON membership.agency_id=traveler.agency_id
          AND membership.traveler_id=traveler.id AND membership.departure_id=$2
          AND membership.party_id=$3 AND membership.status='active'
        JOIN travel.departures departure ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
        JOIN content.activities activity ON activity.agency_id=departure.agency_id
          AND activity.template_version_id=departure.template_version_id
          AND activity.activity_type='quiz' AND activity.status='approved'
        LEFT JOIN travel.departure_days operational_day ON operational_day.agency_id=activity.agency_id
          AND operational_day.departure_id=departure.id AND operational_day.template_day_id=activity.template_day_id
        WHERE traveler.agency_id=$1 AND traveler.user_id=app.resolve_legacy_user_id($4,$1)
          AND (activity.availability_rule='always' OR (activity.availability_rule='relative_day_time'
            AND operational_day.service_date IS NOT NULL
            AND (((operational_day.service_date+activity.relative_days)+activity.unlock_local_time)
              AT TIME ZONE departure.timezone)<=clock_timestamp()))`,
        [journey.agency_id,journey.departure_id,journey.party_id,legacyUserId]),
      client.query(`SELECT traveler.id::text traveler_id,traveler.user_id::text profile_user_id,
          app.resolve_legacy_user_id($4,$1)::text resolved_user_id
        FROM travel.traveler_profiles traveler
        JOIN travel.party_memberships membership ON membership.agency_id=traveler.agency_id
          AND membership.traveler_id=traveler.id AND membership.departure_id=$2 AND membership.party_id=$3
        WHERE traveler.agency_id=$1`,[journey.agency_id,journey.departure_id,journey.party_id,legacyUserId]),
    ]);
    reports.push({journey:{templateId:journey.template_id,departureId:journey.departure_id,title:journey.title,country:journey.destination_country,party:journey.party_name,
      agency:journey.agency_name,branding:journey.agency_branding},catalog:catalog.rows[0],activities:activities.rows,
      documents:documents.rows[0],finance:finance.rows[0],parties:parties.rows[0],referenceContent:referenceContent.rows,
      accessGrants:accessGrants.rows[0],quizEligibility:quizEligibility.rows,runtimeCandidates:runtimeCandidates.rows[0],identityDiagnostic:identityDiagnostic.rows});
  }
  console.log(JSON.stringify({journeyCount:journeys.length,reports},null,2));
}finally{await client.end();}
