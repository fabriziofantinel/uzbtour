import { Client } from "@neondatabase/serverless";

const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL;
const legacyUserId=process.argv[2];
if(!url||!legacyUserId)throw new Error("Connessione o utente audit non configurati");
const client=new Client(url);
await client.connect();
try{
  const journeys=(await client.query("SELECT * FROM app.list_legacy_user_journeys($1)",[legacyUserId])).rows;
  const reports=[];
  for(const journey of journeys){
    const params=[journey.agency_id,journey.departure_id,journey.party_id,journey.template_version_id];
    const [catalog,activities,documents,finance,parties,referenceContent]=await Promise.all([
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
    ]);
    reports.push({journey:{templateId:journey.template_id,departureId:journey.departure_id,title:journey.title,country:journey.destination_country,party:journey.party_name,
      agency:journey.agency_name,branding:journey.agency_branding},catalog:catalog.rows[0],activities:activities.rows,
      documents:documents.rows[0],finance:finance.rows[0],parties:parties.rows[0],referenceContent:referenceContent.rows});
  }
  console.log(JSON.stringify({journeyCount:journeys.length,reports},null,2));
}finally{await client.end();}
