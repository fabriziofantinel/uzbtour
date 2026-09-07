import "server-only";

import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

export type RoomType = "single" | "double" | "matrimonial" | "triple";
export type RoomingRoom = {
  id: string;
  label: string;
  type: RoomType;
  specialRequirements: string;
  occupantIds: string[];
};

export type RoomingListData = {
  departure: { id: string; title: string; agencyName: string; agencyPrimaryColor: string };
  stays: Array<{ id: string; dayId: string; dayNumber: number; serviceDate: string; hotelName: string; notes: string }>;
  groups: Array<{
    id: string;
    name: string;
    travelers: Array<{ id: string; name: string; memberType: "adult" | "dependent_minor" }>;
  }>;
  rooms: Array<RoomingRoom & { stayId: string; partyId: string }>;
};

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

export async function readRoomingList(actorId: string, departureId: string): Promise<RoomingListData> {
  const sql = getSql();
  const scope = await sql`SELECT departure.agency_id::text,departure.title,agency.name agency_name,
    COALESCE(agency.branding->>'primaryColor','#247A6B') primary_color
    FROM travel.departures departure JOIN iam.agencies agency ON agency.id=departure.agency_id
    WHERE departure.id=${departureId}::uuid AND app.can_manage_rooming_list_v3(${actorId}::uuid,departure.id)`;
  if (!scope[0]) throw new PlatformRequestError("Rooming list non disponibile");
  const agencyId = String(scope[0].agency_id);
  const [, stayRows, travelerRows, roomRows] = await sql.transaction(
    (transaction) => [
      transaction`SELECT set_config('app.agency_id',${agencyId},true)`,
      transaction`SELECT stay.id::text,stay.departure_day_id::text day_id,template_day.day_number,
        day.service_date::text,stay.name_snapshot hotel_name,stay.notes
        FROM travel.departure_accommodation_stays stay
        JOIN travel.departure_days day ON day.agency_id=stay.agency_id AND day.departure_id=stay.departure_id
          AND day.id=stay.departure_day_id
        JOIN travel.template_days template_day ON template_day.agency_id=day.agency_id
          AND template_day.template_version_id=day.template_version_id AND template_day.id=day.template_day_id
        WHERE stay.agency_id=${agencyId}::uuid AND stay.departure_id=${departureId}::uuid
          AND stay.operational_status<>'cancelled'
        ORDER BY day.service_date,stay.sort_order,stay.id`,
      transaction`SELECT party.id::text party_id,party.name party_name,profile.id::text traveler_id,
        profile.display_name traveler_name,membership.member_type
        FROM travel.travel_parties party
        LEFT JOIN travel.party_memberships membership ON membership.agency_id=party.agency_id
          AND membership.departure_id=party.departure_id AND membership.party_id=party.id
          AND membership.status<>'removed'
        LEFT JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id
          AND profile.id=membership.traveler_id
        WHERE party.agency_id=${agencyId}::uuid AND party.departure_id=${departureId}::uuid
          AND party.status<>'archived'
        ORDER BY party.name,membership.role,profile.display_name`,
      transaction`SELECT room.id::text,room.stay_id::text,room.party_id::text,room.room_label,room.room_type,
        room.special_requirements,COALESCE(array_agg(occupant.traveler_id::text ORDER BY profile.display_name)
          FILTER(WHERE occupant.traveler_id IS NOT NULL),'{}'::text[]) occupant_ids
        FROM travel.rooming_rooms room
        LEFT JOIN travel.rooming_room_occupants occupant ON occupant.room_id=room.id
        LEFT JOIN travel.traveler_profiles profile ON profile.id=occupant.traveler_id AND profile.agency_id=room.agency_id
        WHERE room.agency_id=${agencyId}::uuid AND room.departure_id=${departureId}::uuid
        GROUP BY room.id,room.stay_id,room.party_id,room.room_label,room.room_type,room.special_requirements
        ORDER BY room.stay_id,room.party_id,room.room_label`,
    ],
    { readOnly: true },
  );
  const grouped = new Map<string, RoomingListData["groups"][number]>();
  for (const row of travelerRows) {
    const partyId = String(row.party_id);
    const group = grouped.get(partyId) ?? { id: partyId, name: String(row.party_name), travelers: [] };
    if (row.traveler_id)
      group.travelers.push({
        id: String(row.traveler_id),
        name: String(row.traveler_name),
        memberType: String(row.member_type) === "dependent_minor" ? "dependent_minor" : "adult",
      });
    grouped.set(partyId, group);
  }
  return {
    departure: {
      id: departureId,
      title: String(scope[0].title),
      agencyName: String(scope[0].agency_name),
      agencyPrimaryColor: String(scope[0].primary_color),
    },
    stays: stayRows.map((row) => ({
      id: String(row.id),
      dayId: String(row.day_id),
      dayNumber: Number(row.day_number),
      serviceDate: String(row.service_date),
      hotelName: String(row.hotel_name),
      notes: stringValue(row.notes),
    })),
    groups: [...grouped.values()],
    rooms: roomRows.map((row) => ({
      id: String(row.id),
      stayId: String(row.stay_id),
      partyId: String(row.party_id),
      label: String(row.room_label),
      type: String(row.room_type) as RoomType,
      specialRequirements: stringValue(row.special_requirements),
      occupantIds: Array.isArray(row.occupant_ids) ? row.occupant_ids.map(String) : [],
    })),
  };
}

export async function saveRoomingList(input: {
  actorId: string;
  departureId: string;
  stayId: string;
  partyId: string;
  rooms: RoomingRoom[];
}) {
  const rows = await getSql()`SELECT app.save_rooming_list_v3(${input.actorId}::uuid,${input.departureId}::uuid,
    ${input.stayId}::uuid,${input.partyId}::uuid,${JSON.stringify(
      input.rooms.map((room) => ({
        id: room.id,
        label: room.label,
        type: room.type,
        specialRequirements: room.specialRequirements,
        occupantIds: room.occupantIds,
      })),
    )}::jsonb) saved`;
  if (!rows[0]?.saved) throw new PlatformRequestError("Rooming list non salvata");
}

const roomTypeLabel: Record<RoomType, string> = {
  single: "Singola",
  double: "Doppia",
  matrimonial: "Matrimoniale",
  triple: "Tripla",
};

export async function createRoomingListDocx(data: RoomingListData, stayId: string) {
  const stay = data.stays.find((item) => item.id === stayId);
  if (!stay) throw new PlatformRequestError("Pernottamento non disponibile");
  const names = new Map(
    data.groups.flatMap((group) => group.travelers.map((traveler) => [traveler.id, traveler.name])),
  );
  const rows = data.rooms.filter((room) => room.stayId === stayId);
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: ["Gruppo", "Camera", "Tipologia", "Ospiti", "Esigenze"].map(
        (label) =>
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }),
      ),
    }),
    ...rows.map((room) => {
      const group = data.groups.find((item) => item.id === room.partyId);
      return new TableRow({
        children: [
          group?.name ?? "Gruppo",
          room.label,
          roomTypeLabel[room.type],
          room.occupantIds.map((id) => names.get(id) ?? "Ospite").join(", "),
          room.specialRequirements || "—",
        ].map((value) => new TableCell({ children: [new Paragraph(String(value))] })),
      });
    }),
  ];
  const document = new Document({
    creator: data.departure.agencyName,
    title: `Rooming list - ${stay.hotelName}`,
    sections: [
      {
        children: [
          new Paragraph({ text: "Rooming list", heading: HeadingLevel.TITLE }),
          new Paragraph({ children: [new TextRun({ text: data.departure.agencyName, bold: true })] }),
          new Paragraph(`${data.departure.title} · ${stay.hotelName}`),
          new Paragraph(
            `Arrivo previsto: ${new Intl.DateTimeFormat("it-IT").format(new Date(`${stay.serviceDate}T12:00:00`))}`,
          ),
          new Paragraph("Il documento contiene esclusivamente nomi, assegnazioni ed esigenze operative."),
          new Paragraph({ text: "Assegnazione camere", heading: HeadingLevel.HEADING_1 }),
          rows.length
            ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows })
            : new Paragraph("Nessuna camera assegnata."),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
